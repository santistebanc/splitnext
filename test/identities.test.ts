import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('anonymous identities API', () => {
  it('creates one identity and device idempotently for a device secret', async () => {
    const body = { device_secret: 'a'.repeat(43) };

    const create = () =>
      exports.default.fetch('https://splitnext.test/identities/anonymous', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const first = await create();
    const repeated = await create();

    expect(first.status).toBe(201);
    expect(repeated.status).toBe(201);
    const firstSession = await first.json();
    const repeatedSession = await repeated.json();

    expect(repeatedSession).toEqual(firstSession);
    expect(JSON.stringify(firstSession)).not.toContain(body.device_secret);
  });

  it('authenticates the device that owns the credential', async () => {
    const deviceSecret = 'b'.repeat(43);

    const created = await exports.default.fetch(
      'https://splitnext.test/identities/anonymous',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_secret: deviceSecret }),
      },
    );

    const current = await exports.default.fetch(
      'https://splitnext.test/identity',
      {
        headers: { authorization: `Bearer v1.${deviceSecret}` },
      },
    );

    expect(current.status).toBe(200);
    expect(await current.json()).toEqual(await created.json());
  });

  it('rejects malformed identity creation input', async () => {
    const response = await exports.default.fetch(
      'https://splitnext.test/identities/anonymous',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_secret: 'too-short' }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'Bearer not-a-versioned-credential'],
    ['unknown', `Bearer v1.${'z'.repeat(43)}`],
  ])('rejects a %s device credential', async (_case, authorization) => {
    const request = authorization ? { headers: { authorization } } : {};

    const response = await exports.default.fetch(
      'https://splitnext.test/identity',
      request,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('publishes both identity operations in OpenAPI', async () => {
    const document = await fetchOpenApiDocument();

    expect(document.paths['/identities/anonymous'].post.responses).toHaveProperty(
      '201',
    );
    expect(document.paths['/identity'].get.responses).toHaveProperty('200');
    expect(document.paths['/identity'].get.parameters).toContainEqual(
      expect.objectContaining({ name: 'authorization', in: 'header' }),
    );
  });
});
