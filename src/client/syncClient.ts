import type { JoinGroupRequest } from '../domain/access';
import type { GroupCommand } from '../domain/commands';
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
  ClientReplicaStore,
  type ClientReplicaState,
} from './replicaStore';
import type { ClientStorageAdapter } from './storage';

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
  private readonly replicas: ClientReplicaStore;
  private readonly createId: () => string;
  private online = true;

  constructor(options: SplitnextSyncClientOptions) {
    const now = options.now ?? (() => new Date().toISOString());

    this.api = options.api;
    this.deviceApi = options.api.forDevice(options.device_secret);
    this.deviceSecret = options.device_secret;
    this.replicas = new ClientReplicaStore(options.storage, now);
    this.createId = options.create_id ?? createIdentifier;
  }

  isOnline(): boolean {
    return this.online;
  }

  setOnline(online: boolean): void {
    this.online = online;
  }

  async initializeIdentity(): Promise<IdentitySession> {
    const existing = await this.replicas.session();

    if (existing) return existing;

    this.requireOnline();

    const session = await this.api.createAnonymousIdentity(this.deviceSecret);

    return this.replicas.retainSession(session);
  }

  async createGroup(
    input: Omit<CreateGroupRequest, 'group_id'> & { group_id?: string },
  ): Promise<ClientReplicaState> {
    this.requireOnline();

    const request = await this.replicas.prepareGroupCreation(
      input,
      this.createId,
    );

    let created: CreatedGroup;

    try {
      created = await this.deviceApi.createGroup(request);
    } catch (error) {
      if (error instanceof Error && isServerRejection(error)) {
        await this.replicas.rejectGroupCreation(request);
      }

      throw error;
    }

    await this.replicas.confirmGroupCreation(created);

    return this.replicas.state(created.group.id, this.online);
  }

  async joinGroup(
    groupId: string,
    preferredMember: ClientPreferredMemberChoice,
  ): Promise<ClientReplicaState> {
    this.requireOnline();

    const request = await this.replicas.prepareJoin(
      groupId,
      preferredMember,
      this.createId,
    );

    try {
      const joined = await this.deviceApi.joinGroup(groupId, request);

      await this.replicas.confirmJoin(groupId, joined);

      return this.replicas.state(groupId, this.online);
    } catch (error) {
      if (error instanceof Error && isServerRejection(error)) {
        await this.replicas.rejectJoin(groupId, request.join_id);
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
      const member = snapshot.members.find(
        (candidate) => candidate.id === memberId,
      );

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

    const prepared = await this.replicas.prepareSync(groupId);

    if (!prepared) return this.replicas.state(groupId, this.online);

    const response = await this.deviceApi.syncGroup(groupId, prepared.request);

    await this.replicas.reconcile(groupId, prepared.commands, response);

    return this.replicas.state(groupId, this.online);
  }

  inspect(groupId: string): Promise<ClientReplicaState> {
    return this.replicas.state(groupId, this.online);
  }

  async dismissNotice(
    groupId: string,
    commandId: string,
  ): Promise<ClientReplicaState> {
    await this.replicas.dismissNotice(groupId, commandId);

    return this.replicas.state(groupId, this.online);
  }

  private async queueCommand(
    groupId: string,
    createCommand: (
      snapshot: GroupSnapshot,
      identityId: string,
    ) => GroupCommand,
  ): Promise<ClientReplicaState> {
    await this.replicas.queueCommand(groupId, createCommand);

    return this.online
      ? this.syncGroup(groupId)
      : this.replicas.state(groupId, this.online);
  }

  private requireOnline(): void {
    if (!this.online) throw new ClientOfflineError();
  }
}

function isServerRejection(error: Error): boolean {
  return error.name === 'SplitnextRequestError';
}

export type { ClientReplicaState } from './replicaStore';
