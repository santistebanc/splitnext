import type { ClientRequestContext } from './diagnostics';

export type { ClientDiagnosticEvent, ClientDiagnosticObserver, ClientRequestContext } from './diagnostics';

import { z } from 'zod';
import {
  joinGroupRequestSchema,
  type JoinGroupRequest,
} from '../domain/access';
import { SplitnextNetworkError, SplitnextProtocolError, SplitnextRequestError } from './errors';

export { SplitnextNetworkError, SplitnextProtocolError, SplitnextRequestError, clientErrorKind } from './errors';

import {
  commandOutcomeSchema,
  groupCommandSchema,
  type CommandOutcome,
  type GroupCommand,
} from '../domain/commands';
import {
  accessibleGroupsSchema,
  createGroupRequestSchema,
  type CreateGroupRequest,
} from '../domain/groups';
import { deviceSecretSchema, type IdentitySession } from '../domain/identities';
import {
  inviteLinkInputSchema,
  invitePreviewSchema,
  inviteResultSchema,
  previewInviteRequestSchema,
  type InviteLinkInput,
  type InvitePreview,
} from '../domain/invites';
import { realtimeProtocols } from '../domain/realtime';
import { syncGroupRequestSchema, type SyncGroupRequest } from '../domain/sync';
import {
  createdGroupSchema,
  groupSessionSchema,
  healthResponseSchema,
  identitySessionSchema,
  jsonSchema,
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
  invocation_ids: string[];
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
      kind: 'network_error' | 'protocol_error';
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

export class SplitnextClient {
  private readonly transport: Transport;

  constructor(options: SplitnextClientOptions) {
    this.transport = new Transport(options);
  }

  health() {
    return this.transport.request('GET', '/health', healthResponseSchema);
  }

  createAnonymousIdentity(deviceSecret: string, context?: ClientRequestContext): Promise<IdentitySession> {
    const body = jsonSchema.parse({
      device_secret: deviceSecretSchema.parse(deviceSecret),
    });

    return this.transport.request(
      'POST',
      '/identities/anonymous',
      identitySessionSchema,
      { body, context },
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

  listGroups(context?: ClientRequestContext) {
    return this.request('GET', '/identity/groups', accessibleGroupsSchema, { context });
  }

  async createGroup(input: CreateGroupRequest, context?: ClientRequestContext) {
    const body = jsonSchema.parse(createGroupRequestSchema.parse(input));

    return this.request('POST', '/groups', createdGroupSchema, { body, context });
  }

  async syncGroup(groupId: string, input: SyncGroupRequest, context?: ClientRequestContext) {
    const body = jsonSchema.parse(syncGroupRequestSchema.parse(input));

    return this.request(
      'POST',
      `/groups/${encodeURIComponent(groupId)}/sync`,
      syncGroupResponseSchema,
      { body, context },
    );
  }

  async regenerateInvite(groupId: string, input: InviteLinkInput, context?: ClientRequestContext) {
    const body = jsonSchema.parse(inviteLinkInputSchema.parse(input));

    return this.request(
      'PUT',
      `/groups/${encodeURIComponent(groupId)}/invite`,
      inviteResultSchema,
      { body, context },
    );
  }

  /** The token travels in the body, never in a URL. */
  async previewInvite(groupId: string, token: string, context?: ClientRequestContext): Promise<InvitePreview> {
    const body = jsonSchema.parse(previewInviteRequestSchema.parse({ token }));

    return this.request(
      'POST',
      `/groups/${encodeURIComponent(groupId)}/invite/preview`,
      invitePreviewSchema,
      { body, context },
    );
  }

  async joinGroup(groupId: string, input: JoinGroupRequest, context?: ClientRequestContext): Promise<JoinedGroup> {
    const body = jsonSchema.parse(joinGroupRequestSchema.parse(input));

    return this.request(
      'POST',
      `/groups/${encodeURIComponent(groupId)}/join`,
      groupSessionSchema,
      { body, context },
    );
  }

  /** Opens one revision-announcement subscription; see RealtimeSubscriptions. */
  openRealtime(
    groupId: string,
    handlers: RealtimeSocketHandlers,
  ): RealtimeSocket {
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
    options: { body?: JsonValue; context?: ClientRequestContext | undefined } = {},
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
    options: { body?: JsonValue; deviceSecret?: string; context?: ClientRequestContext | undefined } = {},
  ): Promise<z.output<TSchema>> {
    const startedAt = Date.now();
    const body = options.body ?? null;

    const exchange = {
      request_id: options.context?.request_id ?? createRequestId(),
      method,
      path,
      body: diagnosticBody(body),
      commands: commandsFrom(body),
      invocation_ids: options.context?.invocation_ids ?? [],
    };

    notify(() => this.observer({ kind: 'request', ...exchange }));

    // The Worker logs requests under this id, so client diagnostics match its logs.
    const headers = new Headers({ accept: 'application/json', 'x-request-id': exchange.request_id });

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
      const error = new SplitnextNetworkError(cause);

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

    let responseBody: JsonValue;

    try {
      responseBody = await readResponseBody(response);
    } catch (error) {
      notify(() => this.observer({
        ...exchange, kind: error instanceof SplitnextProtocolError ? 'protocol_error' : 'network_error',
        error: error instanceof Error ? error : new SplitnextNetworkError(error),
        duration_ms: Date.now() - startedAt,
      }));
      throw error;
    }

    notify(() =>
      this.observer({
        kind: 'response',
        ...exchange,
        status: response.status,
        response: diagnosticBody(responseBody),
        outcomes: outcomesFrom(responseBody),
        duration_ms: Date.now() - startedAt,
      }),
    );

    if (!response.ok) {
      throw new SplitnextRequestError(response.status, responseBody);
    }

    const parsed = responseSchema.safeParse(responseBody);

    if (!parsed.success) {
      const error = new SplitnextProtocolError('invalid_response', responseBody);

      notify(() => this.observer({ ...exchange, kind: 'protocol_error', error, duration_ms: Date.now() - startedAt }));
      throw error;
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
  let text: string;

  try {
    text = await response.text();
  } catch (cause) {
    throw new SplitnextNetworkError(cause);
  }

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
  if (Array.isArray(body)) return body.map(diagnosticBody);

  const parsed = diagnosticObjectSchema.safeParse(body);

  if (!parsed.success) return body;

  return Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [
      key,
      key === 'device_secret' || key === 'token' || key === 'invite_token'
        ? '[redacted]'
        : diagnosticBody(value),
    ]),
  );
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
  formatInviteLink,
  inviteTokenSchema,
  parseInviteLink,
  type GroupInvite,
  type InvitePreview,
} from '../domain/invites';

export { activeMembers, joinedParticipants, memberLabel, nameOrdinals, participantsForMember, preferredMember, previewFromSnapshot } from '../domain/selectors';

export { requiresServerDecision, type CommandIntent } from '../domain/commands';

export { groupNameSchema } from '../domain/groups';

export { createDeviceSecret, deviceSecretSchema } from '../domain/identities';

export { identifierSchema } from '../domain/ids';

export { memberNameSchema, type LedgerMember } from '../domain/members';

export {
  allocate,
  currencyCodeSchema,
  formatAmount,
  minorDigits,
  parseAmount,
  type AllocationPart,
  type CurrencyBalances,
  type CurrencyCode,
} from '../domain/money';

export { expenseDescriptionSchema, groupBalances, roundingBurden, type Expense, type ExpenseEntry } from '../domain/expenses';

export {
  browserWebSocket,
  type RealtimeSocket,
  type RealtimeSocketFactory,
  type RealtimeSocketHandlers,
} from './realtime';

export {
  ClientOfflineError,
  SplitnextSyncClient,
  type ClientInstallationState,
  type ClientReplicaState,
  type ClientGroupCreationInput,
  type ClientPreferredMemberChoice,
  type ClientGroupSummary,
  type SyncDeviceTransport,
  type SyncTransport,
} from './syncClient';
