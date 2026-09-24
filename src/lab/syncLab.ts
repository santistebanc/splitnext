import type {
  ClientNetworkErrorEvent,
  ClientRequestEvent,
  ClientResponseEvent,
  JsonValue,
} from '../client';
import {
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
  type ClientReplicaState,
} from '../client';
import { z } from 'zod';
import {
  commandOutcomeSchema,
  groupCommandSchema,
  type GroupCommand,
} from '../domain/commands';
import type { CreateGroupRequest } from '../domain/groups';
import type { IdentitySession } from '../domain/identities';
import { groupSnapshotSchema, type GroupSnapshot } from '../domain/sync';
import type { IdentityDirectoryInspection } from '../identityDirectory';

export type LabDeviceKey = 'one' | 'two';

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

export type LabDevice = {
  label: string;
  online: boolean;
  session: IdentitySession | null;
  replica: ClientReplicaState | null;
  commands: LabCommand[];
  requests: LabRequest[];
};

export type LabServer = {
  online: boolean;
  identityDirectory: IdentityDirectoryInspection | null;
  revision: number | null;
  snapshot: GroupSnapshot | null;
  incoming: LabRequest[];
};

export type SyncLabState = {
  groupId: string | null;
  devices: Record<LabDeviceKey, LabDevice>;
  server: LabServer;
};

type DeviceRuntime = {
  secret: string;
  client: SplitnextSyncClient;
};

export type SyncLabOptions = {
  baseUrl: string;
  fetch?: LabFetch;
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
    groupId: null,
    devices: {
      one: newDevice('Device 1'),
      two: newDevice('Device 2'),
    },
    server: {
      online: true,
      identityDirectory: null,
      revision: null,
      snapshot: null,
      incoming: [],
    },
  };

  private readonly baseUrl: string;
  private readonly fetch: LabFetch;
  private readonly createDeviceSecret: () => string;
  private readonly now: () => Date;
  private readonly onChange: (state: SyncLabState) => void;
  private readonly runtimes = new Map<LabDeviceKey, DeviceRuntime>();
  private readonly systemApi: SplitnextClient;

  constructor(options: SyncLabOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
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

  async initializeDevices(): Promise<void> {
    await Promise.all(
      labDeviceKeys.map(async (key) => {
        const runtime = this.runtime(key);
        this.state.devices[key].session = await runtime.client.initializeIdentity();
      }),
    );
    await this.refreshServer();
    this.changed();
  }

  async createGroup(
    input: Omit<CreateGroupRequest, 'group_id'>,
  ): Promise<ClientReplicaState> {
    const replica = await this.runtime('one').client.createGroup(input);

    this.state.groupId = replica.group_id;
    this.state.devices.one.replica = replica;
    await this.refreshAfterOperation();

    return replica;
  }

  async joinGroup(groupId: string, displayName: string): Promise<ClientReplicaState> {
    const replica = await this.runtime('two').client.joinGroup(groupId, {
      kind: 'new',
      display_name: displayName,
    });

    this.state.groupId = groupId;
    this.state.devices.two.replica = replica;
    await this.refreshAfterOperation();

    return replica;
  }

  async toggleDevice(key: LabDeviceKey): Promise<void> {
    const device = this.state.devices[key];

    device.online = !device.online;
    this.runtimes.get(key)?.client.setOnline(device.online);
    this.changed();

    if (device.online && this.hasVisibleReplica(device)) {
      await this.syncDevice(key);
    }
  }

  toggleServer(): void {
    this.state.server.online = !this.state.server.online;
    this.changed();
  }

  async syncDevice(key: LabDeviceKey): Promise<ClientReplicaState | null> {
    const groupId = this.state.groupId;
    const runtime = this.runtimes.get(key);

    if (!groupId || !runtime || !this.state.devices[key].replica) return null;

    const replica = await runtime.client.syncGroup(groupId);

    this.state.devices[key].replica = replica;
    await this.refreshAfterOperation();

    return replica;
  }

  renameGroup(key: LabDeviceKey, name: string) {
    return this.mutate(key, (client, groupId) => client.renameGroup(groupId, name));
  }

  addMember(key: LabDeviceKey, displayName: string) {
    return this.mutate(key, (client, groupId) =>
      client.addMember(groupId, displayName),
    );
  }

  renameMember(key: LabDeviceKey, memberId: string, displayName: string) {
    return this.mutate(key, (client, groupId) =>
      client.renameMember(groupId, memberId, displayName),
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

  async rejoinGroup(key: LabDeviceKey): Promise<ClientReplicaState> {
    const groupId = this.requireGroupId();
    const device = this.state.devices[key];

    const member = device.replica?.confirmed_snapshot?.members.find(
      (candidate) => candidate.status === 'active',
    );

    if (!member) throw new Error('active_member_required');

    const replica = await this.runtime(key).client.joinGroup(groupId, {
      kind: 'existing',
      member_id: member.id,
    });

    device.replica = replica;
    await this.refreshAfterOperation();

    return replica;
  }

  async refreshServer(): Promise<void> {
    if (!this.state.server.online) return;

    await Promise.all([
      this.refreshIdentityDirectory(),
      this.refreshGroupInspection(),
    ]);
    this.changed();
  }

  clearDeviceTraffic(key: LabDeviceKey): void {
    this.state.devices[key].requests = [];
    this.changed();
  }

  clearServerTraffic(): void {
    this.state.server.incoming = [];
    this.changed();
  }

  private runtime(key: LabDeviceKey): DeviceRuntime {
    const existing = this.runtimes.get(key);

    if (existing) return existing;

    const device = this.state.devices[key];
    const secret = this.createDeviceSecret();

    const api = new SplitnextClient({
      baseUrl: this.baseUrl,
      fetch: async (input, init) => {
        if (!device.online) throw new TypeError('device_offline');

        if (!this.state.server.online) throw new TypeError('server_offline');

        return this.fetch(input, init);
      },
      observer: {
        onRequest: (event) => this.onRequest(key, event),
        onResponse: (event) => this.onResponse(key, event),
        onNetworkError: (event) => this.onNetworkError(key, event),
      },
    });

    const client = new SplitnextSyncClient({
      api,
      device_secret: secret,
      storage: new MemoryClientStorage(),
    });

    client.setOnline(device.online);

    const created = { secret, client };

    this.runtimes.set(key, created);

    return created;
  }

  private async mutate(
    key: LabDeviceKey,
    operation: (
      client: SplitnextSyncClient,
      groupId: string,
    ) => Promise<ClientReplicaState>,
  ): Promise<ClientReplicaState> {
    const replica = await operation(this.runtime(key).client, this.requireGroupId());

    this.state.devices[key].replica = replica;
    await this.refreshAfterOperation();

    return replica;
  }

  private async refreshAfterOperation(): Promise<void> {
    await Promise.all([this.refreshReplicas(), this.refreshGroupInspection()]);
    this.changed();
  }

  private async refreshReplicas(): Promise<void> {
    const groupId = this.state.groupId;

    if (!groupId) return;

    await Promise.all(
      labDeviceKeys.map(async (key) => {
        const runtime = this.runtimes.get(key);

        if (!runtime) return;

        const device = this.state.devices[key];

        device.replica = await runtime.client.inspect(groupId);
        this.captureReplicaCommands(device);
      }),
    );
  }

  private async refreshIdentityDirectory(): Promise<void> {
    this.state.server.identityDirectory = await this.inspect(
      '/debug/identity-directory',
      identityDirectoryInspectionSchema,
    );
  }

  private async refreshGroupInspection(): Promise<void> {
    const groupId = this.state.groupId;

    if (!groupId || !this.state.server.online) return;

    const inspection = await this.inspect(
      `/debug/groups/${encodeURIComponent(groupId)}`,
      groupInspectionSchema,
    );

    this.state.server.revision = inspection?.revision ?? null;
    this.state.server.snapshot = inspection?.snapshot ?? null;
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

  private onRequest(key: LabDeviceKey, event: ClientRequestEvent): void {
    const device = this.state.devices[key];

    const entry: LabRequest = {
      at: this.timestamp(),
      method: event.method,
      path: event.path,
      body: redactBody(event.body),
      result: null,
    };

    pushLimited(device.requests, entry);
    this.markCommands(device, commandsFrom(event.body), 'syncing');

    if (device.online && this.state.server.online) {
      pushLimited(this.state.server.incoming, { from: device.label, ...entry });
    }

    this.changed();
  }

  private onResponse(key: LabDeviceKey, event: ClientResponseEvent): void {
    const device = this.state.devices[key];

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

  private onNetworkError(key: LabDeviceKey, event: ClientNetworkErrorEvent): void {
    const device = this.state.devices[key];

    completeRequest(device.requests, event, {
      kind: 'network_error',
      status: 0,
      duration_ms: event.duration_ms,
      error: event.error.message,
    });
    this.markCommands(
      device,
      commandsFrom(event.body),
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
    const outcomes = outcomesFrom(event.response);

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
        commandsFrom(event.body),
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

  private hasVisibleReplica(device: LabDevice): boolean {
    return Boolean(device.replica && !device.replica.hidden);
  }

  private requireGroupId(): string {
    if (!this.state.groupId) throw new Error('group_not_selected');

    return this.state.groupId;
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

const labDeviceKeys: LabDeviceKey[] = ['one', 'two'];

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

const groupInspectionSchema = z.object({
  revision: z.number().int().positive(),
  snapshot: groupSnapshotSchema,
});

const commandEnvelopeSchema = z.object({
  commands: z.array(groupCommandSchema),
});

const outcomeEnvelopeSchema = z.object({
  outcomes: z.array(commandOutcomeSchema),
});

const redactableBodySchema = z.record(z.string(), z.json());

function newDevice(label: string): LabDevice {
  return {
    label,
    online: true,
    session: null,
    replica: null,
    commands: [],
    requests: [],
  };
}

function commandsFrom(body: JsonValue): GroupCommand[] {
  const parsed = commandEnvelopeSchema.safeParse(body);

  return parsed.success ? parsed.data.commands : [];
}

function outcomesFrom(body: JsonValue) {
  const parsed = outcomeEnvelopeSchema.safeParse(body);

  return parsed.success ? parsed.data.outcomes : [];
}

function completeRequest(
  requests: LabRequest[],
  event: ClientRequestEvent,
  result: LabRequestResult,
  source?: string,
): void {
  const body = JSON.stringify(redactBody(event.body));

  const entry = requests.find(
    (candidate) =>
      !candidate.result &&
      candidate.method === event.method &&
      candidate.path === event.path &&
      (!source || candidate.from === source) &&
      JSON.stringify(candidate.body) === body,
  );

  if (entry) entry.result = result;
}

function pushLimited<T>(values: T[], value: T): void {
  values.unshift(value);

  if (values.length > 20) values.length = 20;
}

function redactBody(body: JsonValue): JsonValue {
  const parsed = redactableBodySchema.safeParse(body);

  return parsed.success && parsed.data.device_secret
    ? { ...parsed.data, device_secret: '[redacted]' }
    : body;
}

function generateDeviceSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
