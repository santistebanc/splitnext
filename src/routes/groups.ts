import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { joinGroupRequestSchema } from '../domain/access';
import {
  createdGroupSchema,
  createGroupRequestSchema,
} from '../domain/groups';
import { createIdentifier, identifierSchema } from '../domain/ids';
import {
  createInviteRequestSchema,
  hashInviteToken,
  inviteExpiry,
  invitePreviewSchema,
  inviteResultSchema,
  isInviteFailure,
  previewInviteRequestSchema,
  revokeInviteResultSchema,
} from '../domain/invites';
import {
  groupSessionSchema,
  syncGroupRequestSchema,
  syncGroupResponseSchema,
} from '../domain/sync';
import { realtimeIdentityHeader } from '../groupObject';
import { GroupIndex } from '../groupIndex';
import {
  authenticateDevice,
  type AuthenticatedRequestEnvironment,
  deviceAuthorizationHeadersSchema,
} from './authenticatedRequest';
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
  summary: 'Join a group through its invite link, or rejoin it',
  description:
    'Identities joining for the first time send the token from the group\'s current ' +
    'invite link. Identities that already have access, including ones that left, ' +
    'rejoin without one.',
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
    403: errorResponse(
      'The invite token is missing, unknown, expired, or revoked.',
    ),
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

const realtimeRoute = createRoute({
  method: 'get',
  path: '/groups/{groupId}/realtime',
  tags: ['Groups'],
  summary: 'Subscribe to revision announcements over a WebSocket',
  description:
    'Offer the subprotocols `splitnext.v1` and `splitnext.auth.v1.<device secret>`. ' +
    'The server selects `splitnext.v1` and sends `{ "type": "revision", "revision": n }` ' +
    'on connect and after every applied change. Clients synchronize in response.',
  request: { params: groupIdParameter },
  responses: {
    101: { description: 'The WebSocket subscription was accepted.' },
    401: errorResponse('The identity has no access to this group.'),
    403: errorResponse('The identity has left this group.'),
    404: errorResponse('The group does not exist.'),
    426: errorResponse('The request is not a WebSocket upgrade.'),
  },
});

const createInviteRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/invites',
  tags: ['Invites'],
  summary: 'Create the group\'s invite link, revoking any previous one',
  description:
    'The client generates the token and shares `/join/{groupId}#{token}`. The ' +
    'server stores only its hash, so repeating the request with the same ' +
    'invite id and token returns the same link.',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupIdParameter,
    headers: deviceAuthorizationHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: createInviteRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'The current invite link as participants see it.',
      content: { 'application/json': { schema: inviteResultSchema } },
    },
    400: errorResponse('The request body is invalid.'),
    401: errorResponse('The identity has no current access to this group.'),
    404: errorResponse('The group does not exist.'),
    409: errorResponse('The invite id or token was already used differently.'),
  },
});

const revokeInviteRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/invites/{inviteId}/revoke',
  tags: ['Invites'],
  summary: 'Revoke an invite link; access already granted remains',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupIdParameter.extend({
      inviteId: identifierSchema.meta({
        param: { name: 'inviteId', in: 'path' },
      }),
    }),
    headers: deviceAuthorizationHeadersSchema,
  },
  responses: {
    200: {
      description: 'The group revision after revocation.',
      content: { 'application/json': { schema: revokeInviteResultSchema } },
    },
    401: errorResponse('The identity has no current access to this group.'),
    404: errorResponse('The group or invite does not exist.'),
  },
});

const previewInviteRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/invites/preview',
  tags: ['Invites'],
  summary: 'Show a link holder the group before they join',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupIdParameter,
    headers: deviceAuthorizationHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: previewInviteRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'The group name and the active members to choose from.',
      content: { 'application/json': { schema: invitePreviewSchema } },
    },
    400: errorResponse('The request body is invalid.'),
    401: errorResponse('The device credential is unavailable or invalid.'),
    403: errorResponse('The invite token is unknown, expired, or revoked.'),
    404: errorResponse('The group does not exist.'),
  },
});

const authenticatedGroupRoutes = new OpenAPIHono<AuthenticatedRequestEnvironment>({
  defaultHook: (result, context) => {
    if (result.success) return;

    return result.target === 'header'
      ? context.json({ error: 'unauthorized' }, 401)
      : context.json({ error: 'invalid_request' }, 400);
  },
});

authenticatedGroupRoutes.use('/groups', authenticateDevice);

authenticatedGroupRoutes.use('/groups/*', authenticateDevice);

export const groupRoutes = authenticatedGroupRoutes
  .openapi(createGroupRoute, async (context) => {
    const input = context.req.valid('json');
    const session = context.get('identitySession');

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

    await new GroupIndex(context.env.INDEX).refresh(
      result.created.group,
      result.created.access,
    );

    return context.json(result.created, 201);
  })
  .openapi(joinGroupRoute, async (context) => {
    const input = context.req.valid('json');
    const { groupId } = context.req.valid('param');
    const session = context.get('identitySession');

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const { invite_token: inviteToken, ...request } = input;

    const result = await group.joinGroup({
      ...request,
      group_id: groupId,
      identity_id: session.identity.id,
      joined_at: new Date().toISOString(),
      invite_token_hash: inviteToken ? await hashInviteToken(inviteToken) : null,
    });

    if (!result.ok) {
      if (result.error === 'invalid_request') {
        return context.json({ error: result.error }, 400);
      }

      if (result.error === 'group_not_found') {
        return context.json({ error: result.error }, 404);
      }

      if (isInviteFailure(result.error)) {
        return context.json({ error: result.error }, 403);
      }

      return context.json({ error: result.error }, 409);
    }

    await new GroupIndex(context.env.INDEX).refresh(
      result.snapshot.group,
      result.access,
    );

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
    const session = context.get('identitySession');

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

    if (result.response.state.kind === 'snapshot') {
      await new GroupIndex(context.env.INDEX).refreshFromSnapshot(
        session.identity.id,
        result.response.state.snapshot,
      );
    }

    return context.json(result.response, 200);
  })
  .openapi(realtimeRoute, async (context) => {
    const { groupId } = context.req.valid('param');
    const session = context.get('identitySession');

    if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return context.json({ error: 'upgrade_required' as const }, 426);
    }

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const headers = new Headers(context.req.raw.headers);

    headers.set(realtimeIdentityHeader, session.identity.id);

    return group.fetch(new Request(context.req.raw, { headers }));
  })
  .openapi(createInviteRoute, async (context) => {
    const input = context.req.valid('json');
    const { groupId } = context.req.valid('param');
    const session = context.get('identitySession');
    const createdAt = new Date().toISOString();

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const result = await group.createInvite({
      group_id: groupId,
      identity_id: session.identity.id,
      invite_id: input.invite_id,
      token_hash: await hashInviteToken(input.token),
      created_at: createdAt,
      expires_at: inviteExpiry(createdAt, input.expires_in_hours),
    });

    if (!result.ok) {
      switch (result.error) {
        case 'invalid_request':
          return context.json({ error: result.error }, 400);
        case 'unauthorized':
          return context.json({ error: result.error }, 401);
        case 'group_not_found':
          return context.json({ error: result.error }, 404);
        case 'idempotency_conflict':
          return context.json({ error: result.error }, 409);
      }
    }

    return context.json(
      { revision: result.revision, invite: result.invite },
      201,
    );
  })
  .openapi(revokeInviteRoute, async (context) => {
    const { groupId, inviteId } = context.req.valid('param');
    const session = context.get('identitySession');

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const result = await group.revokeInvite(
      groupId,
      session.identity.id,
      inviteId,
    );

    if (!result.ok) {
      return result.error === 'unauthorized' || result.error === 'invalid_request'
        ? context.json({ error: 'unauthorized' as const }, 401)
        : context.json({ error: result.error }, 404);
    }

    return context.json({ revision: result.revision }, 200);
  })
  .openapi(previewInviteRoute, async (context) => {
    const { token } = context.req.valid('json');
    const { groupId } = context.req.valid('param');

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const result = await group.previewInvite(
      groupId,
      await hashInviteToken(token),
    );

    if (!result.ok) {
      if (result.error === 'invalid_request') {
        return context.json({ error: result.error }, 400);
      }

      return result.error === 'group_not_found'
        ? context.json({ error: result.error }, 404)
        : context.json({ error: result.error }, 403);
    }

    return context.json(result.preview, 200);
  });
