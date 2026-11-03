import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { clientErrorReportSchema } from '../clientErrorReport';
import { requestIdOf } from '../requestLog';
import { errorResponse } from './responses';

const clientErrorRoute = createRoute({
  method: 'post',
  path: '/client-errors',
  tags: ['System'],
  summary: 'Report an error in the browser app',
  request: {
    body: { required: true, content: { 'application/json': { schema: clientErrorReportSchema } } },
  },
  responses: {
    204: { description: 'The report was logged.' },
    400: errorResponse('The report is not a valid error report.'),
  },
});

export const clientErrorRoutes = new OpenAPIHono<{ Bindings: Env }>({
  defaultHook: (result, context) => {
    if (!result.success) return context.json({ error: 'invalid_request' }, 400);
  },
}).openapi(clientErrorRoute, (context) => {
  // Tests switch logs off; every deployed Worker writes them.
  if (String(context.env.LOG_REQUESTS) !== 'false') {
    console.log(JSON.stringify({
      event: 'client_error',
      request_id: requestIdOf(context.req.raw),
      revision: context.env.DEPLOY_SHA ?? 'unknown',
      ...context.req.valid('json'),
    }));
  }

  return context.body(null, 204);
});
