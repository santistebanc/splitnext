import { z } from 'zod';
import { commandFromIntent, commandOutcomeSchema, requiresServerDecision, type CommandIntent } from '../domain/commands';
import { clientErrorKind } from './errors';
import type { ClientDiagnosticEvent, ClientDiagnosticObserver, ClientExchange, ClientRequestContext, ClientInvocationIds } from './diagnostics';
import type { PendingCommand } from './storage';
import { SplitnextNetworkError, SplitnextRequestError } from './errors';
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
  type InviteLinkInput,
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
  type ClientInstallationState,
  type ClientGroupCreationInput,
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
  createGroup(input: CreateGroupRequest, context?: ClientRequestContext): Promise<CreatedGroup>;
  joinGroup(groupId: string, input: JoinGroupRequest, context?: ClientRequestContext): Promise<GroupSession>;
  syncGroup(
    groupId: string,
    input: SyncGroupRequest,
    context?: ClientRequestContext,
  ): Promise<SyncGroupResponse>;
  openRealtime(
    groupId: string,
    handlers: RealtimeSocketHandlers,
  ): RealtimeSocket;
  regenerateInvite(
    groupId: string,
    input: InviteLinkInput,
    context?: ClientRequestContext,
  ): Promise<{ revision: number; invite: GroupInvite }>;
  previewInvite(groupId: string, token: string, context?: ClientRequestContext): Promise<InvitePreview>;
  listGroups(context?: ClientRequestContext): Promise<{ groups: AccessibleGroup[] }>;
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
  /** Presence changes are transient and never written to replica storage. */
  on_presence_change?: (groupId: string) => void;
  on_background_error?: (error: Error) => void;
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
  private readonly onBackgroundError: (error: Error) => void;
  private readonly diagnosticObservers = new Set<ClientDiagnosticObserver>();
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
    this.onBackgroundError = options.on_background_error ?? (() => undefined);
    this.realtime = new RealtimeSubscriptions({
      connect: (groupId, handlers) =>
        this.deviceApi.openRealtime(groupId, handlers),
      onAnnouncement: (groupId, revision) =>
        this.onAnnouncement(groupId, revision),
      onPresenceChange: (groupId) => options.on_presence_change?.(groupId),
      reconnectDelayMs:
        options.realtime_reconnect_delay_ms ?? defaultReconnectDelayMs,
    });
  }

  observeDiagnostics(observer: ClientDiagnosticObserver): () => void {
    this.diagnosticObservers.add(observer);

    return () => this.diagnosticObservers.delete(observer);
  }

  private diagnostic(event: ClientDiagnosticEvent): void {
    for (const observer of this.diagnosticObservers) {
      try { observer(event); } catch { /* Diagnostics never alter durable intent. */ }
    }
  }

  private async exchange<T>(exchange: ClientExchange, request: (context: ClientRequestContext) => Promise<T>): Promise<T> {
    const context = { request_id: crypto.randomUUID(), invocation_ids: exchange.invocation_ids };
    const started = Date.now();

    this.diagnostic({ ...exchange, ...context, kind: 'request' });

    try {
      const result = await request(context);
      const outcomes = z.object({ outcomes: z.array(commandOutcomeSchema) }).safeParse(result);

      this.diagnostic({ ...exchange, ...context, kind: 'response', duration_ms: Date.now() - started, outcomes: outcomes.success ? outcomes.data.outcomes.map(({ command_id, status, reason }) => ({ command_id, status, reason })) : [] });

      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('request_failed');

      this.diagnostic({ ...exchange, ...context, kind: 'failure', duration_ms: Date.now() - started, error_kind: clientErrorKind(error), error: error instanceof SplitnextRequestError ? error.code : error.name === 'SplitnextProtocolError' ? error.message : `${clientErrorKind(error)}_failure` });
      throw cause;
    }
  }

  private requestContext(operation: string, groupId: string | null, invocationId?: ClientInvocationIds): ClientExchange {
    return { operation, group_id: groupId, invocation_ids: [invocationId ?? []].flat(), command_ids: [] };
  }

  private queued(groupId: string, pending: PendingCommand, retryOf: string | null = null): void {
    this.diagnostic({ kind: 'command_queued', group_id: groupId, command_id: pending.command.command_id, invocation_id: pending.invocation_id ?? null, retry_of: retryOf });
  }

  isOnline(): boolean {
    return this.online;
  }

  setOnline(online: boolean): void {
    this.online = online;
    this.realtime.setOnline(online);
  }

  async initializeIdentity(): Promise<IdentitySession> {
    await this.replicas.upgradeStorage(this.online, async (groupId) => {
      const response = await this.deviceApi.syncGroup(groupId, {
        known_revision: 0,
        commands: [],
      });

      if (response.state.kind !== 'snapshot')
        throw new Error('upgrade_snapshot_missing');

      return { revision: response.revision, snapshot: response.state.snapshot };
    });

    const existing = await this.replicas.session();

    if (existing) {
      if (!this.online) return existing;

      try {
        return await this.replicas.retainSession(
          await this.deviceApi.currentIdentity(),
        );
      } catch (error) {
        if (!(error instanceof SplitnextNetworkError)) throw error;

        // A stored identity remains usable while the server is temporarily unavailable.
        return existing;
      }
    }

    this.requireOnline();

    const session = await this.api.createAnonymousIdentity(this.deviceSecret);

    return this.replicas.retainSession(session);
  }

  async createGroup(
    input: ClientGroupCreationInput,
    invocationId?: string,
  ): Promise<ClientReplicaState> {
    this.requireOnline();

    const request = await this.replicas.prepareGroupCreation(
      input,
      this.createId,
    );

    let created: CreatedGroup;

    try {
      created = await this.exchange(this.requestContext('createGroup', request.group_id, invocationId), (context) => this.deviceApi.createGroup(request, context));
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
    invocationId?: string,
  ): Promise<ClientReplicaState> {
    this.requireOnline();

    return this.serialize(groupId, async () => {
      // Deliver earlier intent first, such as a leave whose response was
      // lost, so leaving and rejoining reach the server in the order made.
      if ((await this.replicas.state(groupId, this.online)).outbox.length > 0)
        await this.synchronize(groupId, true, invocationId);

      const request = await this.replicas.prepareJoin(
        groupId,
        preferredMember,
        this.createId,
        inviteToken,
      );

      try {
        const joined = await this.exchange(this.requestContext('joinGroup', groupId, invocationId), (context) => this.deviceApi.joinGroup(groupId, request, context));

        await this.replicas.confirmJoin(groupId, joined);

        return this.replicas.state(groupId, this.online);
      } catch (error) {
        if (error instanceof Error && isServerRejection(error)) {
          await this.replicas.rejectJoin(groupId, request.join_id);
        }

        throw error;
      }
    });
  }

  /**
   * Replaces the group's shared invite link. Every participant receives the
   * new token in its next authenticated group snapshot.
   */
  async regenerateInvite(groupId: string, invocationId?: string): Promise<ClientReplicaState> {
    this.requireOnline();

    const invite = await this.replicas.prepareInvite(
      groupId,
      this.createId,
      createInviteToken,
    );

    try {
      await this.exchange(this.requestContext('regenerateInvite', groupId, invocationId), (context) => this.deviceApi.regenerateInvite(groupId, {
        invite_id: invite.invite_id,
        token: invite.token,
      }, context));
    } catch (error) {
      if (error instanceof Error && isServerRejection(error)) {
        await this.replicas.settleInvite(groupId, invite.invite_id);
      }

      throw error;
    }

    await this.replicas.settleInvite(groupId, invite.invite_id);

    return this.syncGroup(groupId, invocationId);
  }

  /**
   * Lists every group this identity can access, active ones first. Online, it
   * refreshes the server's list; offline, or if that fails, it uses the last
   * list and this device's own copies. Opening a group that has no local copy
   * is a `syncGroup` call, which fetches one.
   */
  async listGroups(invocationId?: ClientInvocationIds): Promise<ClientGroupSummary[]> {
    if (this.online) {
      try {
        const { groups } = await this.exchange(this.requestContext('listGroups', null, invocationId), (context) => this.deviceApi.listGroups(context));

        await this.replicas.retainGroupDirectory(groups);
      } catch (error) {
        if (!(error instanceof Error) || !isTransportFailure(error))
          throw error;
      }
    }

    return this.replicas.groupSummaries();
  }

  /** Reads summaries, notice counts, and requested replicas from one local document. */
  installationState(groupIds: readonly string[] = []): Promise<ClientInstallationState> {
    return this.replicas.installationState(groupIds, this.online);
  }

  /** The same list as `listGroups`, from local data only. */
  knownGroups(): Promise<ClientGroupSummary[]> {
    return this.replicas.groupSummaries();
  }

  /** Shows a link holder the group and its members before they join. */
  previewInvite(groupId: string, token: string, invocationId?: string): Promise<InvitePreview> {
    this.requireOnline();

    return this.exchange(this.requestContext('previewInvite', groupId, invocationId), (context) => this.deviceApi.previewInvite(groupId, token, context));
  }

  /**
   * Queues one command, completed against the local projection, and delivers
   * it when online. An omitted precondition, such as a rename's expected
   * name, is the name the person currently sees, so a concurrent change
   * supersedes this one instead of being overwritten. Leaving needs a server
   * decision, so a transport failure is reported for it.
   */
  async submit(groupId: string, intent: CommandIntent, invocationId?: string): Promise<ClientReplicaState> {
    const requiresServer = requiresServerDecision(intent.type);

    if (requiresServer) this.requireOnline();

    return this.queueCommand(groupId, (snapshot) => commandFromIntent(intent, snapshot, this.createId), invocationId, requiresServer);
  }

  async syncGroup(groupId: string, invocationId?: ClientInvocationIds): Promise<ClientReplicaState> {
    this.requireOnline();

    return this.serialize(groupId, () => this.synchronize(groupId, false, invocationId));
  }

  /**
   * Fetches the current snapshot even for a group this identity left, which
   * ordinary synchronization skips; for example, to choose a member before
   * rejoining.
   */
  async refreshGroup(groupId: string, invocationId?: ClientInvocationIds): Promise<ClientReplicaState> {
    this.requireOnline();

    return this.serialize(groupId, () => this.synchronize(groupId, true, invocationId));
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

  presence(groupId: string): string[] | null {
    return this.realtime.presence(groupId);
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

  /** Retry a notice as fresh intent, retiring it only with the durable outbox write. */
  async retryNotice(groupId: string, commandId: string, invocationId?: string): Promise<ClientReplicaState> {
    const { requiresServer, pending } = await this.replicas.retryNotice(groupId, commandId, this.createId, () => this.requireOnline(), invocationId);

    this.queued(groupId, pending, commandId);

    return this.deliverQueued(groupId, requiresServer, invocationId);
  }

  private async queueCommand(
    groupId: string,
    createCommand: (
      snapshot: GroupSnapshot,
      identityId: string,
    ) => GroupCommand,
    invocationId?: string,
    requiresServer = false,
  ): Promise<ClientReplicaState> {
    const pending = await this.replicas.queueCommand(groupId, createCommand, invocationId);

    this.queued(groupId, pending);

    return this.deliverQueued(groupId, requiresServer, invocationId);
  }

  private async deliverQueued(groupId: string, requiresServer = false, invocationId?: string): Promise<ClientReplicaState> {
    if (requiresServer) this.requireOnline();

    if (!this.online) return this.replicas.state(groupId, this.online);

    try {
      return await this.syncGroup(groupId, invocationId);
    } catch (error) {
      // An unreachable server is indistinguishable from being offline: the
      // intent is safely queued and a later synchronization delivers it.
      if (!requiresServer && error instanceof Error && isTransportFailure(error)) {
        return this.replicas.state(groupId, this.online);
      }

      throw error;
    }
  }

  private async synchronize(
    groupId: string,
    includeLeft = false,
    invocationId?: ClientInvocationIds,
  ): Promise<ClientReplicaState> {
    const prepared = await this.replicas.prepareSync(groupId, includeLeft);

    if (prepared) {
      const exchange = this.requestContext('syncGroup', groupId, invocationId);

      exchange.command_ids = prepared.commands.map((pending) => pending.command.command_id);
      exchange.invocation_ids = [...new Set([...exchange.invocation_ids, ...prepared.commands.flatMap((pending) => pending.invocation_id ? [pending.invocation_id] : [])])];
      const response = await this.exchange(exchange, (context) => this.deviceApi.syncGroup(groupId, prepared.request, context));

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
      .catch((cause) => {
        try {
          this.onBackgroundError(cause instanceof Error ? cause : new Error('sync_failed'));
        } catch {
          // A diagnostic consumer cannot create an unhandled background rejection.
        }
      });
  }

  private requireOnline(): void {
    if (!this.online) throw new ClientOfflineError();
  }
}

function isServerRejection(error: Error): boolean {
  return error instanceof SplitnextRequestError;
}

/** The request never produced a server answer, as opposed to a rejection. */
function isTransportFailure(error: Error): boolean {
  return error instanceof SplitnextNetworkError;
}

export type {
  ClientInstallationState,
  ClientGroupCreationInput,
  ClientGroupSummary,
  ClientReplicaState,
} from './replicaStore';
