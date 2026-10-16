import { OpenAPIHono, z } from '@hono/zod-openapi';
import { createMiddleware } from 'hono/factory';
import type { IdentitySession } from '../domain/identities';
import { credentialFromProtocols } from '../domain/realtime';
import { IdentityDirectory } from '../identityDirectory';
import { annotateRequest } from '../requestLog';

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

/** Routes whose invalid credentials are unauthorized and other invalid input a bad request. */
export function authenticatedRoutes() {
  return new OpenAPIHono<AuthenticatedRequestEnvironment>({
    defaultHook: (result, context) => {
      if (result.success) return;

      return result.target === 'header'
        ? context.json({ error: 'unauthorized' }, 401)
        : context.json({ error: 'invalid_request' }, 400);
    },
  });
}

/** Owns credential parsing, device authentication, and HTTP failure mapping. */
export const authenticateDevice = createMiddleware<
  AuthenticatedRequestEnvironment
>(async (context, next) => {
  const parsed = deviceAuthorizationHeadersSchema.safeParse({
    authorization: presentedCredential(context.req.raw.headers),
  });

  if (!parsed.success) {
    return context.json({ error: 'unauthorized' as const }, 401);
  }

  const directory = new IdentityDirectory(context.env.INDEX);

  const session = await directory.authenticateDevice(
    parsed.data.authorization.slice('Bearer v1.'.length),
  );

  if (!session) return context.json({ error: 'unauthorized' as const }, 401);

  annotateRequest(context.req.raw, { identity_id: session.identity.id });
  context.set('identitySession', session);
  await next();
});

/** WebSocket upgrades carry the credential as a subprotocol; see realtime. */
function presentedCredential(headers: Headers): string | undefined {
  const authorization = headers.get('authorization');

  if (authorization !== null) return authorization;

  if (headers.get('upgrade')?.toLowerCase() !== 'websocket') return undefined;

  return credentialFromProtocols(headers.get('sec-websocket-protocol'));
}
