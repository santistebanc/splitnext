import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { groupRoutes } from './routes/groups';
import { identityRoutes } from './routes/identities';
import { systemRoutes } from './routes/system';

const app = new OpenAPIHono<{ Bindings: Env }>();

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
});

app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

const routedApp = app
  .route('/', systemRoutes)
  .route('/', identityRoutes)
  .route('/', groupRoutes);

routedApp.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'Splitnext API',
    version: '0.1.0',
    description: 'Offline-first shared-expense API.',
  },
});

routedApp.get('/', (context) => context.redirect('/dashboard/'));

routedApp.get(
  '/docs',
  Scalar({
    url: '/openapi.json',
    pageTitle: 'Splitnext API Reference',
  }),
);

routedApp.notFound((context) => context.json({ error: 'not_found' }, 404));

routedApp.onError((error, context) => {
  // The group names its invariant failures precisely. Keep those names, and the
  // request that provoked them, in the log; the client still learns nothing.
  console.error('unhandled_error', context.req.method, context.req.path, error);

  return context.json({ error: 'internal_error' }, 500);
});

export default routedApp;
