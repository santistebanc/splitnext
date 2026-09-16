import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createMemberInputSchema,
  memberSchema,
  memberVersionSchema,
  updateMemberInputSchema,
} from '../memberDirectory';
import {
  accessHeadersSchema,
  groupIdParameterSchema,
  groupParamsSchema,
  groupSession,
} from './groupRequest';
import { errorResponse, REFUSAL_STATUS } from './responses';

const memberParamsSchema = z.object({
  groupId: groupIdParameterSchema,
  memberId: z.uuid().openapi({
    param: { name: 'memberId', in: 'path' },
  }),
});

const createMemberRoute = createRoute({
  method: 'post',
  path: '/groups/{groupId}/members',
  tags: ['Members'],
  summary: 'Create a member',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupParamsSchema,
    headers: accessHeadersSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createMemberInputSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The created member.',
      content: { 'application/json': { schema: z.object({ member: memberSchema }) } },
    },
    400: errorResponse('The path, headers, or request body are invalid.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    410: errorResponse('The group was deleted.'),
    500: errorResponse('The member could not be created.'),
  },
});

const listMembersRoute = createRoute({
  method: 'get',
  path: '/groups/{groupId}/members',
  tags: ['Members'],
  summary: 'List members',
  security: [{ bearerAuth: [] }],
  request: {
    params: groupParamsSchema,
    headers: accessHeadersSchema,
  },
  responses: {
    200: {
      description: 'The group’s active members.',
      content: {
        'application/json': { schema: z.object({ members: z.array(memberSchema) }) },
      },
    },
    400: errorResponse('The group id is malformed.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    410: errorResponse('The group was deleted.'),
    500: errorResponse('The members could not be listed.'),
  },
});

const getMemberRoute = createRoute({
  method: 'get',
  path: '/groups/{groupId}/members/{memberId}',
  tags: ['Members'],
  summary: 'Retrieve a member',
  security: [{ bearerAuth: [] }],
  request: {
    params: memberParamsSchema,
    headers: accessHeadersSchema,
  },
  responses: {
    200: {
      description: 'The requested member.',
      content: { 'application/json': { schema: z.object({ member: memberSchema }) } },
    },
    400: errorResponse('The group or member id is malformed.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    404: errorResponse('The member does not exist.'),
    410: errorResponse('The group or member was deleted.'),
    500: errorResponse('The member could not be retrieved.'),
  },
});

const updateMemberRoute = createRoute({
  method: 'patch',
  path: '/groups/{groupId}/members/{memberId}',
  tags: ['Members'],
  summary: 'Update a member',
  description:
    'Renames a member if the supplied version is still current.',
  security: [{ bearerAuth: [] }],
  request: {
    params: memberParamsSchema,
    headers: accessHeadersSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: updateMemberInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The updated member.',
      content: { 'application/json': { schema: z.object({ member: memberSchema }) } },
    },
    400: errorResponse('The path, headers, or request body are invalid.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    404: errorResponse('The member does not exist.'),
    409: errorResponse('The supplied version is stale.'),
    410: errorResponse('The group or member was deleted.'),
    500: errorResponse('The member could not be updated.'),
  },
});

const deleteMemberRoute = createRoute({
  method: 'delete',
  path: '/groups/{groupId}/members/{memberId}',
  tags: ['Members'],
  summary: 'Delete a member',
  description:
    'Soft-deletes a member at its current version so referenced history is retained.',
  security: [{ bearerAuth: [] }],
  request: {
    params: memberParamsSchema,
    headers: accessHeadersSchema,
    query: z.object({
      expected_version: z.coerce
        .number()
        .pipe(memberVersionSchema)
        .openapi({
          param: { name: 'expected_version', in: 'query' },
          description: 'The latest member version observed by the caller.',
        }),
    }),
  },
  responses: {
    200: {
      description: 'The member deletion tombstone.',
      content: { 'application/json': { schema: z.object({ member: memberSchema }) } },
    },
    400: errorResponse('The path, headers, or query are invalid.'),
    401: errorResponse('The group or capability is unavailable to this device.'),
    404: errorResponse('The member does not exist.'),
    409: errorResponse('The supplied version is stale.'),
    410: errorResponse('The group or member was already deleted.'),
    500: errorResponse('The member could not be deleted.'),
  },
});

export const memberRoutes = new OpenAPIHono<{ Bindings: Env }>({
  defaultHook: (result, context) => {
    if (result.success) return;

    return result.target === 'header'
      ? context.json({ error: 'unauthorized' }, 401)
      : context.json({ error: 'invalid_request' }, 400);
  },
})
  .openapi(createMemberRoute, async (context) => {
    const { groupId } = context.req.valid('param');

    const { group, credential } = groupSession(
      context.env,
      groupId,
      context.req.valid('header'),
    );

    const input = context.req.valid('json');

    const result = await group.createMember(
      credential,
      input,
    );

    if (!result.ok) {
      return context.json({ error: result.error }, REFUSAL_STATUS[result.error]);
    }

    return context.json({ member: result.member }, 201);
  })
  .openapi(listMembersRoute, async (context) => {
    const { groupId } = context.req.valid('param');

    const { group, credential } = groupSession(
      context.env,
      groupId,
      context.req.valid('header'),
    );

    const result = await group.listMembers(credential);

    if (!result.ok) {
      return context.json({ error: result.error }, REFUSAL_STATUS[result.error]);
    }

    return context.json({ members: result.members }, 200);
  })
  .openapi(getMemberRoute, async (context) => {
    const { groupId, memberId } = context.req.valid('param');

    const { group, credential } = groupSession(
      context.env,
      groupId,
      context.req.valid('header'),
    );

    const result = await group.getMember(
      credential,
      memberId,
    );

    if (!result.ok) {
      return context.json({ error: result.error }, REFUSAL_STATUS[result.error]);
    }

    return context.json({ member: result.member }, 200);
  })
  .openapi(updateMemberRoute, async (context) => {
    const { groupId, memberId } = context.req.valid('param');

    const { group, credential } = groupSession(
      context.env,
      groupId,
      context.req.valid('header'),
    );

    const input = context.req.valid('json');

    const result = await group.updateMember(
      credential,
      memberId,
      input,
    );

    if (!result.ok) {
      return context.json({ error: result.error }, REFUSAL_STATUS[result.error]);
    }

    return context.json({ member: result.member }, 200);
  })
  .openapi(deleteMemberRoute, async (context) => {
    const { groupId, memberId } = context.req.valid('param');

    const { group, credential } = groupSession(
      context.env,
      groupId,
      context.req.valid('header'),
    );

    const { expected_version } = context.req.valid('query');

    const result = await group.deleteMember(
      credential,
      memberId,
      { expected_version },
    );

    if (!result.ok) {
      return context.json({ error: result.error }, REFUSAL_STATUS[result.error]);
    }

    return context.json({ member: result.member }, 200);
  });
