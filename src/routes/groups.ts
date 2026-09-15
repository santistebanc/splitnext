import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createGroupInputSchema,
  groupSchema,
  groupVersionSchema,
  updateGroupInputSchema,
} from '../groupState';
import { accessTokenSchema, memberSchema } from '../memberDirectory';
import {
  accessHeadersSchema,
  capabilityFrom,
  groupParamsSchema,
} from './groupRequest';
import { errorResponse } from './responses';

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
          schema: createGroupInputSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description:
        'The group, creator member, and creating-device capability were created.',
      content: {
        'application/json': {
          schema: z.object({
            access_token: accessTokenSchema,
            group: groupSchema,
            member: memberSchema,
          }),
        },
      },
    },
    400: errorResponse('The request body is invalid.'),
    409: errorResponse('The generated group identity already exists.'),
    500: errorResponse('The group could not be created.'),
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
    400: errorResponse('The group id is malformed.'),
    401: errorResponse(
      'The capability or device identity is missing or invalid, or no such group exists. These are deliberately indistinguishable.',
    ),
    410: errorResponse('The group was deleted. The capability itself is still valid.'),
    500: errorResponse('The group could not be retrieved.'),
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
          schema: updateGroupInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The updated group.',
      content: { 'application/json': { schema: z.object({ group: groupSchema }) } },
    },
    400: errorResponse('The path, headers, or request body are invalid.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    409: errorResponse('The supplied version is stale.'),
    410: errorResponse('The group was deleted. The capability itself is still valid.'),
    500: errorResponse('The group could not be updated.'),
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
      expected_version: z.coerce
        .number()
        .pipe(groupVersionSchema)
        .openapi({
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
    400: errorResponse('The path, headers, or query are invalid.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    409: errorResponse('The supplied version is stale.'),
    410: errorResponse('The group was already deleted.'),
    500: errorResponse('The group could not be deleted.'),
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

    const result = await context.env.GROUPS.get(id).createGroup(input);

    if (!result.ok) {
      return result.error === 'invalid_request'
        ? context.json({ error: result.error }, 400)
        : context.json({ error: result.error }, 409);
    }

    return context.json(
      {
        access_token: result.access_token,
        group: result.group,
        member: result.member,
      },
      201,
    );
  })
  .openapi(getGroupRoute, async (context) => {
    const { groupId } = context.req.valid('param');
    const credential = capabilityFrom(context.req.valid('header'));

    const id = context.env.GROUPS.idFromName(groupId);

    const result = await context.env.GROUPS.get(id).getGroup(credential);

    if (!result.ok) {
      return result.error === 'group_deleted'
        ? context.json({ error: result.error }, 410)
        : context.json({ error: result.error }, 401);
    }

    return context.json({ group: result.group }, 200);
  })
  .openapi(updateGroupRoute, async (context) => {
    const { groupId } = context.req.valid('param');
    const credential = capabilityFrom(context.req.valid('header'));
    const input = context.req.valid('json');

    const id = context.env.GROUPS.idFromName(groupId);

    const result = await context.env.GROUPS.get(id).updateGroup(
      credential,
      input,
    );

    if (!result.ok) {
      return context.json({ error: result.error }, mutationStatus(result.error));
    }

    return context.json({ group: result.group }, 200);
  })
  .openapi(deleteGroupRoute, async (context) => {
    const { groupId } = context.req.valid('param');
    const credential = capabilityFrom(context.req.valid('header'));
    const { expected_version } = context.req.valid('query');

    const id = context.env.GROUPS.idFromName(groupId);

    const result = await context.env.GROUPS.get(id).deleteGroup(
      credential,
      { expected_version },
    );

    if (!result.ok) {
      return context.json({ error: result.error }, mutationStatus(result.error));
    }

    return context.json({ group: result.group }, 200);
  });

/** The one mapping from the group's refusals to statuses, for both mutations. */
function mutationStatus(
  error: 'invalid_request' | 'unauthorized' | 'group_deleted' | 'version_conflict',
): 400 | 401 | 409 | 410 {
  if (error === 'invalid_request') return 400;

  if (error === 'group_deleted') return 410;

  return error === 'version_conflict' ? 409 : 401;
}
