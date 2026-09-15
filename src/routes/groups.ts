import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  ACCESS_TOKEN_PATTERN,
  accessTokenSchema,
  groupSchema,
} from '../groupObject';

const BEARER_PREFIX = 'Bearer ';

const errorSchema = z.object({ error: z.string() });

const groupParamsSchema = z.object({
  groupId: z.uuid().openapi({
    param: { name: 'groupId', in: 'path' },
  }),
});

const accessHeadersSchema = z.object({
  authorization: z
    .string()
    .regex(new RegExp(`^${BEARER_PREFIX}${ACCESS_TOKEN_PATTERN}$`))
    .openapi({
      param: { name: 'authorization', in: 'header' },
      description: 'The Bearer capability returned when the group was created.',
    }),
  'x-device-user-id': z.string().trim().min(1).max(128).openapi({
    param: { name: 'x-device-user-id', in: 'header' },
    description: 'The device identity that received this group capability.',
  }),
});

/** Both credentials arrive validated, so this only strips the scheme. */
function capabilityFrom(headers: z.infer<typeof accessHeadersSchema>) {
  return {
    accessToken: headers.authorization.slice(BEARER_PREFIX.length),
    deviceUserId: headers['x-device-user-id'],
  };
}

const createGroupRoute = createRoute({
  method: 'post',
  path: '/groups',
  tags: ['Groups'],
  summary: 'Create a group',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              name: z.string().trim().min(1).max(100),
              currency_label: z.string().trim().min(1).max(16).default('EUR'),
              device_user_id: z.string().trim().min(1).max(128),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The group and its creating-device capability were created.',
      content: {
        'application/json': {
          schema: z.object({ access_token: accessTokenSchema, group: groupSchema }),
        },
      },
    },
    400: {
      description: 'The request body is invalid.',
      content: { 'application/json': { schema: errorSchema } },
    },
    409: {
      description: 'The generated group identity already exists.',
      content: { 'application/json': { schema: errorSchema } },
    },
    500: {
      description: 'The group could not be created.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
});

const getGroupRoute = createRoute({
  method: 'get',
  path: '/groups/{groupId}',
  tags: ['Groups'],
  summary: 'Retrieve a group',
  description:
    'Requires the Bearer capability returned at creation and the matching X-Device-User-Id header.',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupParamsSchema,
    headers: accessHeadersSchema,
  },
  responses: {
    200: {
      description: 'The requested group.',
      content: { 'application/json': { schema: z.object({ group: groupSchema }) } },
    },
    400: {
      description: 'The group id is malformed.',
      content: { 'application/json': { schema: errorSchema } },
    },
    401: {
      description:
        'The capability or device identity is missing or invalid, or no such group exists. These are deliberately indistinguishable.',
      content: { 'application/json': { schema: errorSchema } },
    },
    500: {
      description: 'The group could not be retrieved.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
});

const updateGroupRoute = createRoute({
  method: 'patch',
  path: '/groups/{groupId}',
  tags: ['Groups'],
  summary: 'Update a group',
  description:
    'Requires the current group version so concurrent edits cannot silently overwrite each other.',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupParamsSchema,
    headers: accessHeadersSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              expected_version: z.number().int().positive(),
              name: z.string().trim().min(1).max(100).optional(),
              currency_label: z.string().trim().min(1).max(16).optional(),
            })
            .strict()
            .refine(
              ({ name, currency_label }) =>
                name !== undefined || currency_label !== undefined,
              { message: 'At least one editable field is required.' },
            ),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The updated group.',
      content: { 'application/json': { schema: z.object({ group: groupSchema }) } },
    },
    400: {
      description: 'The path, headers, or request body are invalid.',
      content: { 'application/json': { schema: errorSchema } },
    },
    401: {
      description: 'The group or capability is unavailable to this device.',
      content: { 'application/json': { schema: errorSchema } },
    },
    409: {
      description: 'The supplied version is stale.',
      content: { 'application/json': { schema: errorSchema } },
    },
    500: {
      description: 'The group could not be updated.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
});

const deleteGroupRoute = createRoute({
  method: 'delete',
  path: '/groups/{groupId}',
  tags: ['Groups'],
  summary: 'Delete a group',
  description:
    'Soft-deletes the group at its current version so referenced history is retained.',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupParamsSchema,
    headers: accessHeadersSchema,
    query: z.object({
      expected_version: z.coerce.number().int().positive().openapi({
        param: { name: 'expected_version', in: 'query' },
        description: 'The latest group version observed by the caller.',
      }),
    }),
  },
  responses: {
    200: {
      description: 'The deletion tombstone.',
      content: { 'application/json': { schema: z.object({ group: groupSchema }) } },
    },
    400: {
      description: 'The path, headers, or query are invalid.',
      content: { 'application/json': { schema: errorSchema } },
    },
    401: {
      description: 'The group or capability is unavailable to this device.',
      content: { 'application/json': { schema: errorSchema } },
    },
    409: {
      description: 'The supplied version is stale.',
      content: { 'application/json': { schema: errorSchema } },
    },
    500: {
      description: 'The group could not be deleted.',
      content: { 'application/json': { schema: errorSchema } },
    },
  },
});

export const groupRoutes = new OpenAPIHono<{ Bindings: Env }>({
  // One refusal path for the whole module. A bad credential is a header
  // failure, and headers are where both credentials are declared.
  defaultHook: (result, context) => {
    if (result.success) return;

    return result.target === 'header'
      ? context.json({ error: 'unauthorized' }, 401)
      : context.json({ error: 'invalid_request' }, 400);
  },
})
  .openapi(createGroupRoute, async (context) => {
    const input = context.req.valid('json');
    const groupId = crypto.randomUUID();
    const id = context.env.GROUPS.idFromName(groupId);

    const result = await context.env.GROUPS.get(id).createGroup({
      name: input.name,
      currency_label: input.currency_label,
      device_user_id: input.device_user_id,
    });

    if (!result.ok) {
      return context.json({ error: result.error }, 409);
    }

    return context.json(
      { access_token: result.access_token, group: result.group },
      201,
    );
  })
  .openapi(getGroupRoute, async (context) => {
    const { groupId } = context.req.valid('param');
    const { accessToken, deviceUserId } = capabilityFrom(context.req.valid('header'));

    const id = context.env.GROUPS.idFromName(groupId);

    const result = await context.env.GROUPS.get(id).getGroup(
      accessToken,
      deviceUserId,
    );

    if (!result.ok) {
      return context.json({ error: result.error }, 401);
    }

    return context.json({ group: result.group }, 200);
  })
  .openapi(updateGroupRoute, async (context) => {
    const { groupId } = context.req.valid('param');
    const { accessToken, deviceUserId } = capabilityFrom(context.req.valid('header'));
    const input = context.req.valid('json');

    const id = context.env.GROUPS.idFromName(groupId);

    const result = await context.env.GROUPS.get(id).updateGroup(
      accessToken,
      deviceUserId,
      input,
    );

    if (!result.ok) {
      const status = result.error === 'version_conflict' ? 409 : 401;

      return context.json({ error: result.error }, status);
    }

    return context.json({ group: result.group }, 200);
  })
  .openapi(deleteGroupRoute, async (context) => {
    const { groupId } = context.req.valid('param');
    const { accessToken, deviceUserId } = capabilityFrom(context.req.valid('header'));
    const { expected_version } = context.req.valid('query');

    const id = context.env.GROUPS.idFromName(groupId);

    const result = await context.env.GROUPS.get(id).deleteGroup(
      accessToken,
      deviceUserId,
      { expected_version },
    );

    if (!result.ok) {
      const status = result.error === 'version_conflict' ? 409 : 401;

      return context.json({ error: result.error }, status);
    }

    return context.json({ group: result.group }, 200);
  });
