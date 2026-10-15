import { ActionExecutions, type PendingExecution } from './executions';
import { createGroupInputSchema, memberChoiceSchema, performCreate, performJoin } from './operations';
import { z } from 'zod';
import {
  activeMembers,
  joinedParticipants,
  participantsForMember,
  preferredMember,
  groupNameSchema,
  identifierSchema,
  memberNameSchema,
  parseInviteLink,
  formatInviteLink,
  requiresServerDecision,
  type ClientDiagnosticObserver,
  type InvitePreview,
  type JsonValue,
} from '@splitnext/client';
import type { ActionInvocation, AppController, AppState } from './controller';
import { AppUiState, viewNames, type UiState } from './uiState';
import { sourceOptions, type ValueSource } from './actionInputs';
import {
  nextSteps,
  isSubmission,
  workflowGuard,
  workflowEffect,
  workflowCompletions,
  type WorkflowIntent,
  type WorkflowStep,
} from './workflow';

/**
 * Everything a person can do in the app, callable the same way by any caller:
 * UI events, an assistant, RPC, tests, or the workbench. See ADR 0016.
 */

/** The controller surface actions run against, so fakes can host them too. */
export type ActionHost = Pick<
  AppController,
  | 'snapshot'
  | 'lastYouName'
  | 'refresh'
  | 'createGroup'
  | 'joinGroup'
  | 'openGroup'
  | 'openJoinedGroup'
  | 'showGroups'
  | 'submit'
  | 'regenerateInvite'
  | 'retryNotice'
  | 'dismissNotice'
> & {
  forInvocation?: (invocation: ActionInvocation) => ActionHost;
  client: Pick<AppController['client'], 'previewInvite'> & Partial<Pick<AppController['client'], 'observeDiagnostics'>>;
};

/** Conditions checked before an action runs, the same for every caller. */
export type Requirement =
  'online' | 'reachable' | 'openGroup' | 'selectedGroup';

export const actionGroups = ['UI', 'Ledger changes', 'Access & sync'] as const;

export type ActionGroup = (typeof actionGroups)[number];

export type ActionPlatform = {
  appUrl: string;
  copyLink?: (link: string) => Promise<void>;
  shareLink?: (link: string, title: string) => Promise<void>;
  openHomepage?: () => void;
};

type DispatcherOptions = Partial<ActionPlatform> & { initialLink?: string };

export type ActionAvailability =
  | { available: true }
  | { available: false; error: string; reason: string; issues: string[] };

type ActionContext = {
  state: AppState;
  ui: UiState;
  platform: ActionPlatform;
  pendingConfirmation?: ActionAvailability | undefined;
  executions?: readonly PendingExecution[];
};

type BlockedAction = Exclude<ActionAvailability, { available: true }>;

function unavailable(error: string, reason: string): BlockedAction {
  return { available: false, error, reason, issues: [] };
}

/** The single result shape every caller receives. Actions never throw. */
export type Outcome<O> =
  | { status: 'done'; value: O }
  | { status: 'needs_confirmation'; message: string; requestId?: string }
  | { status: 'failed'; error: string; issues: string[] };

export type DispatchOptions = {
  /** The person approved this action's confirmation message. */
  confirmed?: boolean;
  /** Who invoked it, for observers and future audit attribution only. */
  origin?: string;
  parentInvocationId?: string;
  invocationId?: string;
};

type ActionSpec<S extends z.ZodType, O> = {
  group: ActionGroup;
  description: string;
  input: S;
  /** A valid input, for documentation, assistants, and the workbench. */
  example: z.input<S>;
  requires?: readonly Requirement[];
  workflow?: WorkflowIntent;
  /** Shared resources protected while this action runs. */
  resources?: (context: ActionContext, input: z.output<S> | undefined) => readonly string[];
  /** Guard-only dependencies; reading/changing a draft need not hold a write resource. */
  waitFor?: (context: ActionContext, input: z.output<S> | undefined) => readonly string[];
  /** A next step offered by the workflow, independent of caller. */
  nextStep?: WorkflowStep;
  /** Domain/draft eligibility and optional priority within that next step. */
  suggest?: (context: ActionContext) => number | null;
  /** Read-only preflight; omitted input checks whether any input can run. */
  unavailable?: (
    context: ActionContext,
    input: z.output<S> | undefined,
  ) => BlockedAction | null;
  /** A message the person must approve first, or null when none is needed. */
  confirm?: (input: z.output<S>, state: AppState) => string | null;
  run: (
    host: ActionHost,
    input: z.output<S>,
    ui: AppUiState,
    platform: ActionPlatform,
  ) => Promise<O>;
};

function defineAction<S extends z.ZodType, O>(spec: ActionSpec<S, O>) {
  function resources(context: ActionContext, input?: z.output<S>): readonly string[] {
    return spec.resources?.(context, input) ?? [];
  }

  function check(
    context: ActionContext,
    input?: z.output<S>,
  ): ActionAvailability {
    const workflow = spec.workflow
      ? workflowGuard(context.ui, spec.workflow)
      : null;

    if (workflow) return unavailable(workflow.error, workflow.reason);

    const targets = [...resources(context, input), ...(spec.waitFor?.(context, input) ?? (spec.workflow === 'navigate' ? ['memberEditor'] : []))];
    const pending = context.executions?.find((entry) => entry.resources.some((resource) => targets.includes(resource)));

    if (pending) return unavailable('operation_busy', `Wait for ${pending.name} to finish.`);

    const unmet = (spec.requires ?? []).find(
      (need) => !meets(need, context.state),
    );

    if (unmet) {
      if (unmet === 'openGroup' || unmet === 'selectedGroup')
        return unavailable('no_open_group', 'Open a group first.');

      return unavailable(
        'client_offline',
        context.state.online
          ? 'Connect to the server first.'
          : 'Go online first.',
      );
    }

    return spec.unavailable?.(context, input) ?? { available: true };
  }

  function validate(raw: z.input<S> | JsonValue) {
    const parsed = spec.input.safeParse(raw);

    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
      );

      return {
        ...unavailable(
          'invalid_input',
          issues[0] ?? 'Complete the action inputs.',
        ),
        issues,
      };
    }

    return parsed;
  }

  return {
    group: spec.group,
    description: spec.description,
    input: spec.input,
    example: spec.example,
    requires: spec.requires ?? [],
    workflow: spec.workflow ?? null,
    nextStep: spec.nextStep ?? null,
    confirms: Boolean(spec.confirm),
    suggestion(context: ActionContext): number | null {
      if (!spec.nextStep || !check(context).available) return null;

      const rank = nextSteps(context.ui, {
        confirmationPending: Boolean(context.ui.confirmation),
        memberEditing: Boolean(context.ui.memberEdit),
        home: !context.state.group
          ? 'groups'
          : context.state.group.hidden
            ? 'leftGroup'
            : 'group',
      })[spec.nextStep];

      if (rank === undefined) return null;

      return spec.suggest ? spec.suggest(context) : rank;
    },
    availability(
      context: ActionContext,
      raw?: z.input<S> | JsonValue,
    ): ActionAvailability {
      const base = check(context);

      if (!base.available || raw === undefined) return base;
      const parsed = validate(raw);

      return 'available' in parsed ? parsed : check(context, parsed.data);
    },
    async execute(
      host: ActionHost,
      raw: z.input<S>,
      options: DispatchOptions,
      ui: AppUiState,
      platform: ActionPlatform,
      pendingConfirmation: ActionAvailability | undefined,
      executions: ActionExecutions,
      name: string,
    ): Promise<Outcome<O>> {
      const parsed = validate(raw);

      if ('available' in parsed)
        return { status: 'failed', error: parsed.error, issues: parsed.issues };

      const state = host.snapshot();

      const context: ActionContext = { state, ui: ui.snapshot(), platform, pendingConfirmation, executions: executions.snapshot() };
      const availability = check(context, parsed.data);

      if (!availability.available)
        return {
          status: 'failed',
          error: availability.error,
          issues: availability.issues,
        };

      const message = spec.confirm?.(parsed.data, state) ?? null;

      if (message && !options.confirmed)
        return { status: 'needs_confirmation', message };

      const execution = executions.start(name, options.origin ?? 'unspecified', resources(context, parsed.data), options.invocationId);

      try {
        const run = () => spec.run(host, parsed.data, ui, platform);
        const value = await (isSubmission(spec.workflow) ? ui.perform(spec.workflow, run) : run());

        return { status: 'done', value };
      } catch (cause) {
        return {
          status: 'failed',
          error: cause instanceof Error ? cause.message : 'request_failed',
          issues: [],
        };
      } finally {
        executions.finish(execution);
      }
    },
  };
}

function meets(requirement: Requirement, state: AppState): boolean {
  switch (requirement) {
    case 'online':
      return state.online;
    case 'reachable':
      return state.online && state.reachable;
    case 'openGroup':
      return Boolean(state.group?.projected_snapshot && !state.group.hidden);
    case 'selectedGroup':
      return Boolean(state.group?.projected_snapshot);
  }
}

function openSnapshot(state: AppState) {
  return state.group?.projected_snapshot ?? null;
}

function requireMember(
  state: AppState,
  memberId?: string,
): BlockedAction | null {
  const members = activeMembers(openSnapshot(state));

  return members.some(
    (member) => memberId === undefined || member.id === memberId,
  )
    ? null
    : unavailable(
        'member_not_found',
        memberId ? 'Choose a current member.' : 'Add a member first.',
      );
}

function requireNotice(
  state: AppState,
  commandId?: string,
): BlockedAction | null {
  return state.group?.notices.some(
    (notice) =>
      commandId === undefined || notice.command.command_id === commandId,
  )
    ? null
    : unavailable('notice_not_found', 'No changes to review.');
}

function requireJoin(context: ActionContext): BlockedAction | null {
  const { ui, state } = context;

  if (ui.view === 'rejoin' ? !state.group?.hidden : !ui.join.preview)
    return unavailable('join_choice_required', 'Check an invite link first.');

  return null;
}

function joinMembers({ ui, state }: Pick<ActionContext, 'ui' | 'state'>) {
  return ui.view === 'rejoin'
    ? activeMembers(openSnapshot(state))
    : (ui.join.preview?.members ?? []);
}

function requireConfirmation(
  ui: UiState,
  requestId?: string,
): BlockedAction | null {
  return ui.confirmation &&
    (requestId === undefined || requestId === ui.confirmation.id)
    ? null
    : unavailable(
        'confirmation_not_found',
        'No matching confirmation pending.',
      );
}

function requireInvite(
  context: ActionContext,
  kind: 'copyLink' | 'shareLink',
): BlockedAction | null {
  if (!context.platform[kind])
    return unavailable(
      'platform_unavailable',
      kind === 'copyLink'
        ? 'Clipboard is unavailable on this device.'
        : 'Sharing is unavailable on this device.',
    );

  return openSnapshot(context.state)?.invite && context.platform.appUrl
    ? null
    : unavailable('invite_invalid', 'The invite link is not available yet.');
}

function requireName(
  schema: z.ZodString,
  name: string,
  label: string,
): BlockedAction | null {
  return schema.safeParse(name).success
    ? null
    : unavailable('invalid_input', `Enter a valid ${label}.`);
}

function memberResource(state: AppState, memberId: string | undefined | null): string[] {
  return memberId ? [`member:${state.group?.group_id}:${memberId}`] : [];
}

function noticeResources(state: AppState, commandId?: string): string[] {
  const notice = state.group?.notices.find((entry) => entry.command.command_id === commandId);

  if (!notice) return [];
  const target = notice.outcome.target;

  return [`notice:${state.group?.group_id}:${commandId}`,
    ...(target.kind === 'member' ? memberResource(state, target.id) : target.kind === 'group' ? [`groupName:${state.group?.group_id}`] : [])];
}

const empty = z.object({});

/**
 * Where the values a field can take come from in app state, published in each
 * field's JSON Schema so any caller (a form, an assistant) can offer them.
 * `choices` means the value must be one of them; `suggestions` only helps.
 */
function choice(source: ValueSource, description: string) {
  return z.string().min(1).meta({ description, choices: source });
}

function suggested<S extends z.ZodString>(
  schema: S,
  source: ValueSource,
  description: string,
) {
  return schema.meta({ description, suggestions: source });
}

export type InviteCheck =
  | { opened: true }
  | { opened: false; groupId: string; token: string; preview: InvitePreview };

export const appActions = {
  showCreateGroup: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the create-group form.',
    input: empty,
    example: {},
    nextStep: 'create',
    run: async (host, input, ui) => ui.show('create'),
  }),
  showJoinGroup: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the join form, optionally with an invite link.',
    input: z.object({ link: z.string().optional() }),
    example: {},
    nextStep: 'join',
    run: async (host, input, ui) => ui.showJoin(input.link),
  }),
  showSettings: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open settings for the current group.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    nextStep: 'settings',
    run: async (host, input, ui) => ui.show('settings'),
  }),
  showInvite: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the current group’s shared invite link.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    nextStep: 'invite',
    suggest: ({ state }) =>
      joinedParticipants(openSnapshot(state)).length <= 1
        ? 10
        : 20,
    run: async (host, input, ui) => ui.show('invite'),
  }),
  showNotices: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open changes that need review.',
    input: empty,
    example: {},
    requires: ['selectedGroup'],
    nextStep: 'notices',
    unavailable: ({ state }) => requireNotice(state),
    run: async (host, input, ui) => ui.show('notices'),
  }),
  showRejoin: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open member choices to rejoin the selected group.',
    input: empty,
    example: {},
    requires: ['selectedGroup'],
    nextStep: 'rejoin',
    unavailable: ({ state }) =>
      state.group?.hidden
        ? null
        : unavailable('group_already_joined', 'This group is already joined.'),
    run: async (host, input, ui) => ui.showJoin('', true),
  }),
  closePanel: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Return from a form or panel to the group or groups list.',
    input: empty,
    example: {},
    nextStep: 'close',
    unavailable: ({ ui }) =>
      ui.view !== 'home'
        ? null
        : unavailable('panel_not_open', 'No form or panel is open.'),
    run: async (host, input, ui) => ui.showGroup(),
  }),
  showHomepage: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the public homepage.',
    input: empty,
    example: {},
    unavailable: ({ platform }) =>
      platform.openHomepage
        ? null
        : unavailable(
            'platform_unavailable',
            'Homepage navigation is unavailable.',
          ),
    run: async (host, input, ui, platform) => {
      if (!platform.openHomepage) throw new Error('platform_unavailable');
      platform.openHomepage();
    },
  }),
  restoreNavigation: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Restore a view when using Back or Forward.',
    input: z.object({
      view: z.enum(viewNames),
      groupId: choice(
        'group',
        'The group to show, or omit for the groups list.',
      ).optional(),
    }),
    example: { view: 'home' },
    run: async (host, input, ui) => {
      if (input.groupId && input.groupId !== host.snapshot().group?.group_id)
        await host.openGroup(input.groupId);
      else if (!input.groupId) host.showGroups();
      ui.show(input.view, 'restore');
    },
  }),
  changeDraft: defineAction({
    waitFor: ({ ui }, input) => (!input ? ui.memberEdit : input.field === 'member.name') ? ['memberEditor'] : [],
    group: 'UI',
    description: 'Change a form field without submitting it.',
    input: z.object({
      field: z.enum([
        'create.name',
        'create.yourName',
        'settings.name',
        'join.link',
        'join.name',
        'member.name',
      ]),
      value: z.string(),
    }),
    example: { field: 'create.name', value: 'Lisbon weekend' },
    unavailable: ({ ui }, input) => {
      const intent: WorkflowIntent = !input
        ? 'draft'
        : input.field === 'member.name'
          ? 'groupEditor'
          : input.field === 'join.link'
            ? 'joinLink'
            : input.field === 'join.name'
              ? 'joinName'
              : input.field.startsWith('create.')
                ? 'createDraft'
                : 'settingsDraft';

      const guard = workflowGuard(ui, intent);

      if (guard) return unavailable(guard.error, guard.reason);

      if (!input)
        return ui.memberEdit ||
          ['create', 'settings', 'join', 'rejoin'].includes(ui.view)
          ? null
          : unavailable('form_not_open', 'Open a form or edit a member first.');

      if (input.field === 'member.name')
        return ui.memberEdit
          ? null
          : unavailable('no_member_edit', 'Edit a member first.');

      return null;
    },
    run: async (host, input, ui) => ui.changeDraft(input.field, input.value),
  }),
  chooseJoinMember: defineAction({
    workflow: 'chooseMember',
    group: 'UI',
    description: 'Choose an existing member, or someone new, in the join form.',
    input: z.object({
      as: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('existing'),
          memberId: choice('joinMember', 'The name to join as.'),
        }),
        z.object({ kind: z.literal('new') }),
      ]),
    }),
    example: { as: { kind: 'new' } },
    nextStep: 'chooseMember',
    suggest: ({ ui }) => (ui.join.chosen ? 20 : 10),
    unavailable: (context, input) => {
      const choice = input?.as;

      return (
        requireJoin(context) ??
        (choice?.kind === 'existing' &&
        !joinMembers(context).some((member) => member.id === choice.memberId)
          ? unavailable('member_not_found', 'Choose a member from this group.')
          : null)
      );
    },
    run: async (host, input, ui) => {
      const chosen = input.as;

      const people = joinMembers({ state: host.snapshot(), ui: ui.snapshot() });

      if (
        chosen.kind === 'existing' &&
        !people.some((member) => member.id === chosen.memberId)
      )
        throw new Error('member_not_found');
      ui.chooseJoinMember(chosen.kind === 'new' ? 'new' : chosen.memberId);
    },
  }),
  clearInvitePreview: defineAction({
    workflow: 'clearPreview',
    group: 'UI',
    description: 'Return to editing the invite link.',
    input: empty,
    example: {},
    run: async (host, input, ui) => ui.clearInvitePreview(),
  }),
  setLeftGroupsVisible: defineAction({
    group: 'UI',
    description: 'Show or hide groups this installation left.',
    input: z.object({ visible: z.boolean() }),
    example: { visible: true },
    unavailable: ({ state }) =>
      state.groups.some((group) => group.status === 'left')
        ? null
        : unavailable('no_left_groups', 'No left groups.'),
    run: async (host, input, ui) =>
      ui.update({ showLeftGroups: input.visible }),
  }),
  setNoticeSummaryVisible: defineAction({
    group: 'UI',
    description: 'Show or hide the changes-to-review banner.',
    input: z.object({ visible: z.boolean() }),
    example: { visible: false },
    run: async (host, input, ui) =>
      ui.update({ showNoticeSummary: input.visible }),
  }),
  beginAddMember: defineAction({
    waitFor: () => ['memberEditor'],
    workflow: 'groupEditor',
    group: 'UI',
    description: 'Insert a member row in edit mode.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    nextStep: 'addMember',
    suggest: ({ state }) =>
      joinedParticipants(openSnapshot(state)).length <= 1
        ? 20
        : 10,
    run: async (host, input, ui) => ui.beginMemberEdit(null),
  }),
  beginEditMember: defineAction({
    waitFor: () => ['memberEditor'],
    workflow: 'groupEditor',
    group: 'UI',
    description: 'Edit a member name in its row.',
    input: z.object({ memberId: choice('member', 'The member to edit.') }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    nextStep: 'editMember',
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    run: async (host, input, ui) => ui.beginMemberEdit(input.memberId),
  }),
  cancelMemberEdit: defineAction({
    waitFor: () => ['memberEditor'],
    group: 'UI',
    description: 'Discard the current member-name draft.',
    input: empty,
    example: {},
    nextStep: 'cancelMember',
    unavailable: ({ ui }) =>
      ui.memberEdit
        ? null
        : unavailable('no_member_edit', 'Edit a member first.'),
    run: async (host, input, ui) => ui.finishMemberEdit(),
  }),
  saveMemberEdit: defineAction({
    resources: ({ state, ui }) => ['memberEditor', ...memberResource(state, ui.memberEdit?.memberId)],
    group: 'Ledger changes',
    description: 'Commit the current member-name draft.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    nextStep: 'saveMember',
    suggest: ({ ui }) =>
      ui.memberEdit?.name.trim() &&
      ui.memberEdit.name.trim() !== ui.memberEdit.expectedName
        ? 10
        : null,
    unavailable: ({ ui, state }) =>
      !ui.memberEdit
        ? unavailable('no_member_edit', 'Edit a member first.')
        : ((ui.memberEdit.memberId
            ? requireMember(state, ui.memberEdit.memberId)
            : null) ??
          (ui.memberEdit.name.trim()
            ? requireName(memberNameSchema, ui.memberEdit.name, 'member name')
            : null)),
    run: async (host, input, ui) => {
      const edit = ui.snapshot().memberEdit;

      if (!edit) return;
      const name = edit.name.trim();

      if (name && !edit.memberId)
        await host.submit({ type: 'member.create', payload: { display_name: name } });
      else if (name && name !== edit.expectedName && edit.memberId)
        await host.submit({
          type: 'member.rename',
          payload: { member_id: edit.memberId, display_name: name, expected_display_name: edit.expectedName },
        });
      ui.finishMemberEdit(edit);
    },
  }),
  saveGroupSettings: defineAction({
    resources: ({ state }) => [`groupName:${state.group?.group_id}`],
    workflow: 'saveSettings',
    group: 'Ledger changes',
    description: 'Save the group-name draft and return to the group.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    nextStep: 'saveSettings',
    unavailable: ({ ui }) =>
      requireName(groupNameSchema, ui.settings.name, 'group name') ??
      (ui.settings.name.trim() === ui.settings.expectedName
        ? unavailable('draft_unchanged', 'Change the group name first.')
        : null),
    run: async (host, input, ui) => {
      const draft = ui.snapshot().settings;
      const name = groupNameSchema.parse(draft.name);

      await host.submit({ type: 'group.rename', payload: { name, expected_name: draft.expectedName } });
    },
  }),
  submitCreateGroup: defineAction({
    waitFor: () => ['memberEditor'],
    workflow: 'submitCreate',
    group: 'Access & sync',
    description: 'Create the group using the current form draft.',
    input: empty,
    example: {},
    requires: ['reachable'],
    nextStep: 'submitCreate',
    unavailable: ({ ui }) =>
      requireName(groupNameSchema, ui.create.name, 'group name') ??
      requireName(memberNameSchema, ui.create.yourName, 'your name'),
    run: async (host, input, ui) => {
      const draft = ui.snapshot().create;
      await performCreate(host, draft);
    },
  }),
  submitJoin: defineAction({
    waitFor: () => ['memberEditor'],
    workflow: 'submitJoin',
    group: 'Access & sync',
    description:
      'Join or rejoin using the current member choice and name draft.',
    input: empty,
    example: {},
    requires: ['online'],
    nextStep: 'submitJoin',
    unavailable: (context) =>
      requireJoin(context) ??
      (!context.ui.join.chosen
        ? unavailable('join_choice_required', 'Choose a name first.')
        : context.ui.join.chosen === 'new'
          ? requireName(memberNameSchema, context.ui.join.name, 'your name')
          : joinMembers(context).some(
                (member) => member.id === context.ui.join.chosen,
              )
            ? null
            : unavailable('member_not_found', 'Choose a current member.')),
    run: async (host, input, ui) => {
      const draft = ui.snapshot().join;

      const groupId =
        ui.snapshot().view === 'rejoin'
          ? host.snapshot().group?.group_id
          : draft.preview?.group.id;

      const chosen = draft.chosen;

      if (!groupId || !chosen) throw new Error('join_choice_required');
      await performJoin(host, {
        groupId,
        as: chosen === 'new' ? { kind: 'new', name: draft.name } : { kind: 'existing', memberId: chosen },
        token: draft.token ?? undefined,
      });
    },
  }),
  refreshGroups: defineAction({
    group: 'Access & sync',
    description: 'Retry loading and synchronizing saved groups.',
    input: empty,
    example: {},
    requires: ['online'],
    nextStep: 'refresh',
    suggest: ({ state }) => (!state.reachable || state.syncError ? 1 : null),
    run: (host) => host.refresh(),
  }),
  copyInviteLink: defineAction({
    group: 'UI',
    description: 'Copy the open group’s invite link.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    nextStep: 'copyInvite',
    unavailable: (context) => requireInvite(context, 'copyLink'),
    run: async (host, input, ui, platform) => {
      if (!platform.copyLink) throw new Error('platform_unavailable');
      const group = host.snapshot().group;
      const invite = group?.projected_snapshot?.invite;

      if (!group || !invite || !platform.appUrl)
        throw new Error('invite_invalid');
      await platform.copyLink(
        formatInviteLink(platform.appUrl, group.group_id, invite.token),
      );
      ui.update({ copiedInviteId: invite.id });
    },
  }),
  shareInviteLink: defineAction({
    group: 'UI',
    description:
      'Share the open group’s invite link using the device’s share sheet.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    nextStep: 'shareInvite',
    unavailable: (context) => requireInvite(context, 'shareLink'),
    run: async (host, input, ui, platform) => {
      if (!platform.shareLink) throw new Error('platform_unavailable');
      const group = host.snapshot().group;
      const snapshot = group?.projected_snapshot;

      if (!group || !snapshot?.invite || !platform.appUrl)
        throw new Error('invite_invalid');
      await platform.shareLink(
        formatInviteLink(
          platform.appUrl,
          group.group_id,
          snapshot.invite.token,
        ),
        `Join ${snapshot.group.name}`,
      );
    },
  }),
  confirmAction: defineAction({
    group: 'UI',
    description: 'Approve and run the pending action.',
    input: z.object({
      requestId: choice('confirmation', 'The pending confirmation to approve.'),
    }),
    example: { requestId: 'confirmation-1' },
    nextStep: 'confirm',
    unavailable: ({ ui, pendingConfirmation }, input) =>
      requireConfirmation(ui, input?.requestId) ??
      (pendingConfirmation && !pendingConfirmation.available
        ? pendingConfirmation
        : null),
    run: async (host, input, ui) => ui.confirm(input.requestId),
  }),
  cancelConfirmation: defineAction({
    group: 'UI',
    description: 'Cancel the pending action without applying it.',
    input: z.object({
      requestId: choice('confirmation', 'The pending confirmation to cancel.'),
    }),
    example: { requestId: 'confirmation-1' },
    nextStep: 'cancelConfirmation',
    unavailable: ({ ui }, input) => requireConfirmation(ui, input?.requestId),
    run: async (host, input, ui) => ui.cancelConfirmation(input.requestId),
  }),
  createGroup: defineAction({
    waitFor: () => ['memberEditor'],
    workflow: 'createDirect',
    group: 'Access & sync',
    description:
      'Create a group and join it as a new member with your name; it opens.',
    input: createGroupInputSchema,
    example: { name: 'Lisbon weekend', yourName: 'Ana' },
    requires: ['reachable'],
    run: (host, input) => performCreate(host, input),
  }),
  checkInvite: defineAction({
    waitFor: () => ['memberEditor'],
    workflow: 'checkInvite',
    group: 'Access & sync',
    description:
      'Read an invite link. Opens the group if this installation already ' +
      'joined it; otherwise returns the group and members to choose from.',
    input: z.object({
      link: suggested(
        z.string().trim().min(1),
        'inviteLink',
        'An invite link, as shared.',
      ),
    }),
    example: { link: 'https://splitnext.app/join/uy9ogmKJRD2VRfbN4PDsAw#…' },
    requires: ['online'],
    nextStep: 'checkInvite',
    suggest: ({ ui }) => (parseInviteLink(ui.join.link) ? 10 : null),
    unavailable: (context, input) =>
      input && !parseInviteLink(input.link)
        ? unavailable('invite_invalid', 'Enter a valid invite link.')
        : null,
    run: async (host, input, ui): Promise<InviteCheck> => {
      const parsed = parseInviteLink(input.link);

      if (!parsed) throw new Error('invite_invalid');

      const check = ui.startInviteCheck(input.link);

      try {
        if (
          await host.openJoinedGroup(parsed.group_id, () =>
            ui.inviteCheckIsCurrent(check),
          )
        ) {
          ui.openedInvite(check);

          return { opened: true };
        }

        const result: InviteCheck = {
          opened: false,
          groupId: parsed.group_id,
          token: parsed.token,
          preview: await host.client.previewInvite(
            parsed.group_id,
            parsed.token,
          ),
        };

        ui.checkedInvite(input.link, result.token, result.preview, check);

        return result;
      } catch (cause) {
        ui.failedInvite(check);
        throw cause;
      }
    },
  }),
  joinGroup: defineAction({
    waitFor: () => ['memberEditor'],
    workflow: 'joinDirect',
    group: 'Access & sync',
    description:
      'Join or rejoin a group as an existing member or as someone new. ' +
      'A token is needed unless rejoining a group this installation left.',
    input: z.object({
      groupId: suggested(
        identifierSchema,
        'group',
        'The group to join, from the invite link or a left group.',
      ),
      as: memberChoiceSchema,
      token: z
        .string()
        .optional()
        .meta({ description: 'The invite token; not needed to rejoin.' }),
    }),
    example: {
      groupId: 'uy9ogmKJRD2VRfbN4PDsAw',
      as: { kind: 'new', name: 'Ana' },
    },
    requires: ['online'],
    unavailable: ({ state }, input) =>
      !input ||
      input.token ||
      state.groups.some((group) => group.group_id === input.groupId) ||
      state.group?.group_id === input.groupId
        ? null
        : unavailable(
            'invite_required',
            'Provide an invite token for a new group.',
          ),
    run: (host, input) => performJoin(host, input),
  }),
  openGroup: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open one of this installation’s groups.',
    input: z.object({
      groupId: choice('group', "One of this installation's groups."),
    }),
    example: { groupId: 'uy9ogmKJRD2VRfbN4PDsAw' },
    nextStep: 'openGroup',
    unavailable: ({ state }, input) =>
      state.groups.some(
        (group) => !input || group.group_id === input.groupId,
      ) ||
      (state.group && (!input || state.group.group_id === input.groupId))
        ? null
        : unavailable('group_not_found', 'Choose a saved group.'),
    run: async (host, input, ui) => {
      await host.openGroup(input.groupId);

      if (host.snapshot().group?.hidden) ui.showJoin('', true);
      else ui.showGroup();
    },
  }),
  showGroups: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Return to the groups list.',
    input: empty,
    example: {},
    nextStep: 'groups',
    run: async (host, input, ui) => {
      host.showGroups();
      ui.show('home');
    },
  }),
  renameGroup: defineAction({
    resources: ({ state }) => [`groupName:${state.group?.group_id}`],
    group: 'Ledger changes',
    description: 'Rename the open group.',
    input: z.object({
      name: groupNameSchema.meta({ description: 'The new group name.' }),
      expectedName: suggested(
        z.string(),
        'groupName',
        'The name you saw; defaults to the current name.',
      ).optional(),
    }),
    example: { name: 'Lisbon long weekend' },
    requires: ['openGroup'],
    run: (host, input) =>
      host.submit({ type: 'group.rename', payload: { name: input.name, expected_name: input.expectedName } }),
  }),
  createMember: defineAction({
    group: 'Ledger changes',
    description: 'Add a member to the open group.',
    input: z.object({
      name: memberNameSchema.meta({ description: "The new member's name." }),
    }),
    example: { name: 'Ben' },
    requires: ['openGroup'],
    run: (host, input) => host.submit({ type: 'member.create', payload: { display_name: input.name } }),
  }),
  renameMember: defineAction({
    resources: ({ state }, input) => memberResource(state, input?.memberId),
    group: 'Ledger changes',
    description: 'Rename a member of the open group.',
    input: z.object({
      memberId: choice('member', 'The member to rename.'),
      name: memberNameSchema.meta({ description: 'The new member name.' }),
      expectedName: suggested(
        z.string(),
        'memberName',
        "The name you saw; defaults to the member's current name.",
      ).optional(),
    }),
    example: { memberId: 'member-2', name: 'Benjamin' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    run: (host, input) =>
      host.submit({
        type: 'member.rename',
        payload: { member_id: input.memberId, display_name: input.name, expected_display_name: input.expectedName },
      }),
  }),
  archiveMember: defineAction({
    resources: ({ state }, input) => memberResource(state, input?.memberId),
    group: 'Ledger changes',
    description:
      'Remove a member from the open group. Their name stays in history.',
    input: z.object({
      memberId: choice('preferredMember', 'The member to remove.'),
    }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    nextStep: 'archiveMember',
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    run: async (host, input, ui) => {
      await host.submit({ type: 'member.archive', payload: { member_id: input.memberId } });

      if (ui.snapshot().memberEdit?.memberId === input.memberId)
        ui.finishMemberEdit();
    },
  }),
  setPreferredMember: defineAction({
    resources: ({ state }) => [`preference:${state.group?.group_id}`],
    group: 'Ledger changes',
    description:
      'Choose which member is you on this installation. Asks first when ' +
      'another participant already uses that member.',
    input: z.object({
      memberId: choice(
        'preferredMember',
        'The member to use as you on this installation.',
      ),
    }),
    example: { memberId: 'member-1' },
    requires: ['openGroup'],
    nextStep: 'setPreferredMember',
    suggest: (context) => {
      const snapshot = openSnapshot(context.state);
      const self = context.state.group?.session?.identity.id;

      const you = preferredMember(snapshot, self)?.id;

      return snapshot?.members.some(
        (member) => member.status === 'active' && member.id !== you,
      )
        ? you
          ? 25
          : 1
        : null;
    },
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    confirm: (input, state) => {
      const self = state.group?.session?.identity.id;

      const others = participantsForMember(openSnapshot(state), input.memberId).filter(
        (grant) => grant.identity_id !== self,
      );

      return others.length
        ? `${others.map((grant) => grant.actor_handle).join(', ')} already ${others.length === 1 ? 'uses' : 'use'} this name.`
        : null;
    },
    run: (host, input) => host.submit({ type: 'preference.set', payload: { member_id: input.memberId } }),
  }),
  regenerateInvite: defineAction({
    resources: ({ state }) => [`invite:${state.group?.group_id}`],
    group: 'Access & sync',
    description:
      'Replace the open group’s invite link with a new one for everyone.',
    input: empty,
    example: {},
    requires: ['online', 'openGroup'],
    confirm: () => 'The current link will stop working.',
    run: (host) => host.regenerateInvite(),
  }),
  leaveGroup: defineAction({
    waitFor: () => ['memberEditor'],
    resources: ({ state }) => [`access:${state.group?.group_id}`],
    group: 'Access & sync',
    description:
      'Leave the open group on this installation. It can be rejoined later.',
    input: empty,
    example: {},
    requires: ['online', 'openGroup'],
    confirm: () => 'Leave this group?',
    run: async (host, input, ui) => {
      const navigation = ui.snapshot().navigation.revision;

      await host.submit({ type: 'group.leave', payload: {} });

      if (ui.snapshot().navigation.revision === navigation) ui.show('home');
    },
  }),
  retryNotice: defineAction({
    waitFor: ({ state }, input) => state.group?.notices.some((entry) => entry.command.command_id === input?.commandId && entry.command.type === 'group.leave') ? ['memberEditor'] : [],
    resources: ({ state }, input) => noticeResources(state, input?.commandId),
    group: 'Ledger changes',
    description: 'Retry a rejected or superseded change from its notice.',
    input: z.object({
      commandId: choice('notice', 'The change notice to apply again.'),
    }),
    example: { commandId: 'notice-command-id' },
    requires: ['openGroup'],
    nextStep: 'retryNotice',
    unavailable: ({ state }, input) => {
      const absent = requireNotice(state, input?.commandId);

      if (absent) return absent;
      const candidates = state.group?.notices.filter((entry) => !input || entry.command.command_id === input.commandId) ?? [];

      return !state.online && candidates.every((entry) => requiresServerDecision(entry.command.type))
        ? unavailable('client_offline', 'Go online to retry this change.') : null;
    },
    run: (host, input) => host.retryNotice(input.commandId),
  }),
  dismissNotice: defineAction({
    resources: ({ state }, input) => noticeResources(state, input?.commandId),
    group: 'UI',
    description: 'Dismiss a rejected or superseded change notice.',
    input: z.object({
      commandId: choice('notice', 'The change notice to dismiss.'),
    }),
    example: { commandId: 'notice-command-id' },
    requires: ['openGroup'],
    nextStep: 'dismissNotice',
    unavailable: ({ state }, input) => requireNotice(state, input?.commandId),
    run: (host, input) => host.dismissNotice(input.commandId),
  }),
};

export type AppActionName = keyof typeof appActions;

export type ActionInput<N extends AppActionName> = Parameters<
  (typeof appActions)[N]['execute']
>[1];

export type ActionOutput<N extends AppActionName> =
  Awaited<ReturnType<(typeof appActions)[N]['execute']>> extends Outcome<
    infer O
  >
    ? O
    : never;

// Correlates each name with its own input and output for generic dispatch.
type Catalog = {
  [N in AppActionName]: {
    availability(
      context: ActionContext,
      input?: ActionInput<N> | JsonValue,
    ): ActionAvailability;
    execute(
      host: ActionHost,
      input: ActionInput<N>,
      options: DispatchOptions,
      ui: AppUiState,
      platform: ActionPlatform,
      pendingConfirmation: ActionAvailability | undefined,
      executions: ActionExecutions,
      name: string,
    ): Promise<Outcome<ActionOutput<N>>>;
  };
};

const catalog: Catalog = appActions;

/** What one dispatch did, for observers such as logs or transcripts. */
export type DispatchRecord = {
  invocationId: string;
  parentInvocationId: string | null;
  durationMs: number;
  groupId: string | null;
  before: { view: UiState['view']; phase: UiState['phase'] };
  after: { view: UiState['view']; phase: UiState['phase'] };
  name: AppActionName;
  origin: string;
  status: Outcome<null>['status'];
  /** The failure code or confirmation message, when there is one. */
  detail: string | null;
};

export type Dispatcher = ReturnType<typeof createDispatcher>;

/** A description of one action that any caller can read, including assistants. */
export type ActionDescription = ReturnType<typeof describeActions>[number];

export function isActionName(name: string): name is AppActionName {
  return Object.hasOwn(appActions, name);
}

/** Binds the catalog to one host; every caller uses the result the same way. */
export function createDispatcher(
  host: ActionHost,
  options: DispatcherOptions = {},
) {
  const observers = new Set<(record: DispatchRecord) => void>();
  const executions = new ActionExecutions();

  const ui = new AppUiState(
    () => host.snapshot(),
    () => host.lastYouName(),
    options.initialLink,
  );

  const platform: ActionPlatform = { appUrl: options.appUrl ?? '', ...options };

  let pendingAvailability: {
    id: string;
    check: () => ActionAvailability;
  } | null = null;

  function confirmationAvailability(): ActionAvailability | undefined {
    return pendingAvailability?.id === ui.snapshot().confirmation?.id
      ? pendingAvailability?.check()
      : undefined;
  }

  async function dispatch<N extends AppActionName>(
    name: N,
    input: ActionInput<N>,
    options: DispatchOptions = {},
  ): Promise<Outcome<ActionOutput<N>>> {
    const invocationId = crypto.randomUUID();
    const started = Date.now();
    const before = { view: ui.snapshot().view, phase: ui.snapshot().phase };
    let stableInput: ActionInput<N>;

    try {
      stableInput = structuredClone(input);
    } catch {
      return {
        status: 'failed',
        error: 'invalid_input',
        issues: ['Input must be serializable action data.'],
      };
    }

    if (options.confirmed && ui.snapshot().confirmation?.name === name) {
      const pending = ui.snapshot().confirmation;

      if (pending) ui.cancelConfirmation(pending.id);
    }

    const targetGroup = host.snapshot().group?.group_id;
    const navigation = ui.snapshot().navigation.revision;

    const confirmationContext = (): ActionAvailability =>
      host.snapshot().group?.group_id === targetGroup && ui.snapshot().navigation.revision === navigation
        ? { available: true }
        : unavailable('confirmation_context_changed', 'Request confirmation again in the current group.');

    const result = await catalog[name].execute(
      host.forInvocation?.({ id: invocationId, groupId: targetGroup }) ?? host,
      stableInput,
      { ...options, invocationId },
      ui,
      platform,
      confirmationAvailability(),
      executions,
      name,
    );

    const outcome =
      result.status === 'needs_confirmation'
        ? {
            ...result,
            requestId: ui.requestConfirmation(
              name,
              result.message,
              async () => {
                const context = confirmationContext();

                if (!context.available) throw new Error(context.error);

                const confirmed = await dispatch(name, stableInput, {
                  ...options,
                  confirmed: true,
                  parentInvocationId: invocationId,
                });

                if (confirmed.status === 'failed')
                  throw new Error(confirmed.error);

                if (confirmed.status !== 'done')
                  throw new Error('confirmation_required');

                return;
              },
            ),
          }
        : result;

    if (outcome.status === 'needs_confirmation' && outcome.requestId)
      pendingAvailability = {
        id: outcome.requestId,
        check: () => {
          const context = confirmationContext();

          return context.available ? catalog[name].availability(
            { state: host.snapshot(), ui: ui.snapshot(), platform, executions: executions.snapshot() },
            stableInput,
          ) : context;
        },
      };

    const record: DispatchRecord = {
      invocationId,
      parentInvocationId: options.parentInvocationId ?? null,
      durationMs: Date.now() - started,
      groupId: targetGroup ?? null,
      before,
      after: { view: ui.snapshot().view, phase: ui.snapshot().phase },
      name,
      origin: options.origin ?? 'unspecified',
      status: outcome.status,
      detail:
        outcome.status === 'failed'
          ? outcome.error
          : outcome.status === 'needs_confirmation'
            ? outcome.message
            : null,
    };

    for (const observer of observers) {
      try {
        observer(record);
      } catch {
        // Diagnostics never change the result of an already executed action.
      }
    }

    return outcome;
  }

  /** For callers holding only names and JSON, such as RPC or an assistant. */
  async function dispatchJson(
    name: string,
    input: JsonValue,
    options: DispatchOptions = {},
  ): Promise<Outcome<ActionOutput<AppActionName>>> {
    if (!isActionName(name))
      return { status: 'failed', error: 'unknown_action', issues: [name] };

    // SAFETY: execute validates the input with the action's own schema before
    // using it, so an unchecked JSON value cannot reach the action.
    return dispatch(name, input as ActionInput<typeof name>, options);
  }

  function observe(observer: (record: DispatchRecord) => void): () => void {
    observers.add(observer);

    return () => observers.delete(observer);
  }

  /** Without input, reports state/capability checks; with input, validates it too. */
  function availability(
    name: AppActionName,
    input?: JsonValue,
  ): ActionAvailability {
    return appActions[name].availability(
      {
        state: host.snapshot(),
        ui: ui.snapshot(),
        platform,
        pendingConfirmation: confirmationAvailability(),
        executions: executions.snapshot(),
      },
      input,
    );
  }

  const descriptions = describeActions();

  function describe() {
    const context: ActionContext = {
      state: host.snapshot(), ui: ui.snapshot(), platform,
      pendingConfirmation: confirmationAvailability(), executions: executions.snapshot(),
    };

    return descriptions.map((action) => ({
      ...action,
      running: context.executions?.filter((entry) => entry.name === action.name) ?? [],
      availability: appActions[action.name].availability(context),
      suggested: appActions[action.name].suggestion(context),
      workflowEffect: action.workflow ? workflowEffect(context.ui, action.workflow) : null,
    }));
  }

  function stateActionMap() {
    const state = ui.snapshot();

    return {
      current: { view: state.view, phase: state.phase },
      completions: workflowCompletions(state),
      executions: executions.snapshot(),
      actions: describe(),
    };
  }

  return {
    dispatch,
    dispatchJson,
    availability,
    inputOptions: (source: ValueSource) => sourceOptions(source, { ...host.snapshot(), ui: ui.snapshot() }, platform.appUrl),
    describe,
    stateActionMap,
    observe,
    observeDiagnostics: (observer: ClientDiagnosticObserver) => host.client.observeDiagnostics?.(observer) ?? (() => undefined),
    ui: { snapshot: ui.snapshot, subscribe: ui.subscribe },
    capabilities: {
      copyLink: Boolean(platform.copyLink),
      shareLink: Boolean(platform.shareLink),
    },
    executions: { snapshot: executions.snapshot, subscribe: executions.subscribe },
    state: () => ({ ...host.snapshot(), ui: ui.snapshot(), executions: executions.snapshot() }),
  };
}

/** Every action's description, for any caller; it needs no app state. */
export function describeActions() {
  return Object.entries(appActions).flatMap(([name, action]) =>
    isActionName(name)
      ? [
          {
            name,
            group: action.group,
            description: action.description,
            requires: action.requires,
            workflow: action.workflow,
            nextStep: action.nextStep,
            confirms: action.confirms,
            // SAFETY: examples are literal inputs of their own schemas,
            // which accept only JSON-compatible values.
            example: action.example as JsonValue,
            inputSchema: z.toJSONSchema(action.input),
          },
        ]
      : [],
  );
}
