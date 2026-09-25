import type {
  ClientRealtimeEvent,
  ClientTransportEvent,
  JsonValue,
  RealtimeSocket,
  RealtimeSocketFactory,
  RealtimeSocketHandlers,
} from '../client';
import {
  browserWebSocket,
  formatInviteLink,
  MemoryClientStorage,
  parseInviteLink,
  SplitnextClient,
  SplitnextSyncClient,
  type ClientGroupSummary,
  type ClientPreferredMemberChoice,
  type ClientReplicaState,
  type InvitePreview,
} from '../client';
import { z } from 'zod';
import type { GroupCommand } from '../domain/commands';
import type { CreateGroupRequest } from '../domain/groups';
import type { IdentitySession } from '../domain/identities';
import { revisionAnnouncementSchema } from '../domain/realtime';
import { groupSnapshotSchema, type GroupSnapshot } from '../domain/sync';
import type { IdentityDirectoryInspection } from '../identityDirectory';

/** A generated key; devices are added and removed at will. */
export type LabDeviceKey = string;

type LabFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type LabRequestResult =
  | {
      kind: 'response';
      status: number;
      body: JsonValue;
      duration_ms: number;
    }
  | {
      kind: 'network_error';
      status: 0;
      error: string;
      duration_ms: number;
    };

export type LabRequest = {
  request_id: string;
  at: string;
  method: string;
  path: string;
  body: JsonValue;
  result: LabRequestResult | null;
  from?: string;
};

export type LabCommand = {
  command: GroupCommand;
  status: string;
  updated_at: string;
  detail: string | null;
};

export type LabRealtimeStatus = 'off' | 'connecting' | 'open' | 'disconnected';

export type LabRealtimeEvent = {
  at: string;
  phase: ClientRealtimeEvent['phase'];
  detail: string;
};

export type LabDevice = {
  label: string;
  online: boolean;
  realtime: boolean;
  realtimeStatus: LabRealtimeStatus;
  realtimeEvents: LabRealtimeEvent[];
  session: IdentitySession | null;
  /** Every group this device's identity can access, active ones first. */
  groups: ClientGroupSummary[];
  selectedGroupId: string | null;
  /** The local replica of the selected group. */
  replica: ClientReplicaState | null;
  commands: LabCommand[];
  requests: LabRequest[];
};

export type LabServer = {
  online: boolean;
  identityDirectory: IdentityDirectoryInspection | null;
  groups: LabServerGroup[];
  revision: number | null;
  snapshot: GroupSnapshot | null;
  subscribers: string[];
  incoming: LabRequest[];
};

export type LabServerGroup = {
  group_id: string;
  name: string;
  currency_code: string;
  revision: number;
};

export type SyncLabState = {
  /** The group the server panel inspects: the one most recently selected. */
  inspectedGroupId: string | null;
  /** Devices in the order they were added. */
  devices: Record<LabDeviceKey, LabDevice>;
  server: LabServer;
};

type DeviceRuntime = {
  secret: string;
  client: SplitnextSyncClient;
};

type LabSocket = { drop(reason: string): void };

type ClientRequestEvent = Extract<ClientTransportEvent, { kind: 'request' }>;

type ClientResponseEvent = Extract<ClientTransportEvent, { kind: 'response' }>;

type ClientNetworkErrorEvent = Extract<
  ClientTransportEvent,
  { kind: 'network_error' }
>;

export type SyncLabOptions = {
  baseUrl: string;
  fetch?: LabFetch;
  webSocket?: RealtimeSocketFactory;
  createDeviceSecret?: () => string;
  now?: () => Date;
  onChange?: (state: SyncLabState) => void;
};

/**
 * Owns the whole two-device experiment. The dashboard only translates DOM
 * events into these operations and renders the resulting state.
 */
export class SyncLab {
  readonly state: SyncLabState = {
    inspectedGroupId: null,
    devices: {},
    server: {
      online: true,
      identityDirectory: null,
      groups: [],
      revision: null,
      snapshot: null,
      subscribers: [],
      incoming: [],
    },
  };

  private readonly baseUrl: string;
  private readonly fetch: LabFetch;
  private readonly webSocket: RealtimeSocketFactory;
  private readonly createDeviceSecret: () => string;
  private readonly now: () => Date;
  private readonly onChange: (state: SyncLabState) => void;
  private readonly runtimes = new Map<LabDeviceKey, DeviceRuntime>();
  private readonly sockets = new Set<LabSocket>();
  private readonly systemApi: SplitnextClient;
  private devicesAdded = 0;

  constructor(options: SyncLabOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.webSocket = options.webSocket ?? browserWebSocket;
    this.createDeviceSecret = options.createDeviceSecret ?? generateDeviceSecret;
    this.now = options.now ?? (() => new Date());
    this.onChange = options.onChange ?? (() => undefined);
    this.systemApi = new SplitnextClient({
      baseUrl: this.baseUrl,
      fetch: this.fetch,
    });
  }

  checkDependencies() {
    return Promise.allSettled([
      this.systemApi.health(),
      this.systemApi.readiness(),
    ]);
  }

  /**
   * Adds a freshly installed device. Like an app's first launch, it generates
   * a device secret and registers an anonymous identity right away.
   */
  async addDevice(): Promise<LabDeviceKey> {
    this.devicesAdded += 1;

    const key = `device-${this.devicesAdded}`;

    this.state.devices[key] = newDevice(`Device ${this.devicesAdded}`);
    this.changed();

    try {
      this.device(key).session = await this.runtime(key).client.initializeIdentity();
      await this.refreshGroupList(key);
    } finally {
      await this.refreshServer();
      this.changed();
    }

    return key;
  }

  /**
   * Discards a device and everything stored on it, as if it were wiped or
   * lost. Its identity and group access remain on the server.
   */
  removeDevice(key: LabDeviceKey): void {
    const runtime = this.runtimes.get(key);

    this.unwatchAll(key);
    runtime?.client.setOnline(false);
    this.runtimes.delete(key);
    delete this.state.devices[key];
    this.changed();
  }

  async createGroup(
    key: LabDeviceKey,
    input: Omit<CreateGroupRequest, 'group_id'>,
  ): Promise<ClientReplicaState> {
    const replica = await this.runtime(key).client.createGroup(input);

    await this.openGroup(key, replica);

    return replica;
  }

  /** Makes a group the device's selected one, fetching it if not stored. */
  async selectGroup(key: LabDeviceKey, groupId: string): Promise<ClientReplicaState> {
    const device = this.device(key);
    const client = this.runtime(key).client;
    const known = device.groups.find((group) => group.group_id === groupId);

    // A group the identity left no longer synchronizes, so opening it fetches
    // current members for choosing who to be when rejoining.
    const refresh = known?.status === 'left' && device.online;

    const replica =
      known?.stored_locally === false
        ? await client.syncGroup(groupId)
        : refresh
          ? await client.refreshGroup(groupId)
          : await client.inspect(groupId);

    await this.openGroup(key, replica);

    return replica;
  }

  /** Asks the server for the device identity's groups. */
  async refreshGroupList(key: LabDeviceKey): Promise<ClientGroupSummary[]> {
    const groups = await this.runtime(key).client.listGroups();

    this.device(key).groups = groups;
    this.watchIfEnabled(key);
    this.changed();

    return groups;
  }

  /** Shows what a link holder would see before joining. */
  previewInvite(key: LabDeviceKey, link: string): Promise<InvitePreview> {
    const invite = requireInviteLink(link);

    return this.runtime(key).client.previewInvite(invite.group_id, invite.token);
  }

  async joinWithInvite(
    key: LabDeviceKey,
    link: string,
    preferredMember: ClientPreferredMemberChoice,
  ): Promise<ClientReplicaState> {
    const invite = requireInviteLink(link);

    const replica = await this.runtime(key).client.joinGroup(
      invite.group_id,
      preferredMember,
      invite.token,
    );

    await this.openGroup(key, replica);

    return replica;
  }

  createInvite(key: LabDeviceKey, expiresInHours?: number) {
    return this.mutate(key, (client, groupId) =>
      client.createInvite(groupId, expiresInHours),
    );
  }

  revokeInvite(key: LabDeviceKey) {
    return this.mutate(key, (client, groupId) => client.revokeInvite(groupId));
  }

  /** The shareable link, when this device created the group's current one. */
  inviteLink(key: LabDeviceKey): string | null {
    const replica = this.device(key).replica;

    return replica?.own_invite
      ? formatInviteLink(this.baseUrl, replica.group_id, replica.own_invite.token)
      : null;
  }

  async toggleDevice(key: LabDeviceKey): Promise<void> {
    const device = this.device(key);

    device.online = !device.online;
    this.runtimes.get(key)?.client.setOnline(device.online);
    this.changed();

    if (device.online) await this.deliverOutboxes(key);
  }

  /** Realtime can be disabled to show that a reconnect still catches up. */
  toggleRealtime(key: LabDeviceKey): void {
    const device = this.device(key);

    device.realtime = !device.realtime;

    if (device.realtime) {
      this.watchIfEnabled(key);
    } else {
      this.unwatchAll(key);
      device.realtimeStatus = 'off';
    }

    this.changed();
  }

  /**
   * While the server is down, online devices behave as if they were offline:
   * changes queue locally. When it returns, each online device delivers its
   * outbox as a real client would on regaining connectivity.
   */
  async toggleServer(): Promise<void> {
    const server = this.state.server;

    server.online = !server.online;

    if (!server.online) {
      for (const socket of this.sockets) socket.drop('server_offline');
      this.changed();

      return;
    }

    // Reconnect now instead of waiting out each device's backoff.
    for (const [key, runtime] of this.runtimes) {
      runtime.client.setOnline(this.device(key).online);
    }

    this.changed();
    await Promise.all(
      this.deviceKeys().flatMap((key) =>
        this.device(key).online ? [this.deliverOutboxes(key)] : [],
      ),
    );
    await this.refreshServer();
  }

  /** Development only: erases all indexed groups and identities. */
  async reset(): Promise<string[]> {
    if (!this.state.server.online) throw new TypeError('server_offline');

    const response = await this.fetch(`${this.baseUrl}/debug/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!response.ok) throw new Error(`reset_failed_${response.status}`);

    const { cleared_group_ids: cleared } = resetResponseSchema.parse(
      await response.json(),
    );

    for (const key of this.deviceKeys()) this.removeDevice(key);

    this.sockets.clear();
    this.devicesAdded = 0;
    this.state.inspectedGroupId = null;
    this.state.server.groups = [];
    this.state.server.revision = null;
    this.state.server.snapshot = null;
    this.state.server.subscribers = [];
    this.state.server.incoming = [];
    await this.refreshServer();
    this.changed();

    return cleared;
  }

  /** Closes every realtime subscription so the lab can be discarded. */
  dispose(): void {
    for (const key of this.deviceKeys()) this.unwatchAll(key);
  }

  /** Synchronizes the device's selected group. */
  async syncDevice(key: LabDeviceKey): Promise<ClientReplicaState | null> {
    const device = this.device(key);
    const runtime = this.runtimes.get(key);

    if (!device.selectedGroupId || !runtime) return null;

    const replica = await runtime.client.syncGroup(device.selectedGroupId);

    device.replica = replica;
    await this.refreshAfterOperation();

    return replica;
  }

  renameGroup(key: LabDeviceKey, name: string, expectedName?: string) {
    return this.mutate(key, (client, groupId) =>
      client.renameGroup(groupId, name, expectedName),
    );
  }

  addMember(key: LabDeviceKey, displayName: string) {
    return this.mutate(key, (client, groupId) =>
      client.addMember(groupId, displayName),
    );
  }

  renameMember(
    key: LabDeviceKey,
    memberId: string,
    displayName: string,
    expectedDisplayName?: string,
  ) {
    return this.mutate(key, (client, groupId) =>
      client.renameMember(groupId, memberId, displayName, expectedDisplayName),
    );
  }

  removeMember(key: LabDeviceKey, memberId: string) {
    return this.mutate(key, (client, groupId) =>
      client.removeMember(groupId, memberId),
    );
  }

  selectPreferredMember(key: LabDeviceKey, memberId: string) {
    return this.mutate(key, (client, groupId) =>
      client.selectPreferredMember(groupId, memberId),
    );
  }

  leaveGroup(key: LabDeviceKey) {
    return this.mutate(key, (client, groupId) => client.leaveGroup(groupId));
  }

  /** Rejoins the selected group as an existing member or a new one. */
  async rejoinGroup(
    key: LabDeviceKey,
    preferredMember: ClientPreferredMemberChoice,
  ): Promise<ClientReplicaState> {
    const replica = await this.runtime(key).client.joinGroup(
      this.requireSelectedGroup(key),
      preferredMember,
    );

    await this.openGroup(key, replica);

    return replica;
  }

  /** Groups the server index knows about, including those no lab device uses. */
  knownGroups(): LabServerGroup[] {
    return this.state.server.groups;
  }

  /** Shows a group's authoritative state in the server panel. */
  async inspectGroup(groupId: string): Promise<void> {
    this.state.inspectedGroupId = groupId;
    this.changed();
    await this.refreshGroupInspection();
    this.changed();
  }

  async refreshServer(): Promise<void> {
    if (!this.state.server.online) return;

    await Promise.all([this.refreshIdentityDirectory(), this.refreshServerGroups()]);
    await this.refreshGroupInspection();
    this.changed();
  }

  clearDeviceTraffic(key: LabDeviceKey): void {
    this.device(key).requests = [];
    this.changed();
  }

  clearServerTraffic(): void {
    this.state.server.incoming = [];
    this.changed();
  }

  private runtime(key: LabDeviceKey): DeviceRuntime {
    const existing = this.runtimes.get(key);

    if (existing) return existing;

    const device = this.device(key);
    const secret = this.createDeviceSecret();

    const api = new SplitnextClient({
      baseUrl: this.baseUrl,
      fetch: async (input, init) => {
        if (!device.online) throw new TypeError('device_offline');

        if (!this.state.server.online) throw new TypeError('server_offline');

        return this.fetch(input, init);
      },
      webSocket: (url, protocols, handlers) =>
        this.openSocket(device, url, protocols, handlers),
      observer: (event) => this.onTransportEvent(key, event),
    });

    const client = new SplitnextSyncClient({
      api,
      device_secret: secret,
      storage: new MemoryClientStorage(),
      realtime_reconnect_delay_ms: (attempt) => Math.min(250 * 2 ** attempt, 4000),
      // Every watched group refreshes in the background; the group list shows
      // their names, and the selected one is also shown in full.
      on_background_sync: (replica) => {
        if (replica.group_id === device.selectedGroupId) device.replica = replica;

        void this.refreshAfterOperation();
      },
    });

    client.setOnline(device.online);

    const created = { secret, client };

    this.runtimes.set(key, created);

    return created;
  }

  /**
   * Applies the simulated device and server outages to realtime connections,
   * reporting an outage the way a dropped network connection would.
   */
  private openSocket(
    device: LabDevice,
    url: string,
    protocols: string[],
    handlers: RealtimeSocketHandlers,
  ): RealtimeSocket {
    let finished = false;
    let socket: RealtimeSocket | null = null;

    const finish = (code: number, reason: string) => {
      if (finished) return;

      finished = true;
      this.sockets.delete(tracked);
      handlers.close(code, reason);
    };

    const tracked: LabSocket = {
      drop: (reason) => {
        socket?.close(1000, reason);
        finish(1006, reason);
      },
    };

    if (!device.online || !this.state.server.online) {
      const reason = device.online ? 'server_offline' : 'device_offline';

      queueMicrotask(() => finish(1006, reason));

      return { close: () => finish(1000, 'unsubscribed') };
    }

    this.sockets.add(tracked);

    socket = this.webSocket(url, protocols, {
      open: () => {
        if (!finished) handlers.open();
      },
      message: (data) => {
        if (!finished) handlers.message(data);
      },
      close: finish,
    });

    return {
      close: (code, reason) => {
        socket?.close(code, reason);
        finish(code ?? 1000, reason ?? 'unsubscribed');
      },
    };
  }

  /** Selects a group on a device after it was opened, created, or joined. */
  private async openGroup(
    key: LabDeviceKey,
    replica: ClientReplicaState,
  ): Promise<void> {
    const device = this.device(key);

    device.selectedGroupId = replica.group_id;
    device.replica = replica;
    this.state.inspectedGroupId = replica.group_id;
    await this.refreshAfterOperation();
    this.watchIfEnabled(key);
  }

  /** Watches every active group stored on the device while Live is on. */
  private watchIfEnabled(key: LabDeviceKey): void {
    const device = this.device(key);

    if (!device.realtime) return;

    const client = this.runtime(key).client;

    for (const group of device.groups) {
      if (group.status === 'active' && group.stored_locally) {
        client.watchGroup(group.group_id);
      }
    }
  }

  private unwatchAll(key: LabDeviceKey): void {
    const client = this.runtimes.get(key)?.client;

    for (const group of this.device(key).groups) {
      client?.unwatchGroup(group.group_id);
    }
  }

  /** Sends queued changes for every group, as a client would on reconnecting. */
  private async deliverOutboxes(key: LabDeviceKey): Promise<void> {
    const device = this.device(key);
    const client = this.runtimes.get(key)?.client;

    if (!client) return;

    const pending = device.groups.filter(
      (group) =>
        group.pending_commands > 0 || group.group_id === device.selectedGroupId,
    );

    await Promise.all(
      pending.map(async (group) => {
        try {
          await client.syncGroup(group.group_id);
        } catch {
          // The traffic log already shows the failure; the outbox stays queued.
        }
      }),
    );
    await this.refreshAfterOperation();
  }

  private async mutate(
    key: LabDeviceKey,
    operation: (
      client: SplitnextSyncClient,
      groupId: string,
    ) => Promise<ClientReplicaState>,
  ): Promise<ClientReplicaState> {
    const replica = await operation(
      this.runtime(key).client,
      this.requireSelectedGroup(key),
    );

    this.device(key).replica = replica;
    await this.refreshAfterOperation();

    return replica;
  }

  private async refreshAfterOperation(): Promise<void> {
    await this.refreshReplicas();
    await this.refreshServerGroups();
    await this.refreshGroupInspection();
    this.changed();
  }

  /** Re-reads each device's local data; never touches the network. */
  private async refreshReplicas(): Promise<void> {
    await Promise.all(
      this.deviceKeys().map(async (key) => {
        const runtime = this.runtimes.get(key);

        if (!runtime) return;

        const device = this.device(key);

        device.groups = await runtime.client.knownGroups();

        if (device.selectedGroupId) {
          device.replica = await runtime.client.inspect(device.selectedGroupId);
          this.captureReplicaCommands(device);
        }
      }),
    );
  }

  private async refreshIdentityDirectory(): Promise<void> {
    this.state.server.identityDirectory = await this.inspect(
      '/debug/identity-directory',
      identityDirectoryInspectionSchema,
    );
  }

  private async refreshServerGroups(): Promise<void> {
    const result = await this.inspect('/debug/groups', serverGroupListSchema);

    if (!result) return;

    this.state.server.groups = result.groups;

    if (
      !this.state.inspectedGroupId ||
      !result.groups.some(
        (group) => group.group_id === this.state.inspectedGroupId,
      )
    ) {
      this.state.inspectedGroupId = result.groups[0]?.group_id ?? null;
    }
  }

  private async refreshGroupInspection(): Promise<void> {
    const groupId = this.state.inspectedGroupId;

    if (!groupId || !this.state.server.online) return;

    const inspection = await this.inspect(
      `/debug/groups/${encodeURIComponent(groupId)}`,
      groupInspectionSchema,
    );

    this.state.server.revision = inspection?.revision ?? null;
    this.state.server.snapshot = inspection?.snapshot ?? null;
    this.state.server.subscribers = inspection?.subscribers ?? [];
  }

  private async inspect<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    if (!this.state.server.online) return null;

    try {
      const response = await this.fetch(`${this.baseUrl}${path}`);

      if (!response.ok) return null;

      const parsed = schema.safeParse(await response.json());

      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private onTransportEvent(
    key: LabDeviceKey,
    event: ClientTransportEvent,
  ): void {
    switch (event.kind) {
      case 'request':
        this.onRequest(key, event);
        break;
      case 'response':
        this.onResponse(key, event);
        break;
      case 'network_error':
        this.onNetworkError(key, event);
        break;
      case 'realtime':
        this.onRealtimeEvent(key, event);
        break;
    }
  }

  private onRequest(key: LabDeviceKey, event: ClientRequestEvent): void {
    const device = this.device(key);

    const entry: LabRequest = {
      request_id: event.request_id,
      at: this.timestamp(),
      method: event.method,
      path: event.path,
      body: event.body,
      result: null,
    };

    pushLimited(device.requests, entry);
    this.markCommands(device, event.commands, 'syncing');

    if (device.online && this.state.server.online) {
      pushLimited(this.state.server.incoming, { from: device.label, ...entry });
    }

    this.changed();
  }

  private onResponse(key: LabDeviceKey, event: ClientResponseEvent): void {
    const device = this.device(key);

    const result: LabRequestResult = {
      kind: 'response',
      status: event.status,
      duration_ms: event.duration_ms,
      body: event.response,
    };

    completeRequest(device.requests, event, result);
    completeRequest(this.state.server.incoming, event, result, device.label);
    this.recordCommandResponse(device, event);
    this.changed();
  }

  private onRealtimeEvent(key: LabDeviceKey, event: ClientRealtimeEvent): void {
    const device = this.device(key);
    let detail: string;

    switch (event.phase) {
      case 'connecting':
        device.realtimeStatus = 'connecting';
        detail = 'Connecting';
        break;
      case 'open':
        device.realtimeStatus = 'open';
        detail = 'Subscribed to announcements';
        break;
      case 'message':
        detail = describeAnnouncement(event.data);
        break;
      case 'closed':
        device.realtimeStatus = 'disconnected';
        detail = `Closed ${event.code}${event.reason ? ` · ${event.reason}` : ''}`;
        break;
    }

    pushLimited(device.realtimeEvents, {
      at: this.timestamp(),
      phase: event.phase,
      detail,
    });
    this.changed();
  }

  private onNetworkError(key: LabDeviceKey, event: ClientNetworkErrorEvent): void {
    const device = this.device(key);

    completeRequest(device.requests, event, {
      kind: 'network_error',
      status: 0,
      duration_ms: event.duration_ms,
      error: event.error.message,
    });
    this.markCommands(
      device,
      event.commands,
      'queued',
      'Network unavailable; still queued',
    );
    this.changed();
  }

  private captureReplicaCommands(device: LabDevice): void {
    if (!device.replica) return;

    for (const pending of device.replica.outbox) {
      this.upsertCommand(device, pending.command, 'queued', pending.queued_at);
    }

    for (const notice of device.replica.notices) {
      this.upsertCommand(
        device,
        notice.command,
        notice.outcome.status,
        notice.recorded_at,
        notice.outcome.reason,
      );
    }
  }

  private markCommands(
    device: LabDevice,
    commands: GroupCommand[],
    status: string,
    detail: string | null = null,
  ): void {
    for (const command of commands) {
      this.upsertCommand(device, command, status, this.timestamp(), detail);
    }
  }

  private recordCommandResponse(
    device: LabDevice,
    event: ClientResponseEvent,
  ): void {
    const outcomes = event.outcomes;

    if (outcomes.length > 0) {
      for (const outcome of outcomes) {
        const existing = device.commands.find(
          ({ command }) => command.command_id === outcome.command_id,
        );

        if (!existing) continue;

        this.upsertCommand(
          device,
          existing.command,
          outcome.status,
          this.timestamp(),
          outcome.reason,
        );
      }

      return;
    }

    if (event.status >= 400) {
      this.markCommands(
        device,
        event.commands,
        'queued',
        `Server returned ${event.status}; still queued`,
      );
    }
  }

  private upsertCommand(
    device: LabDevice,
    command: GroupCommand,
    status: string,
    updatedAt: string,
    detail: string | null = null,
  ): void {
    const existing = device.commands.find(
      (entry) => entry.command.command_id === command.command_id,
    );

    if (existing) {
      existing.command = command;
      existing.status = status;
      existing.updated_at = updatedAt;
      existing.detail = detail;
    } else {
      device.commands.unshift({
        command,
        status,
        updated_at: updatedAt,
        detail,
      });
    }

    if (device.commands.length > 20) device.commands.length = 20;
  }

  private deviceKeys(): LabDeviceKey[] {
    return Object.keys(this.state.devices);
  }

  private device(key: LabDeviceKey): LabDevice {
    const device = this.state.devices[key];

    if (!device) throw new Error('device_not_found');

    return device;
  }

  private requireSelectedGroup(key: LabDeviceKey): string {
    const groupId = this.device(key).selectedGroupId;

    if (!groupId) throw new Error('group_not_selected');

    return groupId;
  }

  private timestamp(): string {
    return this.now().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private changed(): void {
    this.onChange(this.state);
  }
}

const identityDirectoryInspectionSchema = z.object({
  identities: z.array(
    z.object({
      id: z.string(),
      created_at: z.string(),
      devices: z.array(
        z.object({
          id: z.string(),
          created_at: z.string(),
          revoked_at: z.string().nullable(),
        }),
      ),
    }),
  ),
}) satisfies z.ZodType<IdentityDirectoryInspection>;

const resetResponseSchema = z.object({
  cleared_group_ids: z.array(z.string()),
});

const serverGroupListSchema = z.object({
  groups: z.array(
    z.object({
      group_id: z.string(),
      name: z.string(),
      currency_code: z.string(),
      revision: z.number().int().positive(),
    }),
  ),
});

const groupInspectionSchema = z.object({
  revision: z.number().int().positive(),
  snapshot: groupSnapshotSchema,
  subscribers: z.array(z.string()),
});

function newDevice(label: string): LabDevice {
  return {
    label,
    online: true,
    realtime: true,
    realtimeStatus: 'off',
    realtimeEvents: [],
    session: null,
    groups: [],
    selectedGroupId: null,
    replica: null,
    commands: [],
    requests: [],
  };
}

function completeRequest(
  requests: LabRequest[],
  event: ClientResponseEvent | ClientNetworkErrorEvent,
  result: LabRequestResult,
  source?: string,
): void {
  const entry = requests.find(
    (candidate) =>
      !candidate.result &&
      candidate.request_id === event.request_id &&
      (!source || candidate.from === source) &&
      candidate.method === event.method,
  );

  if (entry) entry.result = result;
}

function describeAnnouncement(data: string): string {
  try {
    const parsed = revisionAnnouncementSchema.safeParse(JSON.parse(data));

    if (parsed.success) return `Revision ${parsed.data.revision} announced`;
  } catch {
    // Unreadable messages are shown verbatim below.
  }

  return `Unrecognized message ${data}`;
}

function pushLimited<T>(values: T[], value: T): void {
  values.unshift(value);

  if (values.length > 20) values.length = 20;
}

function generateDeviceSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function requireInviteLink(link: string): { group_id: string; token: string } {
  const invite = parseInviteLink(link);

  if (!invite) throw new Error('invalid_invite_link');

  return invite;
}
