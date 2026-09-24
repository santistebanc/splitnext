import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { joinGroupRequestSchema } from '../domain/access';
import {
  createdGroupSchema,
  createGroupRequestSchema,
} from '../domain/groups';
import { createIdentifier, identifierSchema } from '../domain/ids';
import {
  groupSessionSchema,
  syncGroupRequestSchema,
  syncGroupResponseSchema,
} from '../domain/sync';
import { IdentityDirectory } from '../identityDirectory';
import {
  deviceAuthorizationHeadersSchema,
  readDeviceSecret,
} from './deviceAuthorization';
import { errorResponse } from './responses';

const groupIdParameter = z.object({
  groupId: identifierSchema.meta({
    param: { name: 'groupId', in: 'path' },
  }),
});

const createGroupRoute = createRoute({
  method: 'post',
  path: '/groups',
  tags: ['Groups'],
  summary: 'Create a group for the authenticated identity',
  security: [{ bearerAuth: [] }],
  request: {
    headers: deviceAuthorizationHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: createGroupRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'The created group and initial member selection.',
      content: { 'application/json': { schema: createdGroupSchema } },
    },
    400: errorResponse('The request body is invalid.'),
    401: errorResponse('The device credential is unavailable or invalid.'),
    409: errorResponse('The group id has already been used.'),
    500: errorResponse('The group could not be created.'),
  },
});

const joinGroupRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/join',
  tags: ['Groups'],
  summary: 'Join a known group without an invitation',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupIdParameter,
    headers: deviceAuthorizationHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: joinGroupRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Permanent access and the current group snapshot.',
      content: { 'application/json': { schema: groupSessionSchema } },
    },
    400: errorResponse('The join request is invalid.'),
    401: errorResponse('The device credential is unavailable or invalid.'),
    404: errorResponse('The group does not exist.'),
    409: errorResponse('The preferred member choice conflicts.'),
    500: errorResponse('The group could not be joined.'),
  },
});

const syncGroupRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/sync',
  tags: ['Groups'],
  summary: 'Synchronize an authorized client with one group',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupIdParameter,
    headers: deviceAuthorizationHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: syncGroupRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Command outcomes and the current snapshot when needed.',
      content: { 'application/json': { schema: syncGroupResponseSchema } },
    },
    400: errorResponse('The sync request is invalid.'),
    401: errorResponse('The identity has no access to this group.'),
    500: errorResponse('The group could not be synchronized.'),
  },
});

export const groupRoutes = new OpenAPIHono<{ Bindings: Env }>({
  defaultHook: (result, context) => {
    if (result.success) return;

    return result.target === 'header'
      ? context.json({ error: 'unauthorized' }, 401)
      : context.json({ error: 'invalid_request' }, 400);
  },
})
  .openapi(createGroupRoute, async (context) => {
    const input = context.req.valid('json');
    const session = await authenticate(context);

    if (!session) return context.json({ error: 'unauthorized' }, 401);

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(input.group_id),
    );

    const result = await group.createGroup({
      ...input,
      creator_identity_id: session.identity.id,
      member_id: createIdentifier(),
      created_at: new Date().toISOString(),
    });

    if (!result.ok) {
      if (result.error === 'invalid_request') {
        return context.json({ error: result.error }, 400);
      }

      return context.json({ error: result.error }, 409);
    }

    return context.json(result.created, 201);
  })
  .openapi(joinGroupRoute, async (context) => {
    const input = context.req.valid('json');
    const { groupId } = context.req.valid('param');
    const session = await authenticate(context);

    if (!session) return context.json({ error: 'unauthorized' }, 401);

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const result = await group.joinGroup({
      ...input,
      group_id: groupId,
      identity_id: session.identity.id,
      joined_at: new Date().toISOString(),
    });

    if (!result.ok) {
      if (result.error === 'invalid_request') {
        return context.json({ error: result.error }, 400);
      }

      if (result.error === 'group_not_found') {
        return context.json({ error: result.error }, 404);
      }

      return context.json({ error: result.error }, 409);
    }

    return context.json(
      {
        revision: result.revision,
        snapshot: result.snapshot,
        access: result.access,
      },
      200,
    );
  })
  .openapi(syncGroupRoute, async (context) => {
    const input = context.req.valid('json');
    const { groupId } = context.req.valid('param');
    const session = await authenticate(context);

    if (!session) return context.json({ error: 'unauthorized' }, 401);

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const result = await group.syncGroup({
      ...input,
      group_id: groupId,
      identity_id: session.identity.id,
    });

    if (!result.ok) {
      return result.error === 'invalid_request'
        ? context.json({ error: result.error }, 400)
        : context.json({ error: result.error }, 401);
    }

    return context.json(result.response, 200);
  });

async function authenticate(
  context: Context<{ Bindings: Env }>,
) {
  const authorization = context.req.header('authorization');

  if (!authorization) return null;

  const identities = new IdentityDirectory(context.env.INDEX);

  return identities.authenticateDevice(readDeviceSecret(authorization));
}
