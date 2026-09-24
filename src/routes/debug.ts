import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { identifierSchema } from '../domain/ids';
import { IdentityDirectory } from '../identityDirectory';

/**
 * Durable Objects cannot be enumerated, so a reset erases the groups its
 * caller names and forgets every identity, which leaves any other group
 * unreachable except by direct join.
 */
const resetRequestSchema = z.object({
  group_ids: z.array(identifierSchema).max(100),
});

export const debugRoutes = new OpenAPIHono<{ Bindings: Env }>()
  .get('/debug/identity-directory', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const directory = new IdentityDirectory(context.env.INDEX);

    return context.json(await directory.inspect(), 200);
  })
  .get('/debug/groups/:groupId', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const parsed = identifierSchema.safeParse(context.req.param('groupId'));

    if (!parsed.success) return context.json({ error: 'not_found' }, 404);

    const group = context.env.GROUPS.get(
      context.env.GROUPS.idFromName(parsed.data),
    );

    const inspection = await group.inspectGroup(parsed.data);

    return inspection
      ? context.json(inspection, 200)
      : context.json({ error: 'not_found' }, 404);
  })
  .post('/debug/reset', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const parsed = resetRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );

    if (!parsed.success) return context.json({ error: 'invalid_request' }, 400);

    const groupIds = [...new Set(parsed.data.group_ids)];

    await Promise.all(
      groupIds.map((groupId) =>
        context.env.GROUPS.get(context.env.GROUPS.idFromName(groupId))
          .resetGroup(groupId),
      ),
    );
    await new IdentityDirectory(context.env.INDEX).clear();

    return context.json({ cleared_group_ids: groupIds }, 200);
  });

function debugEnabled(env: Env): boolean {
  return String(env.ENABLE_DEBUG_INSPECTION) === 'true';
}
