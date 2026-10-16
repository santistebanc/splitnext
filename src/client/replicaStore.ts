import { commandForRetry } from './commandRetry';
import { activeMembers, preferredMember } from '../domain/selectors';
import type { JoinGroupRequest, PreferredMemberChoice } from '../domain/access';
import {
  applyGroupCommand,
  requiresServerDecision,
  resolveMemberAliases,
  type CommandOutcome,
  type GroupCommand,
} from '../domain/commands';
import type {
  AccessibleGroup,
  CreatedGroup,
  CreateGroupRequest,
} from '../domain/groups';
import type { IdentitySession } from '../domain/identities';
import { createInviteToken, type GroupInvite } from '../domain/invites';
import { upgradeClientStorage } from './storageUpgrade';
import type {
  GroupSession,
  GroupSnapshot,
  SyncGroupRequest,
  SyncGroupResponse,
} from '../domain/sync';
import {
  withStorageErrors,
  type ClientGroupReplica,
  type ClientStorageAdapter,
  type ClientStorageDocument,
  type PendingInvite,
  parseClientDocument,
  type PendingCommand,
  serializeClientDocument,
} from './storage';

export type ClientGroupCreationInput = Omit<
  CreateGroupRequest,
  'group_id' | 'invite'
> & { group_id?: string };

export type ClientReplicaState = {
  online: boolean;
  session: IdentitySession | null;
  group_id: string;
  revision: number | null;
  confirmed_snapshot: GroupSnapshot | null;
  projected_snapshot: GroupSnapshot | null;
  outbox: ClientGroupReplica['outbox'];
  notices: ClientGroupReplica['notices'];
  hidden: boolean;
  last_synced_at: string | null;
};

/** One entry in a device's list of groups. */
export type ClientGroupSummary = {
  group_id: string;
  name: string;
  status: 'active' | 'left';
  /** Whether this device holds a copy; others are fetched when opened. */
  stored_locally: boolean;
  pending_commands: number;
  /** Active members in the local copy; null until the group is stored here. */
  member_count: number | null;
  /** The member this identity calls “you” in the local copy, if any. */
  you_name: string | null;
};

/** One coherent local document read, with only the requested full replicas. */
export type ClientInstallationState = {
  groups: ClientGroupSummary[];
  notice_counts: Record<string, number>;
  replicas: ClientReplicaState[];
};

export type PreparedSync = {
  request: SyncGroupRequest;
  commands: PendingCommand[];
};

/** Intent saved to the outbox, with the replica as that same update left it. */
export type QueuedCommand = {
  pending: PendingCommand;
  state: ClientReplicaState;
};

/**
 * The device's durable local state. Each operation's last write also returns
 * the replica it produced, so a caller never reads again after its commit
 * point: an operation that fails locally has changed nothing, and one whose
 * write succeeded cannot be reported as failed.
 */
export class ClientReplicaStore {
  private readonly storage: ClientStorageAdapter;

  constructor(
    storage: ClientStorageAdapter,
    private readonly now: () => string,
    private readonly online: () => boolean,
  ) {
    this.storage = withStorageErrors(storage);
  }

  session(): Promise<IdentitySession | null> {
    return this.read((document) => document.session);
  }

  upgradeStorage(
    online: boolean,
    refresh: (
      groupId: string,
    ) => Promise<{ revision: number; snapshot: GroupSnapshot }>,
  ): Promise<void> {
    return upgradeClientStorage(this.storage, online, refresh);
  }

  retainSession(session: IdentitySession): Promise<IdentitySession> {
    return this.change((document) => {
      if (
        document.session &&
        (document.session.identity.id !== session.identity.id ||
          document.session.device.id !== session.device.id)
      ) {
        throw new TypeError('identity_session_conflict');
      }

      document.session ??= session;

      return document.session;
    });
  }

  prepareGroupCreation(
    input: ClientGroupCreationInput,
    createId: () => string,
  ): Promise<CreateGroupRequest> {
    return this.change((document) => {
      requireIdentity(document);

      const pending = document.pending_group_creations[0];

      const requested = {
        name: input.name,
        creator_member_name: input.creator_member_name,
        group_id: input.group_id ?? pending?.request.group_id ?? createId(),
        invite: pending?.request.invite ?? {
          invite_id: createId(),
          token: createInviteToken(),
        },
      };

      if (pending && !sameCreationInput(pending.request, requested)) {
        throw new Error('pending_group_creation_conflict');
      }

      if (!pending) {
        document.pending_group_creations.push({ request: requested });
      }

      return pending?.request ?? requested;
    });
  }

  rejectGroupCreation(request: CreateGroupRequest): Promise<void> {
    return this.change((document) => {
      document.pending_group_creations =
        document.pending_group_creations.filter(
          (candidate) => candidate.request.group_id !== request.group_id,
        );
    });
  }

  confirmGroupCreation(created: CreatedGroup): Promise<ClientReplicaState> {
    return this.change((document) => {
      const pending = document.pending_group_creations.find(
        (candidate) => candidate.request.group_id === created.group.id,
      );

      // Discovery or another tab may already have synchronized this group.
      // Keep that newer replica, but retain our creation token while its
      // invite is still current, even if synchronization arrived first.
      const existing = document.groups.find(
        (group) => group.group_id === created.group.id,
      );

      if (!existing) {
        if (!pending || pending.request.invite.invite_id !== created.invite.id)
          throw new Error('group_creation_invite_mismatch');

        const snapshot: GroupSnapshot = {
          group: {
            id: created.group.id,
            name: created.group.name,
            created_at: created.group.created_at,
          },
          members: [created.member],
          access_grants: [created.access],
          invite: created.invite,
        };

        upsertReplica(document, {
          group_id: created.group.id,
          revision: created.group.revision,
          snapshot,
          outbox: [],
          notices: [],
          last_synced_at: this.now(),
        });
      }

      document.pending_group_creations =
        document.pending_group_creations.filter(
          (candidate) => candidate.request.group_id !== created.group.id,
        );

      return stateFrom(document, created.group.id, this.online());
    });
  }

  prepareJoin(
    groupId: string,
    preferredMember:
      | PreferredMemberChoice
      | { kind: 'new'; display_name: string },
    createId: () => string,
    inviteToken?: string,
  ): Promise<JoinGroupRequest> {
    return this.change((document) => {
      requireIdentity(document);

      const existing = document.pending_joins.find(
        (candidate) => candidate.group_id === groupId,
      );

      // A retry keeps its join id, so the server answers it at most once, but
      // carries the newest link: the one a lost request held may be replaced.
      if (existing) {
        if (inviteToken) existing.request.invite_token = inviteToken;

        return existing.request;
      }

      const preferred: PreferredMemberChoice =
        preferredMember.kind === 'existing'
          ? preferredMember
          : {
              ...preferredMember,
              member_id: createId(),
            };

      const request: JoinGroupRequest = {
        join_id: createId(),
        preferred_member: preferred,
      };

      if (inviteToken) request.invite_token = inviteToken;

      document.pending_joins.push({ group_id: groupId, request });

      return request;
    });
  }

  rejectJoin(groupId: string, joinId: string): Promise<void> {
    return this.change((document) => {
      document.pending_joins = document.pending_joins.filter(
        (candidate) =>
          candidate.group_id !== groupId ||
          candidate.request.join_id !== joinId,
      );
    });
  }

  confirmJoin(groupId: string, joined: GroupSession): Promise<ClientReplicaState> {
    return this.change((document) => {
      const existing = document.groups.find(
        (candidate) => candidate.group_id === groupId,
      );

      const current = existing && existing.revision > joined.revision ? existing : joined;

      // Rejoining keeps unreviewed notices and intent queued meanwhile.
      upsertReplica(document, {
        group_id: groupId,
        revision: current.revision,
        snapshot: current.snapshot,
        outbox: existing?.outbox ?? [],
        notices: existing?.notices ?? [],
        last_synced_at: this.now(),
      });
      document.pending_joins = document.pending_joins.filter(
        (candidate) => candidate.group_id !== groupId,
      );

      return stateFrom(document, groupId, this.online());
    });
  }

  retainGroupDirectory(groups: AccessibleGroup[]): Promise<void> {
    return this.change((document) => {
      document.group_directory = groups;
    });
  }

  /**
   * Every group this identity can access that the device knows of: local
   * copies, whose projected state is freshest, plus groups only the server's
   * last list mentioned.
   */
  groupSummaries(): Promise<ClientGroupSummary[]> {
    return this.read(summariesFrom);
  }

  installationState(groupIds: readonly string[]): Promise<ClientInstallationState> {
    return this.read((document) => ({
      groups: summariesFrom(document),
      notice_counts: Object.fromEntries(document.groups.map((replica) => [replica.group_id, replica.notices.length])),
      replicas: [...new Set(groupIds)].map((groupId) => stateFrom(document, groupId, this.online())),
    }));
  }

  /** Reuses an unconfirmed invite so a lost response cannot rotate it twice. */
  prepareInvite(
    groupId: string,
    createId: () => string,
    createToken: () => string,
  ): Promise<PendingInvite> {
    return this.change((document) => {
      requireReplica(document, groupId);

      const existing = document.pending_invites.find(
        (candidate) => candidate.group_id === groupId,
      );

      if (existing) {
        return existing;
      }

      const invite: PendingInvite = {
        group_id: groupId,
        invite_id: createId(),
        token: createToken(),
      };

      document.pending_invites.push(invite);

      return invite;
    });
  }

  /**
   * Retires a pending replacement. A confirmed one becomes the local link
   * until the next synchronization replaces the whole snapshot, unless that
   * already happened.
   */
  settleInvite(
    groupId: string,
    inviteId: string,
    confirmed?: { revision: number; invite: GroupInvite },
  ): Promise<ClientReplicaState> {
    return this.change((document) => {
      document.pending_invites = document.pending_invites.filter(
        (candidate) =>
          candidate.group_id !== groupId || candidate.invite_id !== inviteId,
      );

      const replica = document.groups.find((candidate) => candidate.group_id === groupId);

      if (confirmed && replica && replica.revision < confirmed.revision)
        replica.snapshot = { ...replica.snapshot, invite: confirmed.invite };

      return stateFrom(document, groupId, this.online());
    });
  }

  queueCommand(
    groupId: string,
    createCommand: (snapshot: GroupSnapshot) => GroupCommand,
    invocationId?: string,
  ): Promise<QueuedCommand> {
    return this.change((document) => {
      const session = requireIdentity(document);
      const replica = requireReplica(document, groupId);

      const pending: PendingCommand = {
        command: createCommand(project(replica, session.identity.id)),
        queued_at: this.now(),
      };

      if (invocationId) pending.invocation_id = invocationId;
      replica.outbox.push(pending);

      return { pending, state: stateFrom(document, groupId, this.online()) };
    });
  }

  /**
   * A group the identity can access but this device has never stored, such as
   * one listed by the server, is fetched as a complete snapshot.
   */
  prepareSync(
    groupId: string,
    includeLeft = false,
  ): Promise<PreparedSync | null> {
    return this.read((document) => {
      const session = requireIdentity(document);

      const replica = document.groups.find(
        (candidate) => candidate.group_id === groupId,
      );

      if (!replica) {
        return {
          request: { known_revision: null, commands: [] },
          commands: [],
        };
      }

      const access = accessFor(replica.snapshot, session.identity.id);

      if (!includeLeft && access?.hidden_at && replica.outbox.length === 0) {
        return null;
      }

      const commands = structuredClone(replica.outbox);

      return {
        request: {
          known_revision: replica.revision,
          commands: commands.map((pending) => pending.command),
        },
        commands,
      };
    });
  }

  reconcile(
    groupId: string,
    sentCommands: readonly PendingCommand[],
    response: SyncGroupResponse,
  ): Promise<ClientReplicaState> {
    return this.change((document) => {
      const replica = document.groups.find(
        (candidate) => candidate.group_id === groupId,
      );

      if (!replica) {
        if (response.state.kind === 'snapshot') {
          upsertReplica(document, {
            group_id: groupId,
            revision: response.revision,
            snapshot: response.state.snapshot,
            outbox: [],
            notices: [],
            last_synced_at: this.now(),
          });
          settleJoins(document, groupId, response.state.snapshot);
        }

        return stateFrom(document, groupId, this.online());
      }

      const acknowledged = new Set(
        response.outcomes.map((outcome) => outcome.command_id),
      );

      const sentById = new Map(
        sentCommands.map((pending) => [
          pending.command.command_id,
          pending.command,
        ]),
      );

      // An outcome is recorded once, by the update that takes its command out
      // of the outbox. Another tab's synchronization may have done so first,
      // and the person may since have retried or dismissed its notice.
      const queued = new Set(
        replica.outbox.map((pending) => pending.command.command_id),
      );

      for (const outcome of response.outcomes) {
        if (outcome.status !== 'rejected' && outcome.status !== 'superseded') {
          continue;
        }

        if (!queued.has(outcome.command_id)) continue;

        const command = sentById.get(outcome.command_id);

        if (!command) throw new Error('sync_outcome_without_sent_command');

        replica.notices.push({
          command,
          outcome,
          recorded_at: this.now(),
        });
      }

      const aliases = mergedMemberAliases(response.outcomes, sentById);

      // Commands queued during this synchronization were never sent, so they
      // can safely name the member a merged creation resolved to.
      replica.outbox = replica.outbox
        .filter((pending) => !acknowledged.has(pending.command.command_id))
        .map((pending) => ({
          ...pending,
          command: resolveMemberAliases(pending.command, aliases),
        }));

      if (response.revision >= replica.revision) {
        replica.revision = response.revision;

        if (response.state.kind === 'snapshot') {
          replica.snapshot = response.state.snapshot;
        }
      }

      replica.last_synced_at = this.now();
      settleJoins(document, groupId, replica.snapshot);

      return stateFrom(document, groupId, this.online());
    });
  }

  state(groupId: string): Promise<ClientReplicaState> {
    return this.read((document) => stateFrom(document, groupId, this.online()));
  }

  /** Queue fresh intent and retire its notice in one atomic local update. */
  retryNotice(
    groupId: string,
    commandId: string,
    createId: () => string,
    requireOnline: () => void,
    invocationId?: string,
  ): Promise<QueuedCommand> {
    return this.change((document) => {
      const session = requireIdentity(document);
      const replica = requireReplica(document, groupId);
      const notice = replica.notices.find((entry) => entry.command.command_id === commandId);

      if (!notice) throw new Error('notice_not_found');

      if (requiresServerDecision(notice.command.type)) requireOnline();
      const command = commandForRetry(notice, project(replica, session.identity.id), createId);

      const pending: PendingCommand = { command, queued_at: this.now() };

      if (invocationId) pending.invocation_id = invocationId;
      replica.outbox.push(pending);
      replica.notices = replica.notices.filter((entry) => entry !== notice);

      return { pending, state: stateFrom(document, groupId, this.online()) };
    });
  }

  dismissNotice(groupId: string, commandId: string): Promise<ClientReplicaState> {
    return this.change((document) => {
      const replica = requireReplica(document, groupId);

      replica.notices = replica.notices.filter(
        (notice) => notice.outcome.command_id !== commandId,
      );

      return stateFrom(document, groupId, this.online());
    });
  }

  private read<T>(
    operation: (document: ClientStorageDocument) => T,
  ): Promise<T> {
    return this.storage.read().then((serialized) => {
      const document = parseClientDocument(serialized);

      return structuredClone(operation(document));
    });
  }

  private change<T>(operation: (document: ClientStorageDocument) => T): Promise<T> {
    return this.storage.update((serialized) => {
      const document = parseClientDocument(serialized);
      const result = operation(document);

      return { serialized: serializeClientDocument(document), result: structuredClone(result) };
    });
  }
}

function summariesFrom(document: ClientStorageDocument): ClientGroupSummary[] {
  const session = document.session;

  const local = session
    ? document.groups.map((replica): ClientGroupSummary => {
        const projection = project(replica, session.identity.id);
        const access = accessFor(projection, session.identity.id);

        const active = activeMembers(projection);

        return {
          group_id: replica.group_id,
          name: projection.group.name,
          status: access?.hidden_at ? 'left' : 'active',
          stored_locally: true,
          pending_commands: replica.outbox.length,
          member_count: active.length,
          you_name:
            preferredMember(projection, session.identity.id)?.display_name ?? null,
        };
      })
    : [];

  const localIds = new Set(local.map(({ group_id }) => group_id));

  const remoteOnly = document.group_directory
    .filter(({ group_id }) => !localIds.has(group_id))
    .map(
      (group): ClientGroupSummary => ({
        group_id: group.group_id,
        name: group.name,
        status: group.status,
        stored_locally: false,
        pending_commands: 0,
        member_count: null,
        you_name: null,
      }),
    );

  return [...local, ...remoteOnly].sort(
    (left, right) =>
      Number(left.status === 'left') - Number(right.status === 'left') ||
      left.name.localeCompare(right.name),
  );
}

function stateFrom(
  document: ClientStorageDocument,
  groupId: string,
  online: boolean,
): ClientReplicaState {
  const replica = document.groups.find(
    (candidate) => candidate.group_id === groupId,
  );

  if (!replica || !document.session) {
    return {
      online,
      session: document.session,
      group_id: groupId,
      revision: null,
      confirmed_snapshot: null,
      projected_snapshot: null,
      outbox: [],
      notices: [],
      hidden: false,
      last_synced_at: null,
    };
  }

  const projection = project(replica, document.session.identity.id);
  const access = accessFor(projection, document.session.identity.id);

  return {
    online,
    session: document.session,
    group_id: groupId,
    revision: replica.revision,
    confirmed_snapshot: structuredClone(replica.snapshot),
    projected_snapshot: projection,
    outbox: structuredClone(replica.outbox),
    notices: structuredClone(replica.notices),
    hidden: Boolean(access?.hidden_at),
    last_synced_at: replica.last_synced_at,
  };
}

function mergedMemberAliases(
  outcomes: readonly CommandOutcome[],
  sentById: ReadonlyMap<string, GroupCommand>,
): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const outcome of outcomes) {
    const command = sentById.get(outcome.command_id);

    if (
      outcome.reason === 'member_merged' &&
      outcome.server_state?.kind === 'member' &&
      command?.type === 'member.create'
    ) {
      aliases.set(command.payload.member_id, outcome.server_state.member.id);
    }
  }

  return aliases;
}

function project(
  replica: ClientGroupReplica,
  identityId: string,
): GroupSnapshot {
  let snapshot = structuredClone(replica.snapshot);

  for (const pending of replica.outbox) {
    const transition = applyGroupCommand(
      snapshot,
      identityId,
      pending.command,
      pending.queued_at,
    );

    if (transition.status === 'applied') snapshot = transition.snapshot;
  }

  return snapshot;
}

function requireIdentity(document: ClientStorageDocument): IdentitySession {
  if (!document.session) throw new Error('identity_not_initialized');

  return document.session;
}

function requireReplica(
  document: ClientStorageDocument,
  groupId: string,
): ClientGroupReplica {
  const replica = document.groups.find(
    (candidate) => candidate.group_id === groupId,
  );

  if (!replica) throw new Error('group_not_available_locally');

  return replica;
}

function upsertReplica(
  document: ClientStorageDocument,
  replica: ClientGroupReplica,
): void {
  const index = document.groups.findIndex(
    (candidate) => candidate.group_id === replica.group_id,
  );

  if (index === -1) {
    document.groups.push(replica);
  } else {
    document.groups[index] = replica;
  }
}

/**
 * A confirmed snapshot showing this identity's active access settles any join
 * it was retrying, so a later rejoin sends a new request instead of replaying
 * one the server already answered.
 */
function settleJoins(
  document: ClientStorageDocument,
  groupId: string,
  snapshot: GroupSnapshot,
): void {
  const access = document.session && accessFor(snapshot, document.session.identity.id);

  if (access && !access.hidden_at)
    document.pending_joins = document.pending_joins.filter(
      (candidate) => candidate.group_id !== groupId,
    );
}

function accessFor(snapshot: GroupSnapshot, identityId: string) {
  return snapshot.access_grants.find(
    (grant) => grant.identity_id === identityId,
  );
}

function sameCreationInput(
  left: CreateGroupRequest,
  right: CreateGroupRequest,
): boolean {
  return (
    left.group_id === right.group_id &&
    left.name === right.name &&
    left.creator_member_name === right.creator_member_name
  );
}
