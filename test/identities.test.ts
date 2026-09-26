import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { createIdentifier } from '../src/domain/ids';
import { identitySessionSchema } from '../src/domain/identities';
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

  it('exposes identity and device metadata to the local tester without credentials', async () => {
    const deviceSecret = 'c'.repeat(43);

    const created = await exports.default.fetch(
      'https://splitnext.test/identities/anonymous',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_secret: deviceSecret }),
      },
    );

    const session = identitySessionSchema.parse(await created.json());

    const response = await exports.default.fetch(
      'https://splitnext.test/debug/identity-directory',
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      identities: expect.arrayContaining([
        {
          id: session.identity.id,
          created_at: session.identity.created_at,
          mock_account: null,
          devices: [
            {
              id: session.device.id,
              created_at: session.device.created_at,
              revoked_at: null,
            },
          ],
        },
      ]),
    });
    expect(JSON.stringify(body)).not.toContain(deviceSecret);
    expect(JSON.stringify(body)).not.toContain('credential_hash');
  });

  it('does not expose inspection or reset when the development flag is disabled', async () => {
    const disabledEnv: Env = {
      ...env,
      ENABLE_DEBUG_INSPECTION: 'false',
    };

    const [identityResponse, mockSignInResponse, groupResponse, resetResponse] = await Promise.all([
      app.fetch(
        new Request('https://splitnext.test/debug/identity-directory'),
        disabledEnv,
      ),
      app.fetch(
        new Request(
          'https://splitnext.test/debug/auth/mock/sign-in',
          {
            method: 'POST',
            body: JSON.stringify({
              account_name: 'disabled@example.test',
              device_secret: 'd'.repeat(43),
            }),
          },
        ),
        disabledEnv,
      ),
      app.fetch(
        new Request(
          `https://splitnext.test/debug/groups/${createIdentifier()}`,
        ),
        disabledEnv,
      ),
      app.fetch(
        new Request('https://splitnext.test/debug/reset', {
          method: 'POST',
          body: JSON.stringify({ group_ids: [] }),
        }),
        disabledEnv,
      ),
    ]);

    expect(identityResponse.status).toBe(404);
    expect(await identityResponse.json()).toEqual({ error: 'not_found' });
    expect(mockSignInResponse.status).toBe(404);
    expect(await mockSignInResponse.json()).toEqual({ error: 'not_found' });
    expect(groupResponse.status).toBe(404);
    expect(await groupResponse.json()).toEqual({ error: 'not_found' });
    expect(resetResponse.status).toBe(404);
  });

  it('signs in multiple devices as one mock account with distinct credentials', async () => {
    const accountName = `multi-device-${createIdentifier()}@example.test`;

    const signIn = (deviceSecret: string) =>
      exports.default.fetch('https://splitnext.test/debug/auth/mock/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_name: accountName, device_secret: deviceSecret }),
      });

    const firstResponse = await signIn('m'.repeat(43));
    const secondResponse = await signIn('n'.repeat(43));
    const firstSession = identitySessionSchema.parse(await firstResponse.json());
    const secondSession = identitySessionSchema.parse(await secondResponse.json());

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondSession.identity.id).toBe(firstSession.identity.id);
    expect(secondSession.device.id).not.toBe(firstSession.device.id);

    const inspected = await exports.default.fetch(
      'https://splitnext.test/debug/identity-directory',
    );

    const directory = await inspected.json();

    expect(directory).toEqual({
      identities: expect.arrayContaining([
        expect.objectContaining({
          id: firstSession.identity.id,
          mock_account: accountName.toLocaleLowerCase('en-US'),
          devices: expect.arrayContaining([
            expect.objectContaining({ id: firstSession.device.id }),
            expect.objectContaining({ id: secondSession.device.id }),
          ]),
        }),
      ]),
    });
  });

  it('adopts an existing anonymous identity for a mock account', async () => {
    const deviceSecret = 'p'.repeat(43);
    const accountName = `adopt-${createIdentifier()}@example.test`;

    const anonymousResponse = await exports.default.fetch(
      'https://splitnext.test/identities/anonymous',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_secret: deviceSecret }),
      },
    );

    const anonymousSession = identitySessionSchema.parse(
      await anonymousResponse.json(),
    );

    const linkedResponse = await exports.default.fetch(
      'https://splitnext.test/debug/auth/mock/sign-in',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_name: accountName, device_secret: deviceSecret }),
      },
    );

    const linkedSession = identitySessionSchema.parse(await linkedResponse.json());

    expect(linkedResponse.status).toBe(200);
    expect(linkedSession).toEqual(anonymousSession);
  });

  it('merges an anonymous identity into an account already used on another device', async () => {
    const accountName = `collision-${createIdentifier()}@example.test`;

    const signIn = (deviceSecret: string) =>
      exports.default.fetch('https://splitnext.test/debug/auth/mock/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_name: accountName, device_secret: deviceSecret }),
      });

    const firstResponse = await signIn('q'.repeat(43));

    const secondAnonymousResponse = await exports.default.fetch(
      'https://splitnext.test/identities/anonymous',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_secret: 'r'.repeat(43) }),
      },
    );

    const firstSession = identitySessionSchema.parse(await firstResponse.json());

    const secondAnonymousSession = identitySessionSchema.parse(
      await secondAnonymousResponse.json(),
    );

    const merged = await signIn('r'.repeat(43));
    const mergedSession = identitySessionSchema.parse(await merged.json());

    expect(merged.status).toBe(200);
    expect(mergedSession.identity.id).toBe(firstSession.identity.id);
    expect(mergedSession.device.id).toBe(secondAnonymousSession.device.id);
    expect(firstSession.identity.id).not.toBe(secondAnonymousSession.identity.id);

    const authenticated = await exports.default.fetch('https://splitnext.test/identity', {
      headers: { authorization: `Bearer v1.${'r'.repeat(43)}` },
    });

    expect(await authenticated.json()).toEqual(mergedSession);
  });

  it('does not merge one established account into another account', async () => {
    const accountA = `account-a-${createIdentifier()}@example.test`;
    const accountB = `account-b-${createIdentifier()}@example.test`;
    const secretA = 's'.repeat(43);
    const secretB = 't'.repeat(43);

    await exports.default.fetch('https://splitnext.test/debug/auth/mock/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_name: accountA, device_secret: secretA }),
    });
    await exports.default.fetch('https://splitnext.test/debug/auth/mock/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_name: accountB, device_secret: secretB }),
    });

    const switched = await exports.default.fetch(
      'https://splitnext.test/debug/auth/mock/sign-in',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account_name: accountA, device_secret: secretB }),
      },
    );

    expect(switched.status).toBe(409);
    expect(await switched.json()).toEqual({ error: 'account_identity_conflict' });
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

  it('rejects a revoked device across protected route families', async () => {
    const deviceSecret = 'r'.repeat(43);

    const created = await exports.default.fetch(
      'https://splitnext.test/identities/anonymous',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_secret: deviceSecret }),
      },
    );

    const session = identitySessionSchema.parse(await created.json());

    await env.INDEX
      .prepare('UPDATE identity_devices SET revoked_at = ? WHERE id = ?')
      .bind('2026-09-24T12:00:00.000Z', session.device.id)
      .run();

    const authorization = `Bearer v1.${deviceSecret}`;

    const [identityResponse, groupResponse] = await Promise.all([
      exports.default.fetch('https://splitnext.test/identity', {
        headers: { authorization },
      }),
      exports.default.fetch('https://splitnext.test/groups', {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          group_id: createIdentifier(),
          name: 'Rejected group',
          currency_code: 'EUR',
          creator_member_name: 'Santi',
        }),
      }),
    ]);

    expect(identityResponse.status).toBe(401);
    expect(await identityResponse.json()).toEqual({ error: 'unauthorized' });
    expect(groupResponse.status).toBe(401);
    expect(await groupResponse.json()).toEqual({ error: 'unauthorized' });
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
