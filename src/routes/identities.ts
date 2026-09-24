import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  deviceSecretSchema,
  identitySessionSchema,
} from '../domain/identities';
import { IdentityDirectory } from '../identityDirectory';
import {
  authenticateDevice,
  type AuthenticatedRequestEnvironment,
  deviceAuthorizationHeadersSchema,
} from './authenticatedRequest';
import { errorResponse } from './responses';

const createAnonymousIdentityRoute = createRoute({
  method: 'post',
  path: '/identities/anonymous',
  tags: ['Identities'],
  summary: 'Create or recover an anonymous identity for a device secret',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ device_secret: deviceSecretSchema }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The identity and its first device.',
      content: {
        'application/json': {
          schema: identitySessionSchema,
        },
      },
    },
    400: errorResponse('The request body is invalid.'),
    500: errorResponse('The identity could not be created.'),
  },
});

const currentIdentityRoute = createRoute({
  method: 'get',
  path: '/identity',
  tags: ['Identities'],
  summary: 'Read the identity authenticated by a device credential',
  security: [{ bearerAuth: [] }],
  request: { headers: deviceAuthorizationHeadersSchema },
  responses: {
    200: {
      description: 'The authenticated identity and device.',
      content: {
        'application/json': {
          schema: identitySessionSchema,
        },
      },
    },
    401: errorResponse('The device credential is unavailable or invalid.'),
    500: errorResponse('The identity could not be read.'),
  },
});

const identityApp = new OpenAPIHono<AuthenticatedRequestEnvironment>({
  defaultHook: (result, context) => {
    if (result.success) return;

    return result.target === 'header'
      ? context.json({ error: 'unauthorized' }, 401)
      : context.json({ error: 'invalid_request' }, 400);
  },
});

identityApp.use('/identity', authenticateDevice);

export const identityRoutes = identityApp
  .openapi(createAnonymousIdentityRoute, async (context) => {
    const { device_secret } = context.req.valid('json');
    const directory = new IdentityDirectory(context.env.INDEX);
    const session = await directory.ensureAnonymousIdentity(device_secret);

    return context.json(session, 201);
  })
  .openapi(currentIdentityRoute, async (context) => {
    return context.json(context.get('identitySession'), 200);
  });
