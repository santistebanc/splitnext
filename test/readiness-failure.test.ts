import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations } from './harness';

/**
 * Making a dependency unavailable means writing to D1, and a D1 write is not
 * undone between tests in a file — only between files. So this test breaks the
 * index on purpose and lives alone, rather than leaving the rest of a suite
 * quietly depending on running before it.
 */
beforeAll(async () => {
  await applyTestMigrations();
});

describe('readiness with a failing dependency', () => {
  it('reports 503 and names the dependency that is down', async () => {
    await env.INDEX.prepare('DROP TABLE app_metadata').run();

    const response = await exports.default.fetch('https://splitnext.test/ready');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      checks: { d1: false, durable_object: true },
    });
  });
});
