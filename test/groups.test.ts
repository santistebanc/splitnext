import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { accessTokenSchema, groupSchema, type Group } from '../src/groupObject';
import { createGroup, postGroup } from './groupFixture';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

/** Read from the one declaration of the group's shape, never restated. */
const groupFields = Object.keys(groupSchema.shape).sort();

/** A SHA-256 digest in hex. Same width as a capability, a different thing. */
const sha256Hex = /^[a-f0-9]{64}$/;

type GroupResponse = {
  group: Group;
};

type StoredAccessToken = {
  token_hash: string;
  device_user_id: string;
  revoked_at: string | null;
};

type SqliteObject = {
  name: string;
  sql: string;
};

beforeAll(async () => {
  await applyTestMigrations();
});

function retrieveGroup(groupId: string, accessToken: string, deviceUserId: string) {
  return exports.default.fetch(`https://splitnext.test/groups/${groupId}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-device-user-id': deviceUserId,
    },
  });
}

function patchGroup(
  groupId: string,
  accessToken: string,
  deviceUserId: string,
  body: {
    expected_version: number;
    name?: string;
    currency_label?: string;
  },
) {
  return exports.default.fetch(`https://splitnext.test/groups/${groupId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-device-user-id': deviceUserId,
    },
    body: JSON.stringify(body),
  });
}

function deleteGroup(
  groupId: string,
  accessToken: string,
  deviceUserId: string,
  expectedVersion: number,
) {
  const url = new URL(`https://splitnext.test/groups/${groupId}`);

  url.searchParams.set('expected_version', String(expectedVersion));

  return exports.default.fetch(url, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-device-user-id': deviceUserId,
    },
  });
}

describe('groups API', () => {
  it('creates a group and returns it with a capability', async () => {
    const { body, created, response } = await createGroup();

    expect(response.status).toBe(201);
    expect(accessTokenSchema.safeParse(created.access_token).success).toBe(true);
    expect(Object.keys(created.group).sort()).toEqual(groupFields);
    expect(created.group).toMatchObject({
      version: 1,
      deleted_at: null,
      name: body.name,
      currency_label: body.currency_label,
    });
    expect(created.group.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('stamps its own clock when it creates the group', async () => {
    const { created } = await createGroup();

    expect(Number.isNaN(Date.parse(created.group.created_at))).toBe(false);
    expect(created.group.updated_at).toBe(created.group.created_at);
  });

  it('returns the group to the holder of its capability', async () => {
    const { body, created } = await createGroup();

    const fetched = await retrieveGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
    );

    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual({ group: created.group });
  });

  it('updates editable fields and advances the version', async () => {
    const { body, created } = await createGroup();

    const response = await patchGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      { expected_version: 1, name: 'Lisbon flat' },
    );

    // SAFETY: This response is produced by the typed PATCH /groups/{groupId} route.
    const updated = (await response.json()) as GroupResponse;

    expect(response.status).toBe(200);
    expect(updated.group).toEqual({
      ...created.group,
      version: 2,
      updated_at: expect.any(String),
      name: 'Lisbon flat',
    });
    expect(updated.group.currency_label).toBe(created.group.currency_label);

    const fetched = await retrieveGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
    );

    expect(await fetched.json()).toEqual(updated);
  });

  it('rejects empty and stale group updates', async () => {
    const { body, created } = await createGroup();

    const empty = await patchGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      { expected_version: 1 },
    );

    const first = await patchGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      { expected_version: 1, currency_label: 'USD' },
    );

    const stale = await patchGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      { expected_version: 1, name: 'Stale edit' },
    );

    expect(empty.status).toBe(400);
    expect(first.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'version_conflict' });
  });

  it('soft-deletes a group and retains its tombstone', async () => {
    const { body, created } = await createGroup();

    const response = await deleteGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      created.group.version,
    );

    // SAFETY: This response is produced by the typed DELETE /groups/{groupId} route.
    const deleted = (await response.json()) as GroupResponse;

    expect(response.status).toBe(200);
    expect(deleted.group).toEqual({
      ...created.group,
      version: 2,
      updated_at: expect.any(String),
      deleted_at: expect.any(String),
    });

    const fetched = await retrieveGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
    );

    const objectId = env.GROUPS.idFromName(created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<Group>('SELECT * FROM group_state WHERE singleton = 1')
          .toArray()[0],
    );

    // The capability is still valid; the group is what is gone.
    expect(fetched.status).toBe(410);
    expect(await fetched.json()).toEqual({ error: 'group_deleted' });
    expect(stored).toEqual({ singleton: 1, ...deleted.group });
  });

  it('reports a deleted group as gone to every operation', async () => {
    const { body, created } = await createGroup();

    await deleteGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      created.group.version,
    );

    const update = await patchGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      { expected_version: 2, name: 'After the end' },
    );

    const deletion = await deleteGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      2,
    );

    expect(update.status).toBe(410);
    expect(deletion.status).toBe(410);
    expect(await update.json()).toEqual({ error: 'group_deleted' });
  });

  it('does not advance the version when an update changes nothing', async () => {
    const { body, created } = await createGroup();

    const response = await patchGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      { expected_version: 1, name: created.group.name },
    );

    // SAFETY: This response is produced by the typed PATCH /groups/{groupId} route.
    const unchanged = (await response.json()) as GroupResponse;

    expect(response.status).toBe(200);
    expect(unchanged.group).toEqual(created.group);

    // A second device's expected_version survives the no-op.
    const next = await patchGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      { expected_version: 1, currency_label: 'USD' },
    );

    expect(next.status).toBe(200);
  });

  it('rejects deletion with a stale version', async () => {
    const { body, created } = await createGroup();

    await patchGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      { expected_version: 1, name: 'Version two' },
    );

    const response = await deleteGroup(
      created.group.id,
      created.access_token,
      body.device_user_id,
      1,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'version_conflict' });
  });

  it('requires a capability for group mutations', async () => {
    const { created } = await createGroup();
    const url = `https://splitnext.test/groups/${created.group.id}`;

    const update = await exports.default.fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 1, name: 'Denied edit' }),
    });

    const deletion = await exports.default.fetch(
      `${url}?expected_version=1`,
      { method: 'DELETE' },
    );

    expect(update.status).toBe(401);
    expect(deletion.status).toBe(401);
    expect(await update.json()).toEqual({ error: 'unauthorized' });
    expect(await deletion.json()).toEqual({ error: 'unauthorized' });
  });

  it('stores the capability only as a hash, and only inside the group', async () => {
    const { body, created } = await createGroup();

    const d1AccessTable = await env.INDEX.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'access_tokens'",
    ).first<{ name: string }>();

    const objectId = env.GROUPS.idFromName(created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<StoredAccessToken>(
            'SELECT token_hash, device_user_id, revoked_at FROM access_tokens',
          )
          .toArray()[0],
    );

    expect(d1AccessTable).toBeNull();
    expect(stored).toEqual({
      token_hash: expect.stringMatching(sha256Hex),
      device_user_id: body.device_user_id,
      revoked_at: null,
    });
    expect(stored?.token_hash).not.toBe(created.access_token);
  });

  it('rejects invalid group input', async () => {
    const response = await postGroup({
      name: '',
      currency_label: 'EUR',
      device_user_id: crypto.randomUUID(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('rejects missing, malformed, incorrect, and wrong-device credentials', async () => {
    const { body, created } = await createGroup();
    const url = `https://splitnext.test/groups/${created.group.id}`;

    const missing = await exports.default.fetch(url);

    const malformed = await retrieveGroup(
      created.group.id,
      'not-a-capability',
      body.device_user_id,
    );

    const wrongToken = await retrieveGroup(
      created.group.id,
      '0'.repeat(64),
      body.device_user_id,
    );

    const wrongDevice = await retrieveGroup(
      created.group.id,
      created.access_token,
      crypto.randomUUID(),
    );

    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(wrongToken.status).toBe(401);
    expect(wrongDevice.status).toBe(401);
    expect(await missing.json()).toEqual({ error: 'unauthorized' });
  });

  it('provisions no storage when an unknown group id is looked up', async () => {
    const unknownId = crypto.randomUUID();

    const response = await retrieveGroup(unknownId, 'a'.repeat(64), crypto.randomUUID());

    const objectId = env.GROUPS.idFromName(unknownId);

    const tables = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<SqliteObject>(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
          )
          .toArray()
          .map(({ name }) => name),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(tables).toEqual([]);
  });

  it('refuses to create a second group in the same object', async () => {
    const objectId = env.GROUPS.idFromName(crypto.randomUUID());

    const input = {
      name: 'Berlin flat',
      currency_label: 'EUR',
      device_user_id: crypto.randomUUID(),
    };

    const stub = env.GROUPS.get(objectId);
    const first = await stub.createGroup(input);
    const second = await stub.createGroup(input);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'group_exists' });
  });

  it('publishes the group lifecycle in OpenAPI', async () => {
    const document = await fetchOpenApiDocument();

    expect(document.paths['/groups']).toHaveProperty('post');
    expect(document.paths['/groups/{groupId}']).toHaveProperty('get');
    expect(document.paths['/groups/{groupId}']).toHaveProperty('patch');
    expect(document.paths['/groups/{groupId}']).toHaveProperty('delete');
  });

  it('publishes every field of the group it actually returns', async () => {
    const document = await fetchOpenApiDocument();

    const published =
      document.paths['/groups/{groupId}'].get.responses[200].content[
        'application/json'
      ].schema.properties.group.properties;

    const { created } = await createGroup();

    expect(Object.keys(published).sort()).toEqual(groupFields);
    expect(Object.keys(created.group).sort()).toEqual(groupFields);
  });

  it('declares exactly the statuses each group route can return', async () => {
    const document = await fetchOpenApiDocument();
    const byId = document.paths['/groups/{groupId}'];

    expect(Object.keys(document.paths['/groups'].post.responses)).toEqual([
      '201',
      '400',
      '409',
      '500',
    ]);
    expect(Object.keys(byId.get.responses)).toEqual([
      '200',
      '400',
      '401',
      '410',
      '500',
    ]);
    expect(Object.keys(byId.patch.responses)).toEqual([
      '200',
      '400',
      '401',
      '409',
      '410',
      '500',
    ]);
    expect(Object.keys(byId.delete.responses)).toEqual([
      '200',
      '400',
      '401',
      '409',
      '410',
      '500',
    ]);
  });

  it('publishes the capability header as a validated parameter', async () => {
    const document = await fetchOpenApiDocument();

    const names = document.paths['/groups/{groupId}'].get.parameters.map(
      ({ name }) => name,
    );

    expect(names).toContain('authorization');
    expect(names).toContain('x-device-user-id');
  });
});
