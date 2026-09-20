import { z } from '@hono/zod-openapi';

const errorSchema = z.object({ error: z.string() });

/** Every error response has the same body, so a route supplies only its meaning. */
export function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: errorSchema } },
  };
}
