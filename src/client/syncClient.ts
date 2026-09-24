import type {
  JoinGroupRequest,
  PreferredMemberChoice,
} from '../domain/access';
import { applyGroupCommand, type GroupCommand } from '../domain/commands';
import type { CreatedGroup, CreateGroupRequest } from '../domain/groups';
import { createIdentifier } from '../domain/ids';
import type { IdentitySession } from '../domain/identities';
import type {
  GroupSession,
  GroupSnapshot,
  SyncGroupRequest,
  SyncGroupResponse,
} from '../domain/sync';
import {
  type ClientGroupReplica,
  type ClientNotice,
  type ClientStorageAdapter,
  type ClientStorageDocument,
  emptyClientDocument,
} from './storage';

export type SyncDeviceTransport = {
  createGroup(input: CreateGroupRequest): Promise<CreatedGroup>;
  joinGroup(groupId: string, input: JoinGroupRequest): Promise<GroupSession>;
  syncGroup(groupId: string, input: SyncGroupRequest): Promise<SyncGroupResponse>;
};

export type SyncTransport = {
  createAnonymousIdentity(deviceSecret: string): Promise<IdentitySession>;
  forDevice(deviceSecret: string): SyncDeviceTransport;
};

export type NewPreferredMember = {
  kind: 'new';
  display_name: string;
};

export type ExistingPreferredMember = {
  kind: 'existing';
  member_id: string;
};

export type ClientPreferredMemberChoice =
  | NewPreferredMember
  | ExistingPreferredMember;

export type ClientReplicaState = {
  online: boolean;
  session: IdentitySession | null;
  group_id: string;
  revision: number | null;
  confirmed_snapshot: GroupSnapshot | null;
  projected_snapshot: GroupSnapshot | null;
  outbox: ClientGroupReplica['outbox'];
  notices: ClientNotice[];
  hidden: boolean;
  last_synced_at: string | null;
};

export type SplitnextSyncClientOptions = {
  api: SyncTransport;
  device_secret: string;
  storage: ClientStorageAdapter;
  create_id?: () => string;
  now?: () => string;
};

export class ClientOfflineError extends Error {
  constructor() {
    super('client_offline');
    this.name = 'ClientOfflineError';
  }
}

export class SplitnextSyncClient {
  private readonly api: SyncTransport;
  private readonly deviceApi: SyncDeviceTransport;
  private readonly deviceSecret: string;
  private readonly storage: ClientStorageAdapter;
  private readonly createId: () => string;
  private readonly now: () => string;
  private online = true;

  constructor(options: SplitnextSyncClientOptions) {
    this.api = options.api;
    this.deviceApi = options.api.forDevice(options.device_secret);
    this.deviceSecret = options.device_secret;
    this.storage = options.storage;
    this.createId = options.create_id ?? createIdentifier;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  isOnline(): boolean {
    return this.online;
  }

  setOnline(online: boolean): void {
    this.online = online;
  }

  async initializeIdentity(): Promise<IdentitySession> {
    const document = await this.readDocument();

    if (document.session) return document.session;

    this.requireOnline();

    const session = await this.api.createAnonymousIdentity(
      this.deviceSecret,
    );

    document.session = session;
    await this.storage.save(document);

    return session;
  }

  async createGroup(
    input: Omit<CreateGroupRequest, 'group_id'> & { group_id?: string },
  ): Promise<ClientReplicaState> {
    this.requireOnline();

    const document = await this.requireIdentity();

    const pending = document.pending_group_creations[0];

    const requested = {
      name: input.name,
      currency_code: input.currency_code,
      creator_member_name: input.creator_member_name,
      group_id: input.group_id ?? pending?.request.group_id ?? this.createId(),
    };

    if (pending && !sameCreationInput(pending.request, requested)) {
      throw new Error('pending_group_creation_conflict');
    }

    const request = pending?.request ?? requested;

    if (!pending) {
      document.pending_group_creations.push({ request });
      await this.storage.save(document);
    }

    let created;

    try {
      created = await this.deviceApi.createGroup(request);
    } catch (error) {
      if (error instanceof Error && isServerRejection(error)) {
        document.pending_group_creations = [];
        await this.storage.save(document);
      }

      throw error;
    }

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

    this.upsertReplica(document, {
      group_id: created.group.id,
      revision: created.group.revision,
      snapshot,
      outbox: [],
      notices: [],
      last_synced_at: this.now(),
    });
    document.pending_group_creations = [];
    await this.storage.save(document);

    return this.stateFrom(document, created.group.id);
  }

  async joinGroup(
    groupId: string,
    preferredMember: ClientPreferredMemberChoice,
  ): Promise<ClientReplicaState> {
    this.requireOnline();

    const document = await this.requireIdentity();

    let pending = document.pending_joins.find(
      (candidate) => candidate.group_id === groupId,
    );

    if (!pending) {
      const preferred: PreferredMemberChoice =
        preferredMember.kind === 'existing'
          ? preferredMember
          : {
              ...preferredMember,
              member_id: this.createId(),
            };

      pending = {
        group_id: groupId,
        request: {
          join_id: this.createId(),
          preferred_member: preferred,
        },
      };
      document.pending_joins.push(pending);
      await this.storage.save(document);
    }

    try {
      const joined = await this.deviceApi.joinGroup(groupId, pending.request);

      this.upsertReplica(document, {
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
      await this.storage.save(document);

      return this.stateFrom(document, groupId);
    } catch (error) {
      if (error instanceof Error && isServerRejection(error)) {
        document.pending_joins = document.pending_joins.filter(
          (candidate) => candidate.group_id !== groupId,
        );
        await this.storage.save(document);
      }

      throw error;
    }
  }

  renameGroup(groupId: string, name: string): Promise<ClientReplicaState> {
    return this.queueCommand(groupId, (snapshot) => ({
      command_id: this.createId(),
      type: 'group.rename',
      payload: { expected_name: snapshot.group.name, name },
    }));
  }

  addMember(groupId: string, displayName: string): Promise<ClientReplicaState> {
    return this.queueCommand(groupId, () => ({
      command_id: this.createId(),
      type: 'member.create',
      payload: { member_id: this.createId(), display_name: displayName },
    }));
  }

  renameMember(
    groupId: string,
    memberId: string,
    displayName: string,
  ): Promise<ClientReplicaState> {
    return this.queueCommand(groupId, (snapshot) => {
      const member = snapshot.members.find((candidate) => candidate.id === memberId);

      if (!member) throw new Error('member_not_found_locally');

      return {
        command_id: this.createId(),
        type: 'member.rename',
        payload: {
          member_id: memberId,
          expected_display_name: member.display_name,
          display_name: displayName,
        },
      };
    });
  }

  removeMember(groupId: string, memberId: string): Promise<ClientReplicaState> {
    return this.queueCommand(groupId, () => ({
      command_id: this.createId(),
      type: 'member.archive',
      payload: { member_id: memberId },
    }));
  }

  selectPreferredMember(
    groupId: string,
    memberId: string,
  ): Promise<ClientReplicaState> {
    return this.queueCommand(groupId, () => ({
      command_id: this.createId(),
      type: 'preference.set',
      payload: { member_id: memberId },
    }));
  }

  async leaveGroup(groupId: string): Promise<ClientReplicaState> {
    this.requireOnline();

    return this.queueCommand(groupId, () => ({
      command_id: this.createId(),
      type: 'group.leave',
      payload: {},
    }));
  }

  async syncGroup(groupId: string): Promise<ClientReplicaState> {
    this.requireOnline();

    const document = await this.requireIdentity();
    const replica = this.requireReplica(document, groupId);
    const access = this.accessFor(replica.snapshot, document.session.identity.id);

    if (access?.hidden_at && replica.outbox.length === 0) {
      return this.stateFrom(document, groupId);
    }

    const response = await this.deviceApi.syncGroup(groupId, {
      known_revision: replica.revision,
      commands: replica.outbox.map((pending) => pending.command),
    });

    const acknowledged = new Set(
      response.outcomes.map((outcome) => outcome.command_id),
    );

    const unsuccessful = response.outcomes.filter(
      (outcome) =>
        outcome.status === 'rejected' || outcome.status === 'superseded',
    );

    const notices = unsuccessful.map((outcome) => {
      const pending = replica.outbox.find(
        (candidate) => candidate.command.command_id === outcome.command_id,
      );

      if (!pending) throw new Error('sync_outcome_without_local_command');

      return {
        command: pending.command,
        outcome,
        recorded_at: this.now(),
      };
    });

    replica.revision = response.revision;
    replica.outbox = replica.outbox.filter(
      (pending) => !acknowledged.has(pending.command.command_id),
    );
    replica.notices.push(...notices);
    replica.last_synced_at = this.now();

    if (response.state.kind === 'snapshot') {
      replica.snapshot = response.state.snapshot;
    }

    await this.storage.save(document);

    return this.stateFrom(document, groupId);
  }

  async inspect(groupId: string): Promise<ClientReplicaState> {
    return this.stateFrom(await this.readDocument(), groupId);
  }

  async dismissNotice(
    groupId: string,
    commandId: string,
  ): Promise<ClientReplicaState> {
    const document = await this.readDocument();
    const replica = this.requireReplica(document, groupId);

    replica.notices = replica.notices.filter(
      (notice) => notice.outcome.command_id !== commandId,
    );
    await this.storage.save(document);

    return this.stateFrom(document, groupId);
  }

  private async queueCommand(
    groupId: string,
    createCommand: (snapshot: GroupSnapshot) => GroupCommand,
  ): Promise<ClientReplicaState> {
    const document = await this.requireIdentity();
    const replica = this.requireReplica(document, groupId);
    const projection = this.project(replica, document.session.identity.id);

    replica.outbox.push({
      command: createCommand(projection),
      queued_at: this.now(),
    });
    await this.storage.save(document);

    return this.online
      ? this.syncGroup(groupId)
      : this.stateFrom(document, groupId);
  }

  private stateFrom(
    document: ClientStorageDocument,
    groupId: string,
  ): ClientReplicaState {
    const replica = document.groups.find((candidate) => candidate.group_id === groupId);

    if (!replica || !document.session) {
      return {
        online: this.online,
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

    const projection = this.project(replica, document.session.identity.id);
    const access = this.accessFor(projection, document.session.identity.id);

    return {
      online: this.online,
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

  private project(
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

  private async readDocument(): Promise<ClientStorageDocument> {
    return (await this.storage.load()) ?? emptyClientDocument();
  }

  private async requireIdentity(): Promise<ClientStorageDocument & {
    session: IdentitySession;
  }> {
    const document = await this.readDocument();

    if (!this.hasIdentity(document)) {
      throw new Error('identity_not_initialized');
    }

    return document;
  }

  private hasIdentity(
    document: ClientStorageDocument,
  ): document is ClientStorageDocument & { session: IdentitySession } {
    return document.session !== null;
  }

  private requireReplica(
    document: ClientStorageDocument,
    groupId: string,
  ): ClientGroupReplica {
    const replica = document.groups.find((candidate) => candidate.group_id === groupId);

    if (!replica) throw new Error('group_not_available_locally');

    return replica;
  }

  private upsertReplica(
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

  private accessFor(snapshot: GroupSnapshot, identityId: string) {
    return snapshot.access_grants.find(
      (grant) => grant.identity_id === identityId,
    );
  }

  private requireOnline(): void {
    if (!this.online) throw new ClientOfflineError();
  }

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

function isServerRejection(error: Error): boolean {
  return error.name === 'SplitnextRequestError';
}
