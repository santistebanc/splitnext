import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import { z } from 'zod';

/**
 * One structured log line per API request, carrying the request id the SDK
 * sends (or a new one), echoed in `x-request-id` so a client's diagnostics
 * report and the Worker logs can be matched. Lines hold identifiers, route,
 * status, timing, and outcome codes only: never names, tokens, credentials,
 * or request bodies.
 */

export type LogValue = string | number | boolean | null | readonly LogValue[] | { readonly [key: string]: LogValue };

export const requestIdHeader = 'x-request-id';

/** Ids the SDK creates are UUIDs; anything else is replaced, never logged. */
const requestIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

const errorBodySchema = z.object({ error: z.string().max(80) });

const annotations = new WeakMap<Request, Record<string, LogValue>>();

const requestIds = new WeakMap<Request, string>();

/** Adds identifiers or outcome codes to the current request's log line. */
export function annotateRequest(request: Request, fields: Record<string, LogValue>): void {
  annotations.set(request, { ...annotations.get(request), ...fields });
}

/** The id this request is logged under, for error logs. */
export function requestIdOf(request: Request): string | null {
  return requestIds.get(request) ?? null;
}

export const requestLogging = createMiddleware<{ Bindings: Env }>(async (context, next) => {
  const presented = requestIdSchema.safeParse(context.req.header(requestIdHeader));
  const requestId = presented.success ? presented.data : crypto.randomUUID();
  const started = Date.now();

  requestIds.set(context.req.raw, requestId);
  await next();

  const status = context.res.status;

  // Upgraded WebSocket responses cannot take new headers.
  if (status !== 101) context.header(requestIdHeader, requestId);

  // Tests switch request logs off; every deployed Worker writes them.
  if (String(context.env.LOG_REQUESTS) === 'false') return;

  const failure = status >= 400
    ? errorBodySchema.safeParse(await context.res.clone().json().catch(() => null))
    : null;

  console.log(JSON.stringify({
    event: 'request',
    request_id: requestId,
    method: context.req.method,
    // The endpoint matched, even when middleware such as authentication answered.
    route: routePath(context, -1),
    status,
    duration_ms: Date.now() - started,
    error: failure?.success ? failure.data.error : null,
    ...annotations.get(context.req.raw),
  }));
});
