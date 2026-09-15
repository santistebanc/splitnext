import { z } from '@hono/zod-openapi';

const errorSchema = z.object({ error: z.string() });

/** Every refusal has the same body, so a route supplies only what it means. */
export function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: errorSchema } },
  };
}

/**
 * What every refusal the API can produce means over HTTP, stated once and
 * keyed by the name rather than by which result type carries it. Indexing this
 * with a narrow error union yields a narrow status union, so a route still
 * declares only the statuses it can actually return.
 */
export const REFUSAL_STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  member_not_found: 404,
  group_exists: 409,
  version_conflict: 409,
  group_deleted: 410,
  member_deleted: 410,
} as const;
