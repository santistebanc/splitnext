import { OpenAPIHono } from '@hono/zod-openapi';
import { identifierSchema } from '../domain/ids';
import { IdentityDirectory } from '../identityDirectory';

export const debugRoutes = new OpenAPIHono<{ Bindings: Env }>()
  .get('/debug/identity-directory', async (context) => {
    if (String(context.env.ENABLE_DEBUG_INSPECTION) !== 'true') {
      return context.json({ error: 'not_found' }, 404);
    }

    const directory = new IdentityDirectory(context.env.INDEX);

    return context.json(await directory.inspect(), 200);
  })
  .get('/debug/groups/:groupId', async (context) => {
    if (String(context.env.ENABLE_DEBUG_INSPECTION) !== 'true') {
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
