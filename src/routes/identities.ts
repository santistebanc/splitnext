import { createRoute, z } from '@hono/zod-openapi';
import {
  deviceSecretSchema,
  identitySessionSchema,
} from '../domain/identities';
import { accessibleGroupsSchema } from '../domain/groups';
import { GroupIndex } from '../groupIndex';
import { IdentityDirectory } from '../identityDirectory';
import {
  authenticateDevice,
  authenticatedRoutes,
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

const accessibleGroupsRoute = createRoute({
  method: 'get',
  path: '/identity/groups',
  tags: ['Identities'],
  summary: 'List the groups the identity can access, including ones it left',
  description:
    'A derived index refreshed whenever the identity creates, joins, or ' +
    'synchronizes a group, so a name changed by someone else appears after ' +
    'the identity next synchronizes that group.',
  security: [{ bearerAuth: [] }],
  request: { headers: deviceAuthorizationHeadersSchema },
  responses: {
    200: {
      description: 'Active groups first, then groups the identity has left.',
      content: { 'application/json': { schema: accessibleGroupsSchema } },
    },
    401: errorResponse('The device credential is unavailable or invalid.'),
  },
});

const identityApp = authenticatedRoutes();

identityApp.use('/identity', authenticateDevice);

identityApp.use('/identity/*', authenticateDevice);

export const identityRoutes = identityApp
  .openapi(createAnonymousIdentityRoute, async (context) => {
    const { device_secret } = context.req.valid('json');
    const directory = new IdentityDirectory(context.env.INDEX);
    const session = await directory.ensureAnonymousIdentity(device_secret);

    return context.json(session, 201);
  })
  .openapi(currentIdentityRoute, async (context) => {
    return context.json(context.get('identitySession'), 200);
  })
  .openapi(accessibleGroupsRoute, async (context) => {
    const session = context.get('identitySession');
    const groups = await new GroupIndex(context.env.INDEX).list(session.identity.id);

    return context.json({ groups }, 200);
  });
