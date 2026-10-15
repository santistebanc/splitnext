import { errorSchema } from '../domain/errors';
import type { JsonValue } from './index';
import { ClientStorageError } from './storage';

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

export class SplitnextNetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'network_unavailable', { cause });
    this.name = 'SplitnextNetworkError';
  }
}

export type ClientErrorKind = 'network' | 'server' | 'protocol' | 'storage' | 'offline' | 'unexpected';

/** Fallback and retry policy depends on where a failure occurred. */
export function clientErrorKind(error: Error): ClientErrorKind {
  if (error instanceof SplitnextNetworkError) return 'network';

  if (error instanceof SplitnextRequestError) return 'server';

  if (error instanceof SplitnextProtocolError) return 'protocol';

  if (error instanceof ClientStorageError) return 'storage';

  if (error instanceof Error && error.name === 'ClientOfflineError') return 'offline';

  return 'unexpected';
}
