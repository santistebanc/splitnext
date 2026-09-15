import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { GroupObject } from './groupObject';
import { groupRoutes } from './routes/groups';
import { memberRoutes } from './routes/members';
import { systemRoutes } from './routes/system';

export { GroupObject };

const app = new OpenAPIHono<{ Bindings: Env }>();

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
});

app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type', 'X-Device-User-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

app.route('/', systemRoutes);

app.route('/', groupRoutes);

app.route('/', memberRoutes);

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'Splitnext API',
    version: '0.1.0',
    description: 'API for groups, shared expenses, balances, and settlements.',
  },
});

app.get('/', (context) => context.redirect('/docs'));

app.get(
  '/docs',
  Scalar({
    url: '/openapi.json',
    pageTitle: 'Splitnext API Reference',
  }),
);

app.notFound((context) => context.json({ error: 'not_found' }, 404));

app.onError((error, context) => {
  // The group names its invariant failures precisely. Keep those names, and the
  // request that provoked them, in the log; the client still learns nothing.
  console.error('unhandled_error', context.req.method, context.req.path, error);

  return context.json({ error: 'internal_error' }, 500);
});

export default app;
