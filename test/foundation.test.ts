import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('Cloudflare foundation', () => {
  it('reports liveness without touching dependencies', async () => {
    const response = await exports.default.fetch(
      'https://splitnext.test/health',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: 'splitnext-api',
      revision: 'local',
    });
  });

  it('checks both D1 and SQLite Durable Object storage', async () => {
    const response = await exports.default.fetch(
      'https://splitnext.test/ready',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      checks: { d1: true, durable_object: true },
    });
  });

  it('returns JSON for unknown routes', async () => {
    const response = await exports.default.fetch(
      'https://splitnext.test/not-a-route',
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('answers CORS preflight requests for the API console', async () => {
    const response = await exports.default.fetch(
      'https://splitnext.test/health',
      {
        method: 'OPTIONS',
      },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain(
      'Authorization',
    );
  });

  it('publishes the system endpoints in an OpenAPI document', async () => {
    const document = await fetchOpenApiDocument();

    expect(document.info.title).toBe('Splitnext API');
    expect(document.paths).toHaveProperty('/health');
    expect(document.paths).toHaveProperty('/ready');
  });

  it('serves an interactive API reference generated from OpenAPI', async () => {
    const response = await exports.default.fetch('https://splitnext.test/docs');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Splitnext API Reference');
    expect(html).toContain('/openapi.json');
  });

  it('renders the public beta homepage on the Worker', async () => {
    const response = await env.APP_RENDERING.fetch('https://splitnext.test/', {
      redirect: 'manual',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<h1');
  });

  it('renders the privacy policy and beta terms on the Worker', async () => {
    for (const [path, title] of [['/privacy', 'Privacy policy'], ['/terms', 'Beta terms']]) {
      const response = await env.APP_RENDERING.fetch(`https://splitnext.test${path}`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain(title);
    }
  });

  it('renders the app and arbitrary invite entry pages without sending a token to the server', async () => {
    for (const path of ['/app', '/join/test-group']) {
      const response = await env.APP_RENDERING.fetch(
        `https://splitnext.test${path}`,
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Opening your groups');
    }
  });
});
