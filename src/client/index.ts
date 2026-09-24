import { z } from 'zod';
import {
  joinGroupRequestSchema,
  type JoinGroupRequest,
} from '../domain/access';
import { errorSchema } from '../domain/errors';
import {
  commandOutcomeSchema,
  groupCommandSchema,
  type CommandOutcome,
  type GroupCommand,
} from '../domain/commands';
import {
  createGroupRequestSchema,
  type CreateGroupRequest,
} from '../domain/groups';
import {
  deviceSecretSchema,
  type IdentitySession,
} from '../domain/identities';
import { realtimeProtocols } from '../domain/realtime';
import {
  syncGroupRequestSchema,
  type SyncGroupRequest,
} from '../domain/sync';
import {
  createdGroupSchema,
  groupSessionSchema,
  healthResponseSchema,
  identitySessionSchema,
  jsonSchema,
  readinessResponseSchema,
  syncGroupResponseSchema,
} from './contracts';
import {
  browserWebSocket,
  type RealtimeSocket,
  type RealtimeSocketFactory,
  type RealtimeSocketHandlers,
} from './realtime';

export type JsonValue = z.output<typeof jsonSchema>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type JoinedGroup = z.output<typeof groupSessionSchema>;

type ClientExchange = {
  request_id: string;
  method: string;
  path: string;
  body: JsonValue;
  commands: GroupCommand[];
};

export type ClientTransportEvent =
  | (ClientExchange & { kind: 'request' })
  | (ClientExchange & {
      kind: 'response';
      status: number;
      response: JsonValue;
      outcomes: CommandOutcome[];
      duration_ms: number;
    })
  | (ClientExchange & {
      kind: 'network_error';
      error: Error;
      duration_ms: number;
    })
  | ClientRealtimeEvent;

export type ClientRealtimeEvent = {
  kind: 'realtime';
  request_id: string;
  path: string;
} & (
  | { phase: 'connecting' }
  | { phase: 'open' }
  | { phase: 'message'; data: string }
  | { phase: 'closed'; code: number; reason: string }
);

export type ClientObserver = (event: ClientTransportEvent) => void;

export type SplitnextClientOptions = {
  baseUrl: string;
  fetch?: Fetch;
  webSocket?: RealtimeSocketFactory;
  observer?: ClientObserver;
};

export class SplitnextRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly response: JsonValue;

  constructor(status: number, response: JsonValue) {
    const parsed = errorSchema.safeParse(response);
    const code = parsed.success ? parsed.data.error : `http_${status}`;

    super(code);
    this.name = 'SplitnextRequestError';
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

export class SplitnextProtocolError extends Error {
  readonly response: JsonValue;

  constructor(
    code: 'invalid_json_response' | 'invalid_response',
    response: JsonValue,
  ) {
    super(code);
    this.name = 'SplitnextProtocolError';
    this.response = response;
  }
}

export class SplitnextClient {
  private readonly transport: Transport;

  constructor(options: SplitnextClientOptions) {
    this.transport = new Transport(options);
  }

  health() {
    return this.transport.request('GET', '/health', healthResponseSchema);
  }

  readiness() {
    return this.transport.request('GET', '/ready', readinessResponseSchema);
  }

  createAnonymousIdentity(deviceSecret: string): Promise<IdentitySession> {
    const body = jsonSchema.parse({
      device_secret: deviceSecretSchema.parse(deviceSecret),
    });

    return this.transport.request(
      'POST',
      '/identities/anonymous',
      identitySessionSchema,
      { body },
    );
  }

  forDevice(deviceSecret: string): SplitnextDeviceClient {
    return new SplitnextDeviceClient(
      this.transport,
      deviceSecretSchema.parse(deviceSecret),
    );
  }
}

export class SplitnextDeviceClient {
  constructor(
    private readonly transport: Transport,
    private readonly deviceSecret: string,
  ) {}

  currentIdentity(): Promise<IdentitySession> {
    return this.request('GET', '/identity', identitySessionSchema);
  }

  createGroup(input: CreateGroupRequest) {
    const body = jsonSchema.parse(createGroupRequestSchema.parse(input));

    return this.request('POST', '/groups', createdGroupSchema, { body });
  }

  syncGroup(groupId: string, input: SyncGroupRequest) {
    const body = jsonSchema.parse(syncGroupRequestSchema.parse(input));

    return this.request(
      'POST',
      `/groups/${encodeURIComponent(groupId)}/sync`,
      syncGroupResponseSchema,
      { body },
    );
  }

  joinGroup(
    groupId: string,
    input: JoinGroupRequest,
  ): Promise<JoinedGroup> {
    const body = jsonSchema.parse(joinGroupRequestSchema.parse(input));

    return this.request(
      'POST',
      `/groups/${encodeURIComponent(groupId)}/join`,
      groupSessionSchema,
      { body },
    );
  }

  /** Opens one revision-announcement subscription; see RealtimeSubscriptions. */
  openRealtime(groupId: string, handlers: RealtimeSocketHandlers): RealtimeSocket {
    return this.transport.openRealtime(
      `/groups/${encodeURIComponent(groupId)}/realtime`,
      realtimeProtocols(this.deviceSecret),
      handlers,
    );
  }

  private request<TSchema extends z.ZodType>(
    method: string,
    path: string,
    responseSchema: TSchema,
    options: { body?: JsonValue } = {},
  ): Promise<z.output<TSchema>> {
    return this.transport.request(method, path, responseSchema, {
      ...options,
      deviceSecret: this.deviceSecret,
    });
  }
}

class Transport {
  private readonly baseUrl: string;
  private readonly fetch: Fetch;
  private readonly webSocket: RealtimeSocketFactory;
  private readonly observer: ClientObserver;

  constructor(options: SplitnextClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.webSocket = options.webSocket ?? browserWebSocket;
    this.observer = options.observer ?? (() => undefined);
  }

  async request<TSchema extends z.ZodType>(
    method: string,
    path: string,
    responseSchema: TSchema,
    options: { body?: JsonValue; deviceSecret?: string } = {},
  ): Promise<z.output<TSchema>> {
    const startedAt = Date.now();
    const body = options.body ?? null;

    const exchange = {
      request_id: createRequestId(),
      method,
      path,
      body: diagnosticBody(body),
      commands: commandsFrom(body),
    };

    notify(() => this.observer({ kind: 'request', ...exchange }));

    const headers = new Headers({ accept: 'application/json' });

    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    if (options.deviceSecret) {
      headers.set('authorization', `Bearer v1.${options.deviceSecret}`);
    }

    const request: RequestInit = { method, headers };

    if (options.body !== undefined) {
      request.body = JSON.stringify(options.body);
    }

    let response: Response;

    try {
      response = await this.fetch(`${this.baseUrl}${path}`, request);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('network_error');

      notify(() =>
        this.observer({
          kind: 'network_error',
          ...exchange,
          error,
          duration_ms: Date.now() - startedAt,
        }),
      );

      throw error;
    }

    const responseBody = await readResponseBody(response);

    notify(() =>
      this.observer({
        kind: 'response',
        ...exchange,
        status: response.status,
        response: responseBody,
        outcomes: outcomesFrom(responseBody),
        duration_ms: Date.now() - startedAt,
      }),
    );

    if (!response.ok) {
      throw new SplitnextRequestError(response.status, responseBody);
    }

    const parsed = responseSchema.safeParse(responseBody);

    if (!parsed.success) {
      throw new SplitnextProtocolError('invalid_response', responseBody);
    }

    return parsed.data;
  }

  openRealtime(
    path: string,
    protocols: string[],
    handlers: RealtimeSocketHandlers,
  ): RealtimeSocket {
    const connection = {
      kind: 'realtime' as const,
      request_id: createRequestId(),
      path,
    };

    const url = `${this.baseUrl.replace(/^http/, 'ws')}${path}`;

    notify(() => this.observer({ ...connection, phase: 'connecting' }));

    return this.webSocket(url, protocols, {
      open: () => {
        notify(() => this.observer({ ...connection, phase: 'open' }));
        handlers.open();
      },
      message: (data) => {
        notify(() => this.observer({ ...connection, phase: 'message', data }));
        handlers.message(data);
      },
      close: (code, reason) => {
        notify(() =>
          this.observer({ ...connection, phase: 'closed', code, reason }),
        );
        handlers.close(code, reason);
      },
    });
  }
}

async function readResponseBody(response: Response): Promise<JsonValue> {
  const text = await response.text();

  if (!text) return null;

  try {
    return jsonSchema.parse(JSON.parse(text));
  } catch {
    throw new SplitnextProtocolError('invalid_json_response', null);
  }
}

function notify(callback: () => void): void {
  try {
    callback();
  } catch {
    // Diagnostics must never change request behavior.
  }
}

const commandEnvelopeSchema = z.object({
  commands: z.array(groupCommandSchema),
});

const outcomeEnvelopeSchema = z.object({
  outcomes: z.array(commandOutcomeSchema),
});

const diagnosticObjectSchema = z.record(z.string(), jsonSchema);

function commandsFrom(body: JsonValue): GroupCommand[] {
  const parsed = commandEnvelopeSchema.safeParse(body);

  return parsed.success ? parsed.data.commands : [];
}

function outcomesFrom(body: JsonValue): CommandOutcome[] {
  const parsed = outcomeEnvelopeSchema.safeParse(body);

  return parsed.success ? parsed.data.outcomes : [];
}

function diagnosticBody(body: JsonValue): JsonValue {
  const parsed = diagnosticObjectSchema.safeParse(body);

  return parsed.success && parsed.data.device_secret
    ? { ...parsed.data, device_secret: '[redacted]' }
    : body;
}

function createRequestId(): string {
  return crypto.randomUUID();
}

export {
  ClientStorageError,
  IndexedDbClientStorage,
  MemoryClientStorage,
  type ClientStorageAdapter,
  type IndexedDbClientStorageOptions,
} from './storage';

export {
  browserWebSocket,
  type RealtimeSocket,
  type RealtimeSocketFactory,
  type RealtimeSocketHandlers,
} from './realtime';

export {
  ClientOfflineError,
  SplitnextSyncClient,
  type ClientReplicaState,
  type ClientPreferredMemberChoice,
  type SyncDeviceTransport,
  type SyncTransport,
} from './syncClient';
