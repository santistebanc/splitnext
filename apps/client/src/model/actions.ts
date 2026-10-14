import { z } from 'zod';
import {
  groupNameSchema,
  identifierSchema,
  memberNameSchema,
  parseInviteLink,
  type InvitePreview,
  type JsonValue,
} from '@splitnext/client';
import type { AppController, AppState } from './controller';

/**
 * Everything a person can do in the app, callable the same way by any caller:
 * UI events, an assistant, RPC, tests, or the workbench. See ADR 0016.
 */

/** The controller surface actions run against, so fakes can host them too. */
export type ActionHost = Pick<
  AppController,
  | 'snapshot'
  | 'createGroup'
  | 'joinGroup'
  | 'openGroup'
  | 'openJoinedGroup'
  | 'showGroups'
  | 'renameGroup'
  | 'addPerson'
  | 'renamePerson'
  | 'archivePerson'
  | 'selectPerson'
  | 'regenerateInvite'
  | 'leaveGroup'
  | 'applyAgain'
  | 'dismissNotice'
> & { client: Pick<AppController['client'], 'previewInvite'> };

/** Conditions checked before an action runs, the same for every caller. */
export type Requirement = 'online' | 'reachable' | 'openGroup';

/** The single result shape every caller receives. Actions never throw. */
export type Outcome<O> =
  | { status: 'done'; value: O }
  | { status: 'needs_confirmation'; message: string }
  | { status: 'failed'; error: string; issues: string[] };

export type DispatchOptions = {
  /** The person approved this action's confirmation message. */
  confirmed?: boolean;
  /** Who invoked it, for observers and future audit attribution only. */
  origin?: string;
};

type ActionSpec<S extends z.ZodType, O> = {
  description: string;
  input: S;
  /** A valid input, for documentation, assistants, and the workbench. */
  example: z.input<S>;
  requires?: readonly Requirement[];
  /** A message the person must approve first, or null when none is needed. */
  confirm?: (input: z.output<S>, state: AppState) => string | null;
  run: (host: ActionHost, input: z.output<S>) => Promise<O>;
};

function defineAction<S extends z.ZodType, O>(spec: ActionSpec<S, O>) {
  return {
    description: spec.description,
    input: spec.input,
    example: spec.example,
    requires: spec.requires ?? [],
    confirms: Boolean(spec.confirm),
    async execute(
      host: ActionHost,
      raw: z.input<S>,
      options: DispatchOptions,
    ): Promise<Outcome<O>> {
      const parsed = spec.input.safeParse(raw);

      if (!parsed.success)
        return {
          status: 'failed',
          error: 'invalid_input',
          issues: parsed.error.issues.map(
            (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
          ),
        };

      const state = host.snapshot();
      const unmet = (spec.requires ?? []).find((need) => !meets(need, state));

      if (unmet)
        return {
          status: 'failed',
          error: unmet === 'openGroup' ? 'no_open_group' : 'client_offline',
          issues: [],
        };

      const message = spec.confirm?.(parsed.data, state) ?? null;

      if (message && !options.confirmed)
        return { status: 'needs_confirmation', message };

      try {
        return { status: 'done', value: await spec.run(host, parsed.data) };
      } catch (cause) {
        return {
          status: 'failed',
          error: cause instanceof Error ? cause.message : 'request_failed',
          issues: [],
        };
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
  }
}

function openSnapshot(state: AppState) {
  return state.group?.projected_snapshot ?? null;
}

const empty = z.object({});

const memberChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), memberId: identifierSchema }),
  z.object({ kind: z.literal('new'), name: memberNameSchema }),
]);

export type InviteCheck =
  | { opened: true }
  | { opened: false; groupId: string; token: string; preview: InvitePreview };

export const appActions = {
  createGroup: defineAction({
    description:
      'Create a group and join it as a new member with your name; it opens.',
    input: z.object({ name: groupNameSchema, yourName: memberNameSchema }),
    example: { name: 'Lisbon weekend', yourName: 'Ana' },
    requires: ['reachable'],
    run: (host, input) =>
      host.createGroup({
        name: input.name,
        creator_member_name: input.yourName,
      }),
  }),
  checkInvite: defineAction({
    description:
      'Read an invite link. Opens the group if this installation already ' +
      'joined it; otherwise returns the group and members to choose from.',
    input: z.object({ link: z.string().trim().min(1) }),
    example: { link: 'https://splitnext.app/join/uy9ogmKJRD2VRfbN4PDsAw#…' },
    requires: ['online'],
    run: async (host, input): Promise<InviteCheck> => {
      const parsed = parseInviteLink(input.link);

      if (!parsed) throw new Error('invite_invalid');

      if (await host.openJoinedGroup(parsed.group_id)) return { opened: true };

      return {
        opened: false,
        groupId: parsed.group_id,
        token: parsed.token,
        preview: await host.client.previewInvite(parsed.group_id, parsed.token),
      };
    },
  }),
  joinGroup: defineAction({
    description:
      'Join or rejoin a group as an existing member or as someone new. ' +
      'A token is needed unless rejoining a group this installation left.',
    input: z.object({
      groupId: identifierSchema,
      as: memberChoiceSchema,
      token: z.string().optional(),
    }),
    example: {
      groupId: 'uy9ogmKJRD2VRfbN4PDsAw',
      as: { kind: 'new', name: 'Ana' },
    },
    requires: ['online'],
    run: (host, input) =>
      host.joinGroup(
        input.groupId,
        input.as.kind === 'new'
          ? { kind: 'new', display_name: input.as.name }
          : { kind: 'existing', member_id: input.as.memberId },
        input.token,
      ),
  }),
  openGroup: defineAction({
    description: 'Open one of this installation’s groups.',
    input: z.object({ groupId: z.string().min(1) }),
    example: { groupId: 'uy9ogmKJRD2VRfbN4PDsAw' },
    run: (host, input) => host.openGroup(input.groupId),
  }),
  closeGroup: defineAction({
    description: 'Close the open group and show the groups list.',
    input: empty,
    example: {},
    run: async (host) => host.showGroups(),
  }),
  renameGroup: defineAction({
    description: 'Rename the open group.',
    input: z.object({
      name: groupNameSchema,
      /** The name the person saw; defaults to the current name. */
      expectedName: z.string().optional(),
    }),
    example: { name: 'Lisbon long weekend' },
    requires: ['openGroup'],
    run: (host, input) =>
      host.renameGroup(
        input.name,
        input.expectedName ?? openSnapshot(host.snapshot())?.group.name ?? '',
      ),
  }),
  addMember: defineAction({
    description: 'Add a member to the open group.',
    input: z.object({ name: memberNameSchema }),
    example: { name: 'Ben' },
    requires: ['openGroup'],
    run: (host, input) => host.addPerson(input.name),
  }),
  renameMember: defineAction({
    description: 'Rename a member of the open group.',
    input: z.object({
      memberId: z.string().min(1),
      name: memberNameSchema,
      /** The name the person saw; defaults to the member's current name. */
      expectedName: z.string().optional(),
    }),
    example: { memberId: 'member-2', name: 'Benjamin' },
    requires: ['openGroup'],
    run: (host, input) =>
      host.renamePerson(
        input.memberId,
        input.name,
        input.expectedName ??
          openSnapshot(host.snapshot())?.members.find(
            (member) => member.id === input.memberId,
          )?.display_name ??
          '',
      ),
  }),
  removeMember: defineAction({
    description:
      'Remove a member from the open group. Their name stays in history.',
    input: z.object({ memberId: z.string().min(1) }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    run: (host, input) => host.archivePerson(input.memberId),
  }),
  selectYou: defineAction({
    description:
      'Choose which member is you on this installation. Asks first when ' +
      'another participant already uses that member.',
    input: z.object({ memberId: z.string().min(1) }),
    example: { memberId: 'member-1' },
    requires: ['openGroup'],
    confirm: (input, state) => {
      const self = state.group?.session?.identity.id;

      const others = (openSnapshot(state)?.access_grants ?? []).filter(
        (grant) =>
          grant.preferred_member_id === input.memberId &&
          grant.identity_id !== self &&
          !grant.hidden_at,
      );

      return others.length
        ? `${others.map((grant) => grant.actor_handle).join(', ')} already ${others.length === 1 ? 'uses' : 'use'} this name.`
        : null;
    },
    run: (host, input) => host.selectPerson(input.memberId),
  }),
  replaceInviteLink: defineAction({
    description:
      'Replace the open group’s invite link with a new one for everyone.',
    input: empty,
    example: {},
    requires: ['online', 'openGroup'],
    confirm: () => 'The current link will stop working.',
    run: (host) => host.regenerateInvite(),
  }),
  leaveGroup: defineAction({
    description:
      'Leave the open group on this installation. It can be rejoined later.',
    input: empty,
    example: {},
    requires: ['online', 'openGroup'],
    confirm: () => 'Leave this group?',
    run: (host) => host.leaveGroup(),
  }),
  applyChangeAgain: defineAction({
    description: 'Retry a rejected or superseded change from its notice.',
    input: z.object({ commandId: z.string().min(1) }),
    example: { commandId: 'notice-command-id' },
    requires: ['openGroup'],
    run: (host, input) => host.applyAgain(input.commandId),
  }),
  dismissNotice: defineAction({
    description: 'Dismiss a rejected or superseded change notice.',
    input: z.object({ commandId: z.string().min(1) }),
    example: { commandId: 'notice-command-id' },
    requires: ['openGroup'],
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
    execute(
      host: ActionHost,
      input: ActionInput<N>,
      options: DispatchOptions,
    ): Promise<Outcome<ActionOutput<N>>>;
  };
};

const catalog: Catalog = appActions;

/** What one dispatch did, for observers such as logs or transcripts. */
export type DispatchRecord = {
  name: AppActionName;
  origin: string;
  status: Outcome<null>['status'];
  /** The failure code or confirmation message, when there is one. */
  detail: string | null;
};

export type Dispatcher = ReturnType<typeof createDispatcher>;

/** A description of one action that any caller can read, including assistants. */
export type ActionDescription = ReturnType<Dispatcher['describe']>[number];

export function isActionName(name: string): name is AppActionName {
  return Object.hasOwn(appActions, name);
}

/** Binds the catalog to one host; every caller uses the result the same way. */
export function createDispatcher(host: ActionHost) {
  const observers = new Set<(record: DispatchRecord) => void>();

  async function dispatch<N extends AppActionName>(
    name: N,
    input: ActionInput<N>,
    options: DispatchOptions = {},
  ): Promise<Outcome<ActionOutput<N>>> {
    const outcome = await catalog[name].execute(host, input, options);

    const record: DispatchRecord = {
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

    for (const observer of observers) observer(record);

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

  function describe() {
    return Object.entries(appActions).flatMap(([name, action]) =>
      isActionName(name)
        ? [
            {
              name,
              description: action.description,
              requires: action.requires,
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

  function observe(observer: (record: DispatchRecord) => void): () => void {
    observers.add(observer);

    return () => observers.delete(observer);
  }

  return {
    dispatch,
    dispatchJson,
    describe,
    observe,
    state: () => host.snapshot(),
  };
}
