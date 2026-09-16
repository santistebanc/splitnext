import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createGroupInviteInputSchema,
  groupInviteSchema,
  inviteTokenSchema,
} from '../inviteDirectory';
import {
  accessHeadersSchema,
  groupIdParameterSchema,
  groupParamsSchema,
  groupSession,
} from './groupRequest';
import { errorResponse, REFUSAL_STATUS } from './responses';

const inviteParamsSchema = z.object({
  groupId: groupIdParameterSchema,
  inviteId: z.uuid().openapi({
    param: { name: 'inviteId', in: 'path' },
  }),
});

const createGroupInviteRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/invites',
  tags: ['Invites'],
  summary: 'Create a group invite',
  description:
    'Creates a reusable group link. The secret and join URL are returned only by this response.',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupParamsSchema,
    headers: accessHeadersSchema,
    body: {
      required: true,
      content: {
        'application/json': { schema: createGroupInviteInputSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'The invite and its one-time visible secret.',
      content: {
        'application/json': {
          schema: z.object({
            invite: groupInviteSchema,
            invite_token: inviteTokenSchema,
            join_url: z.url(),
          }),
        },
      },
    },
    400: errorResponse('The path, headers, request body, or expiry is invalid.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    410: errorResponse('The group was deleted.'),
    500: errorResponse('The invite could not be created.'),
  },
});

const listGroupInvitesRoute = createRoute({
  method: 'get',
  path: '/groups/{groupId}/invites',
  tags: ['Invites'],
  summary: 'List group invites',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupParamsSchema,
    headers: accessHeadersSchema,
  },
  responses: {
    200: {
      description: 'Every group invite, without its secret.',
      content: {
        'application/json': {
          schema: z.object({ invites: z.array(groupInviteSchema) }),
        },
      },
    },
    400: errorResponse('The group id is malformed.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    410: errorResponse('The group was deleted.'),
    500: errorResponse('The invites could not be listed.'),
  },
});

const revokeGroupInviteRoute = createRoute({
  method: 'delete',
  path: '/groups/{groupId}/invites/{inviteId}',
  tags: ['Invites'],
  summary: 'Disable a group invite',
  description: 'Permanently revokes the link while retaining its record.',
  security: [{ bearerAuth: [] }],
  request: {
    params: inviteParamsSchema,
    headers: accessHeadersSchema,
  },
  responses: {
    200: {
      description: 'The disabled invite.',
      content: {
        'application/json': { schema: z.object({ invite: groupInviteSchema }) },
      },
    },
    400: errorResponse('The group or invite id is malformed.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    404: errorResponse('The invite does not exist.'),
    410: errorResponse('The group was deleted.'),
    500: errorResponse('The invite could not be disabled.'),
  },
});

export const inviteRoutes = new OpenAPIHono<{ Bindings: Env }>({
  defaultHook: (result, context) => {
    if (result.success) return;

    return result.target === 'header'
      ? context.json({ error: 'unauthorized' }, 401)
      : context.json({ error: 'invalid_request' }, 400);
  },
})
  .openapi(createGroupInviteRoute, async (context) => {
    const { groupId } = context.req.valid('param');

    const { group, credential } = groupSession(
      context.env,
      groupId,
      context.req.valid('header'),
    );

    const result = await group.createGroupInvite(
      credential,
      context.req.valid('json'),
    );

    if (!result.ok) {
      return context.json({ error: result.error }, REFUSAL_STATUS[result.error]);
    }

    const joinUrl = new URL(
      `/join/${groupId}/${result.invite_token}`,
      context.req.url,
    ).toString();

    return context.json(
      {
        invite: result.invite,
        invite_token: result.invite_token,
        join_url: joinUrl,
      },
      201,
    );
  })
  .openapi(listGroupInvitesRoute, async (context) => {
    const { groupId } = context.req.valid('param');

    const { group, credential } = groupSession(
      context.env,
      groupId,
      context.req.valid('header'),
    );

    const result = await group.listGroupInvites(credential);

    if (!result.ok) {
      return context.json({ error: result.error }, REFUSAL_STATUS[result.error]);
    }

    return context.json({ invites: result.invites }, 200);
  })
  .openapi(revokeGroupInviteRoute, async (context) => {
    const { groupId, inviteId } = context.req.valid('param');

    const { group, credential } = groupSession(
      context.env,
      groupId,
      context.req.valid('header'),
    );

    const result = await group.revokeGroupInvite(credential, inviteId);

    if (!result.ok) {
      return context.json({ error: result.error }, REFUSAL_STATUS[result.error]);
    }

    return context.json({ invite: result.invite }, 200);
  });
