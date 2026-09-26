import type { JoinGroupRequest } from '../domain/access';
import type { GroupCommand } from '../domain/commands';
import type {
  AccessibleGroup,
  CreatedGroup,
  CreateGroupRequest,
} from '../domain/groups';
import { createIdentifier } from '../domain/ids';
import {
  createInviteToken,
  defaultInviteLifetimeHours,
  type CreateInviteRequest,
  type GroupInvite,
  type InvitePreview,
} from '../domain/invites';
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
  type ClientGroupSummary,
} from './replicaStore';
import {
  defaultReconnectDelayMs,
  RealtimeSubscriptions,
  type RealtimeSocket,
  type RealtimeSocketHandlers,
} from './realtime';
import type { ClientStorageAdapter } from './storage';

export type SyncDeviceTransport = {
  currentIdentity(): Promise<IdentitySession>;
  createGroup(input: CreateGroupRequest): Promise<CreatedGroup>;
  joinGroup(groupId: string, input: JoinGroupRequest): Promise<GroupSession>;
  syncGroup(groupId: string, input: SyncGroupRequest): Promise<SyncGroupResponse>;
  openRealtime(groupId: string, handlers: RealtimeSocketHandlers): RealtimeSocket;
  createInvite(
    groupId: string,
    input: CreateInviteRequest,
  ): Promise<{ revision: number; invite: GroupInvite }>;
  revokeInvite(groupId: string, inviteId: string): Promise<{ revision: number }>;
  previewInvite(groupId: string, token: string): Promise<InvitePreview>;
  listGroups(): Promise<{ groups: AccessibleGroup[] }>;
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
  /** Receives replicas refreshed by realtime announcements. */
  on_background_sync?: (state: ClientReplicaState) => void;
  realtime_reconnect_delay_ms?: (attempt: number) => number;
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
  private readonly realtime: RealtimeSubscriptions;
  private readonly onBackgroundSync: (state: ClientReplicaState) => void;
  private readonly syncQueues = new Map<string, Promise<unknown>>();
  private online = true;

  constructor(options: SplitnextSyncClientOptions) {
    const now = options.now ?? (() => new Date().toISOString());

    this.api = options.api;
    this.deviceApi = options.api.forDevice(options.device_secret);
    this.deviceSecret = options.device_secret;
    this.replicas = new ClientReplicaStore(options.storage, now);
    this.createId = options.create_id ?? createIdentifier;
    this.onBackgroundSync = options.on_background_sync ?? (() => undefined);
    this.realtime = new RealtimeSubscriptions({
      connect: (groupId, handlers) =>
        this.deviceApi.openRealtime(groupId, handlers),
      onAnnouncement: (groupId, revision) =>
        this.onAnnouncement(groupId, revision),
      reconnectDelayMs:
        options.realtime_reconnect_delay_ms ?? defaultReconnectDelayMs,
    });
  }

  isOnline(): boolean {
    return this.online;
  }

  setOnline(online: boolean): void {
    this.online = online;
    this.realtime.setOnline(online);
  }

  async initializeIdentity(): Promise<IdentitySession> {
    const existing = await this.replicas.session();

    if (existing) {
      if (!this.online) return existing;

      try {
        return await this.replicas.retainSession(await this.deviceApi.currentIdentity());
      } catch {
        // A stored identity remains usable while the server is temporarily unavailable.
        return existing;
      }
    }

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

  /**
   * Joining for the first time needs the token from the group's invite link;
   * rejoining after leaving does not, because access is permanent.
   */
  async joinGroup(
    groupId: string,
    preferredMember: ClientPreferredMemberChoice,
    inviteToken?: string,
  ): Promise<ClientReplicaState> {
    this.requireOnline();

    const request = await this.replicas.prepareJoin(
      groupId,
      preferredMember,
      this.createId,
      inviteToken,
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

  /**
   * Creates the group's invite link, revoking any previous one. This device
   * generates and keeps the token; the returned state's `own_invite` holds it
   * for as long as the link is current.
   */
  async createInvite(
    groupId: string,
    expiresInHours: number = defaultInviteLifetimeHours,
  ): Promise<ClientReplicaState> {
    this.requireOnline();

    const invite = await this.replicas.prepareInvite(
      groupId,
      expiresInHours,
      this.createId,
      createInviteToken,
    );

    try {
      await this.deviceApi.createInvite(groupId, {
        invite_id: invite.invite_id,
        token: invite.token,
        expires_in_hours: invite.expires_in_hours,
      });
    } catch (error) {
      if (error instanceof Error && isServerRejection(error)) {
        await this.replicas.settleInvite(groupId, invite.invite_id, false);
      }

      throw error;
    }

    await this.replicas.settleInvite(groupId, invite.invite_id, true);

    return this.syncGroup(groupId);
  }

  /** Stops new joins through the current link; granted access remains. */
  async revokeInvite(groupId: string): Promise<ClientReplicaState> {
    this.requireOnline();

    const state = await this.replicas.state(groupId, this.online);
    const invite = state.confirmed_snapshot?.invite;

    if (!invite) return state;

    await this.deviceApi.revokeInvite(groupId, invite.id);

    return this.syncGroup(groupId);
  }

  /**
   * Lists every group this identity can access, active ones first. Online, it
   * refreshes the server's list; offline, or if that fails, it uses the last
   * list and this device's own copies. Opening a group that has no local copy
   * is a `syncGroup` call, which fetches one.
   */
  async listGroups(): Promise<ClientGroupSummary[]> {
    if (this.online) {
      try {
        const { groups } = await this.deviceApi.listGroups();

        await this.replicas.retainGroupDirectory(groups);
      } catch (error) {
        if (!(error instanceof Error) || !isTransportFailure(error)) throw error;
      }
    }

    return this.replicas.groupSummaries();
  }

  /** The same list as `listGroups`, from local data only. */
  knownGroups(): Promise<ClientGroupSummary[]> {
    return this.replicas.groupSummaries();
  }

  /** Shows a link holder the group and its members before they join. */
  previewInvite(groupId: string, token: string): Promise<InvitePreview> {
    this.requireOnline();

    return this.deviceApi.previewInvite(groupId, token);
  }

  /**
   * `expectedName` is the name the user saw when they began editing, so a
   * concurrent rename supersedes this one instead of being overwritten. It
   * defaults to the current local name.
   */
  renameGroup(
    groupId: string,
    name: string,
    expectedName?: string,
  ): Promise<ClientReplicaState> {
    return this.queueCommand(groupId, (snapshot) => ({
      command_id: this.createId(),
      type: 'group.rename',
      payload: { expected_name: expectedName ?? snapshot.group.name, name },
    }));
  }

  addMember(groupId: string, displayName: string): Promise<ClientReplicaState> {
    return this.queueCommand(groupId, () => ({
      command_id: this.createId(),
      type: 'member.create',
      payload: { member_id: this.createId(), display_name: displayName },
    }));
  }

  /** `expectedDisplayName` works like `renameGroup`'s `expectedName`. */
  renameMember(
    groupId: string,
    memberId: string,
    displayName: string,
    expectedDisplayName?: string,
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
          expected_display_name: expectedDisplayName ?? member.display_name,
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

  /** Leaving needs a server decision, so a transport failure is reported. */
  async leaveGroup(groupId: string): Promise<ClientReplicaState> {
    this.requireOnline();

    await this.replicas.queueCommand(groupId, () => ({
      command_id: this.createId(),
      type: 'group.leave',
      payload: {},
    }));

    return this.syncGroup(groupId);
  }

  async syncGroup(groupId: string): Promise<ClientReplicaState> {
    this.requireOnline();

    return this.serialize(groupId, () => this.synchronize(groupId));
  }

  /**
   * Fetches the current snapshot even for a group this identity left, which
   * ordinary synchronization skips; for example, to choose a member before
   * rejoining.
   */
  async refreshGroup(groupId: string): Promise<ClientReplicaState> {
    this.requireOnline();

    return this.serialize(groupId, () => this.synchronize(groupId, true));
  }

  /**
   * Subscribes to revision announcements for a group while online. The
   * subscription ends when the group becomes hidden.
   */
  watchGroup(groupId: string): void {
    this.realtime.watch(groupId);
  }

  unwatchGroup(groupId: string): void {
    this.realtime.unwatch(groupId);
  }

  isWatching(groupId: string): boolean {
    return this.realtime.isWatching(groupId);
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

    if (!this.online) return this.replicas.state(groupId, this.online);

    try {
      return await this.syncGroup(groupId);
    } catch (error) {
      // An unreachable server is indistinguishable from being offline: the
      // intent is safely queued and a later synchronization delivers it.
      if (error instanceof Error && isTransportFailure(error)) {
        return this.replicas.state(groupId, this.online);
      }

      throw error;
    }
  }

  private async synchronize(
    groupId: string,
    includeLeft = false,
  ): Promise<ClientReplicaState> {
    const prepared = await this.replicas.prepareSync(groupId, includeLeft);

    if (prepared) {
      const response = await this.deviceApi.syncGroup(
        groupId,
        prepared.request,
      );

      await this.replicas.reconcile(groupId, prepared.commands, response);
    }

    const state = await this.replicas.state(groupId, this.online);

    if (state.hidden) this.realtime.unwatch(groupId);

    return state;
  }

  /**
   * One synchronization per group at a time. Announcements that arrive while
   * a synchronization is running are checked against its result, so a burst
   * of announcements costs at most one extra request.
   */
  private serialize<T>(groupId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.syncQueues.get(groupId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);

    this.syncQueues.set(groupId, settled);
    void settled.then(() => {
      if (this.syncQueues.get(groupId) === settled) {
        this.syncQueues.delete(groupId);
      }
    });

    return next;
  }

  private onAnnouncement(groupId: string, revision: number): void {
    const background = this.serialize(groupId, async () => {
      if (!this.online) return null;

      const state = await this.replicas.state(groupId, this.online);

      const current =
        state.revision !== null &&
        revision <= state.revision &&
        state.outbox.length === 0;

      if (state.hidden || current) return null;

      return this.synchronize(groupId);
    });

    // Transport failures leave the outbox intact and are reported to the
    // observer; the next announcement or reconnect retries.
    void background
      .then((state) => {
        if (state) this.onBackgroundSync(state);
      })
      .catch(() => undefined);
  }

  private requireOnline(): void {
    if (!this.online) throw new ClientOfflineError();
  }
}

function isServerRejection(error: Error): boolean {
  return error.name === 'SplitnextRequestError';
}

/** The request never produced a server answer, as opposed to a rejection. */
function isTransportFailure(error: Error): boolean {
  return (
    !isServerRejection(error) && error.name !== 'SplitnextProtocolError'
  );
}

export type { ClientGroupSummary, ClientReplicaState } from './replicaStore';
