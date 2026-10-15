import type { ActionExecutions, PendingExecution } from '../executions';
import { z } from 'zod';
import { activeMembers, type JsonValue } from '@splitnext/client';
import type { ActionInvocation, AppController, AppState } from '../controller';
import type { AppUiState, UiState } from '../uiState';
import type { ValueSource } from '../actionInputs';
import { isSubmission, workflowGuard, type WorkflowIntent } from '../workflow';

/**
 * How an app action is declared, and the requirement checks actions share.
 * The catalog itself is assembled in ../actions.ts. See ADR 0016.
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
> & Partial<Pick<AppController, 'subscribe'>> & {
  forInvocation?: (invocation: ActionInvocation) => ActionHost;
  client: Pick<AppController['client'], 'previewInvite'> & Partial<Pick<AppController['client'], 'observeDiagnostics'>>;
};

/** Conditions checked before an action runs, the same for every caller. */
export type Requirement =
  'online' | 'reachable' | 'openGroup' | 'selectedGroup';

export const actionGroups = ['UI', 'Ledger changes', 'Access & sync'] as const;

export type ActionGroup = (typeof actionGroups)[number];

/** Effects and services outside the catalog that actions may use. */
export type ActionPlatform = {
  appUrl: string;
  copyText?: (text: string) => Promise<void>;
  shareLink?: (link: string, title: string) => Promise<void>;
  openHomepage?: () => void;
  /** The dispatcher's diagnostics report; see DiagnosticsLog. */
  diagnosticsReport?: () => string;
};

export type DispatcherOptions = Partial<Omit<ActionPlatform, 'diagnosticsReport'>> & { initialLink?: string };

export type ActionAvailability =
  | { available: true }
  | { available: false; error: string; reason: string; issues: string[] };

export type ActionContext = {
  state: AppState;
  ui: UiState;
  platform: ActionPlatform;
  pendingConfirmation?: ActionAvailability | undefined;
  executions?: readonly PendingExecution[];
};

export type BlockedAction = Exclude<ActionAvailability, { available: true }>;

export function unavailable(error: string, reason: string): BlockedAction {
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

export type ActionSpec<S extends z.ZodType, O> = {
  group: ActionGroup;
  description: string;
  input: S;
  /** A valid input, for documentation, assistants, and the workbench. */
  example: z.input<S>;
  /** Connection and group conditions. */
  requires?: readonly Requirement[];
  /** The workflow step this action takes; its transition must be allowed. */
  workflow?: WorkflowIntent;
  /** Locks held while this action runs; actions needing them are unavailable. */
  holds?: Locks<S>;
  /** Locks that must be free without being held, such as a draft a save is finishing. */
  waitsFor?: Locks<S>;
  /** Any other reason it cannot run; omitted input checks whether any input can. */
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

export type Locks<S extends z.ZodType> = (
  context: ActionContext,
  input: z.output<S> | undefined,
) => readonly string[];

/** The member row editor, locked while a member save finishes it. */
export const editorLock = 'memberEditor';

/**
 * Held by a navigation that changes the open group, which decides the next
 * view. Every workflow step waits for it, so none starts on a view about to be
 * replaced; switching panels within a group is instant and does not hold it.
 */
export const navigationLock = 'navigation';

export function defineAction<S extends z.ZodType, O>(spec: ActionSpec<S, O>) {
  function holds(context: ActionContext, input?: z.output<S>): readonly string[] {
    return spec.holds?.(context, input) ?? [];
  }

  /**
   * The one answer to whether this action can run, for every caller and the
   * UI alike, checked in order: its workflow step, locks held by running
   * actions, requirements, then its own conditions.
   */
  function check(
    context: ActionContext,
    input?: z.output<S>,
  ): ActionAvailability {
    const workflow = spec.workflow
      ? workflowGuard(context.ui, spec.workflow)
      : null;

    if (workflow) return unavailable(workflow.error, workflow.reason);

    const needed = [
      ...holds(context, input),
      ...(spec.waitsFor?.(context, input) ?? []),
      // Navigating away would discard the editor a running save finishes.
      ...(spec.workflow === 'navigate' ? [editorLock] : []),
      ...(spec.workflow ? [navigationLock] : []),
    ];

    const pending = context.executions?.find((entry) => entry.resources.some((resource) => needed.includes(resource)));

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
    confirms: Boolean(spec.confirm),
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
      const state = host.snapshot();

      const context: ActionContext = { state, ui: ui.snapshot(), platform, pendingConfirmation, executions: executions.snapshot() };

      // The same checks, in the same order, as availability().
      const base = check(context);
      const parsed = base.available ? validate(raw) : base;

      if ('available' in parsed)
        return { status: 'failed', error: parsed.error, issues: parsed.issues };

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

      const execution = executions.start(name, options.origin ?? 'unspecified', holds(context, parsed.data), options.invocationId);

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

export function meets(requirement: Requirement, state: AppState): boolean {
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

/** One of this installation's groups, with a local copy unless online. */
export function requireOpenable(state: AppState, groupId?: string): BlockedAction | null {
  const current = state.group && (groupId === undefined || state.group.group_id === groupId);
  const saved = state.groups.find((group) => groupId === undefined || group.group_id === groupId);

  if (!current && !saved) return unavailable('group_not_found', 'Choose a saved group.');

  if (!current && saved && !saved.stored_locally && !state.online)
    return unavailable('client_offline', 'Go online to open this group.');

  return null;
}

export function openSnapshot(state: AppState) {
  return state.group?.projected_snapshot ?? null;
}

export function requireMember(
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

export function requireNotice(
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

export function requireJoin(context: ActionContext): BlockedAction | null {
  const { ui, state } = context;

  if (ui.view === 'rejoin' ? !state.group?.hidden : !ui.join.preview)
    return unavailable('join_choice_required', 'Check an invite link first.');

  return null;
}

export function joinMembers({ ui, state }: Pick<ActionContext, 'ui' | 'state'>) {
  return ui.view === 'rejoin'
    ? activeMembers(openSnapshot(state))
    : (ui.join.preview?.members ?? []);
}

export function requireConfirmation(
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

export function requireInvite(
  context: ActionContext,
  kind: 'copyText' | 'shareLink',
): BlockedAction | null {
  if (!context.platform[kind])
    return unavailable(
      'platform_unavailable',
      kind === 'copyText'
        ? 'Clipboard is unavailable on this device.'
        : 'Sharing is unavailable on this device.',
    );

  return openSnapshot(context.state)?.invite && context.platform.appUrl
    ? null
    : unavailable('invite_invalid', 'The invite link is not available yet.');
}

export function requireName(
  schema: z.ZodString,
  name: string,
  label: string,
): BlockedAction | null {
  return schema.safeParse(name).success
    ? null
    : unavailable('invalid_input', `Enter a valid ${label}.`);
}

export function memberResource(state: AppState, memberId: string | undefined | null): string[] {
  return memberId ? [`member:${state.group?.group_id}:${memberId}`] : [];
}

export function noticeResources(state: AppState, commandId?: string): string[] {
  const notice = state.group?.notices.find((entry) => entry.command.command_id === commandId);

  if (!notice) return [];
  const target = notice.outcome.target;

  return [`notice:${state.group?.group_id}:${commandId}`,
    ...(target.kind === 'member' ? memberResource(state, target.id) : target.kind === 'group' ? [`groupName:${state.group?.group_id}`] : [])];
}

export const empty = z.object({});

/**
 * Where the values a field can take come from in app state, published in each
 * field's JSON Schema so any caller (a form, an assistant) can offer them.
 * `choices` means the value must be one of them; `suggestions` only helps.
 */
export function choice(source: ValueSource, description: string) {
  return z.string().min(1).meta({ description, choices: source });
}

export function suggested<S extends z.ZodString>(
  schema: S,
  source: ValueSource,
  description: string,
) {
  return schema.meta({ description, suggestions: source });
}
