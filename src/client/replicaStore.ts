import type {
  JoinGroupRequest,
  PreferredMemberChoice,
} from '../domain/access';
import { applyGroupCommand, type GroupCommand } from '../domain/commands';
import type { CreatedGroup, CreateGroupRequest } from '../domain/groups';
import type { IdentitySession } from '../domain/identities';
import type {
  GroupSession,
  GroupSnapshot,
  SyncGroupRequest,
  SyncGroupResponse,
} from '../domain/sync';
import {
  type ClientGroupReplica,
  type ClientStorageAdapter,
  type ClientStorageDocument,
  parseClientDocument,
  type PendingCommand,
  serializeClientDocument,
} from './storage';

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

export type PreparedSync = {
  request: SyncGroupRequest;
  commands: PendingCommand[];
};

export class ClientReplicaStore {
  constructor(
    private readonly storage: ClientStorageAdapter,
    private readonly now: () => string,
  ) {}

  session(): Promise<IdentitySession | null> {
    return this.read((document) => document.session);
  }

  retainSession(session: IdentitySession): Promise<IdentitySession> {
    return this.change((document) => {
      document.session ??= session;

      return document.session;
    });
  }

  prepareGroupCreation(
    input: Omit<CreateGroupRequest, 'group_id'> & { group_id?: string },
    createId: () => string,
  ): Promise<CreateGroupRequest> {
    return this.change((document) => {
      requireIdentity(document);

      const pending = document.pending_group_creations[0];

      const requested = {
        name: input.name,
        currency_code: input.currency_code,
        creator_member_name: input.creator_member_name,
        group_id: input.group_id ?? pending?.request.group_id ?? createId(),
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

  confirmGroupCreation(created: CreatedGroup): Promise<void> {
    return this.change((document) => {
      const snapshot: GroupSnapshot = {
        group: {
          id: created.group.id,
          name: created.group.name,
          currency_code: created.group.currency_code,
          created_at: created.group.created_at,
        },
        members: [created.member],
        access_grants: [created.access],
      };

      upsertReplica(document, {
        group_id: created.group.id,
        revision: created.group.revision,
        snapshot,
        outbox: [],
        notices: [],
        last_synced_at: this.now(),
      });
      document.pending_group_creations =
        document.pending_group_creations.filter(
          (candidate) => candidate.request.group_id !== created.group.id,
        );
    });
  }

  prepareJoin(
    groupId: string,
    preferredMember: PreferredMemberChoice | { kind: 'new'; display_name: string },
    createId: () => string,
  ): Promise<JoinGroupRequest> {
    return this.change((document) => {
      requireIdentity(document);

      const existing = document.pending_joins.find(
        (candidate) => candidate.group_id === groupId,
      );

      if (existing) return existing.request;

      const preferred: PreferredMemberChoice =
        preferredMember.kind === 'existing'
          ? preferredMember
          : {
              ...preferredMember,
              member_id: createId(),
            };

      const request = {
        join_id: createId(),
        preferred_member: preferred,
      };

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

  confirmJoin(groupId: string, joined: GroupSession): Promise<void> {
    return this.change((document) => {
      upsertReplica(document, {
        group_id: groupId,
        revision: joined.revision,
        snapshot: joined.snapshot,
        outbox: [],
        notices: [],
        last_synced_at: this.now(),
      });
      document.pending_joins = document.pending_joins.filter(
        (candidate) => candidate.group_id !== groupId,
      );
    });
  }

  queueCommand(
    groupId: string,
    createCommand: (
      snapshot: GroupSnapshot,
      identityId: string,
    ) => GroupCommand,
  ): Promise<void> {
    return this.change((document) => {
      const session = requireIdentity(document);
      const replica = requireReplica(document, groupId);
      const projection = project(replica, session.identity.id);

      replica.outbox.push({
        command: createCommand(projection, session.identity.id),
        queued_at: this.now(),
      });
    });
  }

  prepareSync(groupId: string): Promise<PreparedSync | null> {
    return this.read((document) => {
      const session = requireIdentity(document);
      const replica = requireReplica(document, groupId);
      const access = accessFor(replica.snapshot, session.identity.id);

      if (access?.hidden_at && replica.outbox.length === 0) return null;

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
  ): Promise<void> {
    return this.change((document) => {
      const replica = requireReplica(document, groupId);

      const acknowledged = new Set(
        response.outcomes.map((outcome) => outcome.command_id),
      );

      const sentById = new Map(
        sentCommands.map((pending) => [
          pending.command.command_id,
          pending.command,
        ]),
      );

      for (const outcome of response.outcomes) {
        if (
          outcome.status !== 'rejected' &&
          outcome.status !== 'superseded'
        ) {
          continue;
        }

        if (
          replica.notices.some(
            (notice) => notice.outcome.command_id === outcome.command_id,
          )
        ) {
          continue;
        }

        const command = sentById.get(outcome.command_id);

        if (!command) throw new Error('sync_outcome_without_sent_command');

        replica.notices.push({
          command,
          outcome,
          recorded_at: this.now(),
        });
      }

      replica.outbox = replica.outbox.filter(
        (pending) => !acknowledged.has(pending.command.command_id),
      );

      if (response.revision >= replica.revision) {
        replica.revision = response.revision;

        if (response.state.kind === 'snapshot') {
          replica.snapshot = response.state.snapshot;
        }
      }

      replica.last_synced_at = this.now();
    });
  }

  state(groupId: string, online: boolean): Promise<ClientReplicaState> {
    return this.read((document) => stateFrom(document, groupId, online));
  }

  dismissNotice(groupId: string, commandId: string): Promise<void> {
    return this.change((document) => {
      const replica = requireReplica(document, groupId);

      replica.notices = replica.notices.filter(
        (notice) => notice.outcome.command_id !== commandId,
      );
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

  private change<T>(
    operation: (document: ClientStorageDocument) => T,
  ): Promise<T> {
    return this.storage.update((serialized) => {
      const document = parseClientDocument(serialized);
      const result = operation(document);

      return {
        serialized: serializeClientDocument(document),
        result: structuredClone(result),
      };
    });
  }
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
    hidden: access?.hidden_at !== null && access?.hidden_at !== undefined,
    last_synced_at: replica.last_synced_at,
  };
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

function requireIdentity(
  document: ClientStorageDocument,
): IdentitySession {
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
    left.currency_code === right.currency_code &&
    left.creator_member_name === right.creator_member_name
  );
}
