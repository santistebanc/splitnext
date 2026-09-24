import { OpenAPIHono } from '@hono/zod-openapi';
import { IdentityDirectory } from '../identityDirectory';

export const debugRoutes = new OpenAPIHono<{ Bindings: Env }>().get(
  '/debug/identity-directory',
  async (context) => {
    if (String(context.env.ENABLE_DEBUG_INSPECTION) !== 'true') {
      return context.json({ error: 'not_found' }, 404);
    }

    const directory = new IdentityDirectory(context.env.INDEX);

    return context.json(await directory.inspect(), 200);
  },
);
