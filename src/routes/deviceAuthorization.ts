import { z } from '@hono/zod-openapi';

export const deviceAuthorizationHeadersSchema = z.object({
  authorization: z
    .string()
    .regex(/^Bearer v1\.[A-Za-z0-9_-]{43}$/)
    .openapi({
      param: { name: 'authorization', in: 'header' },
      example: `Bearer v1.${'a'.repeat(43)}`,
    }),
});

export function readDeviceSecret(authorization: string): string {
  return authorization.slice('Bearer v1.'.length);
}
