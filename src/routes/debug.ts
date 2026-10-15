import { OpenAPIHono } from '@hono/zod-openapi';
import { identifierSchema } from '../domain/ids';
import { GroupIndex } from '../groupIndex';
import { IdentityDirectory } from '../identityDirectory';

export const debugRoutes = new OpenAPIHono<{ Bindings: Env }>()
  // Lets development tools in the app check whether inspection is enabled.
  .get('/debug/status', (context) =>
    debugEnabled(context.env)
      ? context.json({ enabled: true }, 200)
      : context.json({ error: 'not_found' }, 404),
  )
  .get('/debug/identity-directory', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const directory = new IdentityDirectory(context.env.INDEX);

    return context.json(await directory.inspect(), 200);
  })
  .get('/debug/groups', async (context) => {
    if (!debugEnabled(context.env)) {
      return context.json({ error: 'not_found' }, 404);
    }

    const groupIds = await new GroupIndex(context.env.INDEX).listAllGroupIds();

    const groups = await Promise.all(
      groupIds.map(async (groupId) => {
        const group = context.env.GROUPS.get(
          context.env.GROUPS.idFromName(groupId),
        );

        const inspection = await group.inspectGroup(groupId);

        return inspection
          ? {
              group_id: groupId,
              name: inspection.snapshot.group.name,
              revision: inspection.revision,
            }
          : null;
      }),
    );

    return context.json({ groups: groups.filter((group) => group !== null) }, 200);
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
  });

export function debugEnabled(env: Env): boolean {
  return String(env.ENABLE_DEBUG_INSPECTION) === 'true';
}
