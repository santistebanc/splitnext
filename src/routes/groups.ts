import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import {
  createdGroupSchema,
  createGroupRequestSchema,
  groupAccessGrantSchema,
} from '../domain/groups';
import {
  inviteTokenSchema,
  redeemGroupLinkRequestSchema,
} from '../domain/invites';
import {
  groupSnapshotSchema,
  syncGroupRequestSchema,
  syncGroupResponseSchema,
} from '../domain/sync';
import { IdentityDirectory } from '../identityDirectory';
import {
  deviceAuthorizationHeadersSchema,
  readDeviceSecret,
} from './deviceAuthorization';
import { errorResponse } from './responses';

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
      content: {
        'application/json': { schema: createGroupRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: 'The created group and its initial identity preferences.',
      content: {
        'application/json': {
          schema: createdGroupSchema,
        },
      },
    },
    400: errorResponse('The request body is invalid.'),
    401: errorResponse('The device credential is unavailable or invalid.'),
    409: errorResponse('The group id has already been used.'),
    500: errorResponse('The group could not be created.'),
  },
});

const syncGroupRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/sync',
  tags: ['Groups'],
  summary: 'Synchronize an authorized client with one group',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      groupId: z.uuid().openapi({ param: { name: 'groupId', in: 'path' } }),
    }),
    headers: deviceAuthorizationHeadersSchema,
    body: {
      required: true,
      content: {
        'application/json': { schema: syncGroupRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'The current snapshot or confirmation that it is unchanged.',
      content: {
        'application/json': { schema: syncGroupResponseSchema },
      },
    },
    400: errorResponse('The sync request is invalid.'),
    401: errorResponse('The identity has no access to this group.'),
    500: errorResponse('The group could not be synchronized.'),
  },
});

const rotateGroupLinkRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/invite-link',
  tags: ['Groups'],
  summary: 'Rotate the current reusable group link',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      groupId: z.uuid().openapi({ param: { name: 'groupId', in: 'path' } }),
    }),
    headers: deviceAuthorizationHeadersSchema,
  },
  responses: {
    201: {
      description: 'A new seven-day reusable group link.',
      content: {
        'application/json': {
          schema: z.object({
            revision: z.number().int().positive(),
            snapshot: groupSnapshotSchema,
            invite: z.object({
              id: z.uuid(),
              token: inviteTokenSchema,
              join_url: z.string(),
              created_at: z.iso.datetime(),
              expires_at: z.iso.datetime(),
            }),
          }),
        },
      },
    },
    401: errorResponse('The identity has no access to this group.'),
    500: errorResponse('The group link could not be rotated.'),
  },
});

const redeemGroupLinkRoute = createRoute({
  method: 'post',
  path: '/join/{groupId}/{inviteToken}',
  tags: ['Groups'],
  summary: 'Redeem a group link for permanent group access',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      groupId: z.uuid().openapi({ param: { name: 'groupId', in: 'path' } }),
      inviteToken: inviteTokenSchema.openapi({
        param: { name: 'inviteToken', in: 'path' },
      }),
    }),
    headers: deviceAuthorizationHeadersSchema,
    body: {
      required: true,
      content: {
        'application/json': { schema: redeemGroupLinkRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Permanent access and the initial group snapshot.',
      content: {
        'application/json': {
          schema: z.object({
            revision: z.number().int().positive(),
            snapshot: groupSnapshotSchema,
            access: groupAccessGrantSchema,
          }),
        },
      },
    },
    400: errorResponse('The join request is invalid.'),
    401: errorResponse('The group link is unavailable.'),
    409: errorResponse('The preferred member choice conflicts.'),
    500: errorResponse('The group link could not be redeemed.'),
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
    const { authorization } = context.req.valid('header');
    const identities = new IdentityDirectory(context.env.INDEX);

    const session = await identities.authenticateDevice(
      readDeviceSecret(authorization),
    );

    if (!session) return context.json({ error: 'unauthorized' }, 401);

    const objectId = context.env.GROUPS.idFromName(input.group_id);
    const group = context.env.GROUPS.get(objectId);
    const createdAt = new Date().toISOString();

    const result = await group.createGroup({
      ...input,
      creator_identity_id: session.identity.id,
      member_id: uuidv7(),
      created_at: createdAt,
    });

    if (!result.ok) {
      if (result.error === 'invalid_request') {
        return context.json({ error: result.error }, 400);
      }

      return context.json({ error: result.error }, 409);
    }

    return context.json(result.created, 201);
  })
  .openapi(syncGroupRoute, async (context) => {
    const input = context.req.valid('json');
    const { groupId } = context.req.valid('param');
    const { authorization } = context.req.valid('header');
    const identities = new IdentityDirectory(context.env.INDEX);

    const session = await identities.authenticateDevice(
      readDeviceSecret(authorization),
    );

    if (!session) return context.json({ error: 'unauthorized' }, 401);

    const objectId = context.env.GROUPS.idFromName(groupId);
    const group = context.env.GROUPS.get(objectId);

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
  })
  .openapi(rotateGroupLinkRoute, async (context) => {
    const { groupId } = context.req.valid('param');
    const { authorization } = context.req.valid('header');
    const identities = new IdentityDirectory(context.env.INDEX);

    const session = await identities.authenticateDevice(
      readDeviceSecret(authorization),
    );

    if (!session) return context.json({ error: 'unauthorized' }, 401);

    const token = generateSecret();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1_000);

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const result = await group.rotateGroupLink({
      group_id: groupId,
      identity_id: session.identity.id,
      invite_id: uuidv7(),
      token_hash: await hashSecret(token),
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    if (!result.ok) {
      return context.json({ error: result.error }, 401);
    }

    return context.json(
      {
        revision: result.revision,
        snapshot: result.snapshot,
        invite: {
          ...result.invite,
          token,
          join_url: `/join/${groupId}/${token}`,
        },
      },
      201,
    );
  })
  .openapi(redeemGroupLinkRoute, async (context) => {
    const input = context.req.valid('json');
    const { groupId, inviteToken } = context.req.valid('param');
    const { authorization } = context.req.valid('header');
    const identities = new IdentityDirectory(context.env.INDEX);

    const session = await identities.authenticateDevice(
      readDeviceSecret(authorization),
    );

    if (!session) return context.json({ error: 'unauthorized' }, 401);

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(groupId),
    );

    const result = await group.redeemGroupLink({
      ...input,
      group_id: groupId,
      identity_id: session.identity.id,
      token_hash: await hashSecret(inviteToken),
      joined_at: new Date().toISOString(),
    });

    if (!result.ok) {
      if (result.error === 'invalid_request') {
        return context.json({ error: result.error }, 400);
      }

      return result.error === 'invalid_invite'
        ? context.json({ error: result.error }, 401)
        : context.json({ error: result.error }, 409);
    }

    return context.json(
      {
        revision: result.revision,
        snapshot: result.snapshot,
        access: result.access,
      },
      200,
    );
  });

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
