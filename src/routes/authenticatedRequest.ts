import { z } from '@hono/zod-openapi';
import { createMiddleware } from 'hono/factory';
import type { IdentitySession } from '../domain/identities';
import { IdentityDirectory } from '../identityDirectory';

export const deviceAuthorizationHeadersSchema = z.object({
  authorization: z
    .string()
    .regex(/^Bearer v1\.[A-Za-z0-9_-]{43}$/)
    .openapi({
      param: { name: 'authorization', in: 'header' },
      example: `Bearer v1.${'a'.repeat(43)}`,
    }),
});

export type AuthenticatedRequestEnvironment = {
  Bindings: Env;
  Variables: { identitySession: IdentitySession };
};

/** Owns credential parsing, device authentication, and HTTP failure mapping. */
export const authenticateDevice = createMiddleware<
  AuthenticatedRequestEnvironment
>(async (context, next) => {
  const parsed = deviceAuthorizationHeadersSchema.safeParse({
    authorization: context.req.header('authorization'),
  });

  if (!parsed.success) {
    return context.json({ error: 'unauthorized' as const }, 401);
  }

  const directory = new IdentityDirectory(context.env.INDEX);

  const session = await directory.authenticateDevice(
    parsed.data.authorization.slice('Bearer v1.'.length),
  );

  if (!session) return context.json({ error: 'unauthorized' as const }, 401);

  context.set('identitySession', session);
  await next();
});
