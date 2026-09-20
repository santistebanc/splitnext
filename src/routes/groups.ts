import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { v7 as uuidv7 } from 'uuid';
import { createGroupRequestSchema } from '../domain/groups';
import { IdentityDirectory } from '../identityDirectory';
import {
  deviceAuthorizationHeadersSchema,
  readDeviceSecret,
} from './deviceAuthorization';
import { errorResponse } from './responses';

const groupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  currency_code: z.string(),
  created_at: z.iso.datetime(),
  cursor: z.number().int().positive(),
});

const memberSchema = z.object({
  id: z.uuid(),
  display_name: z.string(),
  status: z.literal('active'),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

const accessSchema = z.object({
  identity_id: z.uuid(),
  actor_handle: z.string(),
  preferred_member_id: z.uuid(),
  granted_at: z.iso.datetime(),
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
          schema: z.object({
            group: groupSchema,
            member: memberSchema,
            access: accessSchema,
          }),
        },
      },
    },
    400: errorResponse('The request body is invalid.'),
    401: errorResponse('The device credential is unavailable or invalid.'),
    409: errorResponse('The group id has already been used.'),
    500: errorResponse('The group could not be created.'),
  },
});

export const groupRoutes = new OpenAPIHono<{ Bindings: Env }>({
  defaultHook: (result, context) => {
    if (result.success) return;

    return result.target === 'header'
      ? context.json({ error: 'unauthorized' }, 401)
      : context.json({ error: 'invalid_request' }, 400);
  },
}).openapi(createGroupRoute, async (context) => {
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
    event_id: uuidv7(),
    created_at: createdAt,
  });

  if (!result.ok) {
    if (result.error === 'invalid_request') {
      return context.json({ error: result.error }, 400);
    }

    return context.json({ error: result.error }, 409);
  }

  return context.json(result.created, 201);
});
