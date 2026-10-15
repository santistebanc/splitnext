import type { CommandOutcome } from '../domain/commands';
import type { ClientErrorKind } from './errors';

export type ClientInvocationIds = string | readonly string[];

export type ClientRequestContext = { request_id: string; invocation_ids?: string[] };

export type ClientExchange = {
  operation: string;
  group_id: string | null;
  invocation_ids: string[];
  command_ids: string[];
};

/** Metadata only: credentials, invite links, request bodies and drafts are excluded. */
export type ClientDiagnosticEvent =
  | { kind: 'command_queued'; group_id: string; command_id: string; invocation_id: string | null; retry_of: string | null }
  | (ClientExchange & ClientRequestContext & { kind: 'request' })
  | (ClientExchange & ClientRequestContext & { kind: 'response'; duration_ms: number; outcomes: Pick<CommandOutcome, 'command_id' | 'status' | 'reason'>[] })
  | (ClientExchange & ClientRequestContext & { kind: 'failure'; duration_ms: number; error_kind: ClientErrorKind; error: string });

export type ClientDiagnosticObserver = (event: ClientDiagnosticEvent) => void;
