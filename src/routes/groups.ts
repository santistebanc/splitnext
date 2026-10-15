import { groupFailureStatus } from '../groupTransport';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { joinGroupRequestSchema } from '../domain/access';
import { createdGroupSchema, createGroupRequestSchema } from '../domain/groups';
import { createIdentifier, identifierSchema } from '../domain/ids';
import {
  inviteLinkInputSchema,
  hashInviteToken,
  invitePreviewSchema,
  inviteResultSchema,
  previewInviteRequestSchema,
} from '../domain/invites';
import {
  groupSessionSchema,
  syncGroupRequestSchema,
  syncGroupResponseSchema,
} from '../domain/sync';
import { realtimeIdentityHeader } from '../groupObject';
import { GroupIndex } from '../groupIndex';
import { annotateRequest } from '../requestLog';
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
      description:
        'The created group, initial member selection, and immediately usable invite.',
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
    "Identities joining for the first time send the token from the group's current " +
    'invite link. Identities that already have access, including ones that left, ' +
    'rejoin without one. Preferred-member selection is nonexclusive. A new-member ' +
    'name that matches an active member selects that member without creating a duplicate.',
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
    403: errorResponse('The invite token is missing, unknown or revoked.'),
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

const regenerateInviteRoute = createRoute({
  method: 'put',
  path: '/groups/{groupId}/invite',
  tags: ['Invites'],
  summary: "Replace the group's single current invite link",
  description:
    'The client generates the token and shares `/join/{groupId}#{token}`. The ' +
    'server shares the current token in authenticated group snapshots. The same ' +
    'invite id and token make retries safe and never restore a replaced link.',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupIdParameter,
    headers: deviceAuthorizationHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: inviteLinkInputSchema } },
    },
  },
  responses: {
    200: {
      description: 'The current invite link as participants see it.',
      content: { 'application/json': { schema: inviteResultSchema } },
    },
    400: errorResponse('The request body is invalid.'),
    401: errorResponse('The identity has no current access to this group.'),
    404: errorResponse('The group does not exist.'),
    409: errorResponse('The invite id or token was already used differently.'),
  },
});

const previewInviteRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/invite/preview',
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
    403: errorResponse('The invite token is unknown or revoked.'),
    404: errorResponse('The group does not exist.'),
  },
});

const authenticatedGroupRoutes =
  new OpenAPIHono<AuthenticatedRequestEnvironment>({
    defaultHook: (result, context) => {
      if (result.success) return;

      return result.target === 'header'
        ? context.json({ error: 'unauthorized' }, 401)
        : context.json({ error: 'invalid_request' }, 400);
    },
  });

authenticatedGroupRoutes.use('/groups', authenticateDevice);

authenticatedGroupRoutes.use('/groups/*', authenticateDevice);

authenticatedGroupRoutes.use('/groups/:groupId/*', async (context, next) => {
  const groupId = identifierSchema.safeParse(context.req.param('groupId'));

  if (groupId.success) annotateRequest(context.req.raw, { group_id: groupId.data });
  await next();
});

export const groupRoutes = authenticatedGroupRoutes
  .openapi(createGroupRoute, async (context) => {
    const input = context.req.valid('json');
    const session = context.get('identitySession');

    annotateRequest(context.req.raw, { group_id: input.group_id });

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(input.group_id),
    );

    const result = await group.createGroup({
      group_id: input.group_id,
      name: input.name,
      creator_member_name: input.creator_member_name,
      invite_id: input.invite.invite_id,
      invite_token_hash: await hashInviteToken(input.invite.token),
      invite_token: input.invite.token,
      creator_identity_id: session.identity.id,
      member_id: createIdentifier(),
      created_at: new Date().toISOString(),
    });

    if (!result.ok) {
      return context.json({ error: result.error }, groupFailureStatus.create(result.error));
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
      invite_token_hash: inviteToken
        ? await hashInviteToken(inviteToken)
        : null,
    });

    if (!result.ok) {
      return context.json({ error: result.error }, groupFailureStatus.join(result.error));
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
      return context.json({ error: result.error }, groupFailureStatus.sync(result.error));
    }

    annotateRequest(context.req.raw, {
      known_revision: input.known_revision,
      revision: result.response.revision,
      outcomes: result.response.outcomes.map((outcome) => ({
        command_id: outcome.command_id,
        type: outcome.command_type,
        status: outcome.status,
        reason: outcome.reason,
      })),
    });

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
  .openapi(regenerateInviteRoute, async (context) => {
    const input = context.req.valid('json');
    const { groupId } = context.req.valid('param');
    const session = context.get('identitySession');
    const createdAt = new Date().toISOString();

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const result = await group.regenerateInvite({
      group_id: groupId,
      identity_id: session.identity.id,
      invite_id: input.invite_id,
      token_hash: await hashInviteToken(input.token),
      token: input.token,
      created_at: createdAt,
    });

    if (!result.ok) {
      return context.json({ error: result.error }, groupFailureStatus.invite(result.error));
    }

    return context.json(
      { revision: result.revision, invite: result.invite },
      200,
    );
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
      return context.json({ error: result.error }, groupFailureStatus.preview(result.error));
    }

    return context.json(result.preview, 200);
  });
