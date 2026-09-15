import { z } from '@hono/zod-openapi';

const errorSchema = z.object({ error: z.string() });

/** Every refusal has the same body, so a route supplies only what it means. */
export function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: errorSchema } },
  };
}
