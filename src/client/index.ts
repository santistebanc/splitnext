import { z } from 'zod';
import {
  joinGroupRequestSchema,
  type JoinGroupRequest,
} from '../domain/access';
import { errorSchema } from '../domain/errors';
import {
  createGroupRequestSchema,
  type CreateGroupRequest,
} from '../domain/groups';
import {
  deviceSecretSchema,
  type IdentitySession,
} from '../domain/identities';
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

export type JsonValue = z.output<typeof jsonSchema>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type JoinedGroup = z.output<typeof groupSessionSchema>;

export type ClientRequestEvent = {
  method: string;
  path: string;
  body: JsonValue;
};

export type ClientResponseEvent = ClientRequestEvent & {
  status: number;
  response: JsonValue;
  duration_ms: number;
};

export type ClientNetworkErrorEvent = ClientRequestEvent & {
  error: Error;
  duration_ms: number;
};

export type ClientObserver = {
  onRequest?: (event: ClientRequestEvent) => void;
  onResponse?: (event: ClientResponseEvent) => void;
  onNetworkError?: (event: ClientNetworkErrorEvent) => void;
};

export type SplitnextClientOptions = {
  baseUrl: string;
  fetch?: Fetch;
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
  private readonly observer: ClientObserver;

  constructor(options: SplitnextClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.observer = options.observer ?? {};
  }

  async request<TSchema extends z.ZodType>(
    method: string,
    path: string,
    responseSchema: TSchema,
    options: { body?: JsonValue; deviceSecret?: string } = {},
  ): Promise<z.output<TSchema>> {
    const startedAt = Date.now();
    const body = options.body ?? null;
    const event = { method, path, body };

    notify(() => this.observer.onRequest?.(event));

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
        this.observer.onNetworkError?.({
          ...event,
          error,
          duration_ms: Date.now() - startedAt,
        }),
      );

      throw error;
    }

    const responseBody = await readResponseBody(response);

    notify(() =>
      this.observer.onResponse?.({
        ...event,
        status: response.status,
        response: responseBody,
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

export {
  JsonClientStorage,
  MemoryClientStorage,
  type ClientStorageAdapter,
} from './storage';

export {
  ClientOfflineError,
  SplitnextSyncClient,
  type ClientReplicaState,
  type ClientPreferredMemberChoice,
  type SyncDeviceTransport,
  type SyncTransport,
} from './syncClient';
