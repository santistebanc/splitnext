import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

type DependencyStatus = {
  d1: boolean;
  durable_object: boolean;
};

const errorResponseSchema = z.object({
  error: z.string(),
});

const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('splitnext-api'),
  revision: z.string(),
});

const readyResponseSchema = z.object({
  ok: z.boolean(),
  checks: z.object({
    d1: z.boolean(),
    durable_object: z.boolean(),
  }),
});

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Check Worker liveness',
  responses: {
    200: {
      description: 'The Worker is accepting requests.',
      content: {
        'application/json': { schema: healthResponseSchema },
      },
    },
  },
});

const readyRoute = createRoute({
  method: 'get',
  path: '/ready',
  tags: ['System'],
  summary: 'Check storage dependencies',
  responses: {
    200: {
      description: 'D1 and Durable Object storage are ready.',
      content: {
        'application/json': { schema: readyResponseSchema },
      },
    },
    503: {
      description: 'At least one storage dependency is unavailable.',
      content: {
        'application/json': { schema: readyResponseSchema },
      },
    },
    500: {
      description: 'An unexpected error occurred.',
      content: {
        'application/json': { schema: errorResponseSchema },
      },
    },
  },
});

export const systemRoutes = new OpenAPIHono<{ Bindings: Env }>()
  .openapi(healthRoute, (context) =>
    context.json(
      {
        ok: true,
        service: 'splitnext-api',
        revision: context.env.DEPLOY_SHA ?? 'unknown',
      },
      200,
    ),
  )
  .openapi(readyRoute, async (context) => {
    const checks = await checkDependencies(context.env);
    const body = { ok: checks.d1 && checks.durable_object, checks };

    return body.ok ? context.json(body, 200) : context.json(body, 503);
  });

async function checkDependencies(env: Env): Promise<DependencyStatus> {
  return {
    d1: await probeIndex(env),
    durable_object: await probeGroupStorage(env),
  };
}

async function probeIndex(env: Env): Promise<boolean> {
  try {
    // Which version is current is the migration's business; readiness only
    // asks whether the foundation migration has been applied at all.
    const row = await env.INDEX.prepare(
      "SELECT value FROM app_metadata WHERE key = 'schema_version'",
    ).first<{ value: string }>();

    return row !== null;
  } catch {
    return false;
  }
}

async function probeGroupStorage(env: Env): Promise<boolean> {
  try {
    const id = env.GROUPS.idFromName('__readiness__');
    const result = await env.GROUPS.get(id).health();

    return result.ok && result.ready;
  } catch {
    return false;
  }
}
