import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { groupSchema, type Group } from '../src/groupState';
import { accessTokenSchema, memberSchema } from '../src/memberDirectory';
import {
  AuthenticatedGroupDriver,
  failureBody,
  postGroup,
  successBody,
} from './groupDriver';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

/** Read from the one declaration of the group's shape, never restated. */
const groupFields = Object.keys(groupSchema.shape).sort();

/** A SHA-256 digest in hex. Same width as a capability, a different thing. */
const sha256Hex = /^[a-f0-9]{64}$/;

type StoredMemberAccess = {
  token_hash: string;
  member_id: string;
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

describe('groups API', () => {
  it('creates a group, its creator member, and their capability', async () => {
    const {
      input: body,
      created,
    } = await AuthenticatedGroupDriver.create();

    expect(accessTokenSchema.safeParse(created.access_token).success).toBe(true);
    expect(Object.keys(created.group).sort()).toEqual(groupFields);
    expect(created.group).toMatchObject({
      version: 1,
      deleted_at: null,
      name: body.name,
      currency_label: body.currency_label,
    });
    expect(Object.keys(created.member).sort()).toEqual(
      Object.keys(memberSchema.shape).sort(),
    );
    expect(created.member).toMatchObject({
      version: 1,
      deleted_at: null,
      display_name: body.creator_display_name,
    });
    expect(created.member.updated_at).toBe(created.member.created_at);
    expect(created.group.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('stamps its own clock when it creates the group', async () => {
    const { created } = await AuthenticatedGroupDriver.create();

    expect(Number.isNaN(Date.parse(created.group.created_at))).toBe(false);
    expect(created.group.updated_at).toBe(created.group.created_at);
  });

  it('returns the group to the holder of its capability', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const fetched = await group.getGroup();

    expect(successBody(fetched, 200)).toEqual({ group: group.created.group });
  });

  it('updates editable fields and advances the version', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const { created } = group;

    const updated = await group.updateGroup({
      expected_version: 1,
      name: 'Lisbon flat',
    });

    const updatedBody = successBody(updated, 200);

    expect(updatedBody.group).toEqual({
      ...created.group,
      version: 2,
      updated_at: expect.any(String),
      name: 'Lisbon flat',
    });
    expect(updatedBody.group.currency_label).toBe(created.group.currency_label);

    const fetched = await group.getGroup();

    expect(successBody(fetched, 200)).toEqual(updatedBody);
  });

  it('rejects empty and stale group updates', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const empty = await group.updateGroup({ expected_version: 1 });

    const first = await group.updateGroup({
      expected_version: 1,
      currency_label: 'USD',
    });

    const stale = await group.updateGroup({
      expected_version: 1,
      name: 'Stale edit',
    });

    expect(failureBody(empty, 400)).toEqual({ error: 'invalid_request' });
    successBody(first, 200);
    expect(failureBody(stale, 409)).toEqual({ error: 'version_conflict' });
  });

  it('soft-deletes a group and retains its tombstone', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const { created } = group;

    const deleted = await group.deleteGroup({
      expected_version: created.group.version,
    });

    const deletedBody = successBody(deleted, 200);

    expect(deletedBody.group).toEqual({
      ...created.group,
      version: 2,
      updated_at: expect.any(String),
      deleted_at: expect.any(String),
    });

    const fetched = await group.getGroup();

    const objectId = env.GROUPS.idFromName(created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<Group>('SELECT * FROM group_state WHERE singleton = 1')
          .toArray()[0],
    );

    // The capability is still valid; the group is what is gone.
    expect(failureBody(fetched, 410)).toEqual({ error: 'group_deleted' });
    expect(stored).toEqual({ singleton: 1, ...deletedBody.group });
  });

  it('reports a deleted group as gone to every operation', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const { created } = group;

    await group.deleteGroup({ expected_version: created.group.version });

    const update = await group.updateGroup({
      expected_version: 2,
      name: 'After the end',
    });

    const deletion = await group.deleteGroup({ expected_version: 2 });

    expect(failureBody(update, 410)).toEqual({ error: 'group_deleted' });
    expect(failureBody(deletion, 410)).toEqual({ error: 'group_deleted' });
  });

  it('does not advance the version when an update changes nothing', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const { created } = group;

    const unchanged = await group.updateGroup({
      expected_version: 1,
      name: created.group.name,
    });

    expect(successBody(unchanged, 200).group).toEqual(created.group);

    // A second device's expected_version survives the no-op.
    const next = await group.updateGroup({
      expected_version: 1,
      currency_label: 'USD',
    });

    successBody(next, 200);
  });

  it('rejects deletion with a stale version', async () => {
    const group = await AuthenticatedGroupDriver.create();

    await group.updateGroup({ expected_version: 1, name: 'Version two' });

    const response = await group.deleteGroup({ expected_version: 1 });

    expect(failureBody(response, 409)).toEqual({ error: 'version_conflict' });
  });

  it('requires a capability for group mutations', async () => {
    const { created } = await AuthenticatedGroupDriver.create();
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

  it('stores the capability as a hash linked to its member inside the group', async () => {
    const { input: body, created } = await AuthenticatedGroupDriver.create();

    const d1AccessTable = await env.INDEX.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'member_access'",
    ).first<{ name: string }>();

    const objectId = env.GROUPS.idFromName(created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<StoredMemberAccess>(
            'SELECT token_hash, member_id, device_user_id, revoked_at FROM member_access',
          )
          .toArray()[0],
    );

    expect(d1AccessTable).toBeNull();
    expect(stored).toEqual({
      token_hash: expect.stringMatching(sha256Hex),
      member_id: created.member.id,
      device_user_id: body.device_user_id,
      revoked_at: null,
    });
    expect(stored?.token_hash).not.toBe(created.access_token);
  });

  it('rejects invalid group input and requires a creator name', async () => {
    const invalidName = await postGroup({
      name: '',
      currency_label: 'EUR',
      device_user_id: crypto.randomUUID(),
      creator_display_name: 'Santi',
    });

    const missingCreator = await exports.default.fetch(
      'https://splitnext.test/groups',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Berlin flat',
          currency_label: 'EUR',
          device_user_id: crypto.randomUUID(),
        }),
      },
    );

    expect(invalidName.status).toBe(400);
    expect(await invalidName.json()).toEqual({ error: 'invalid_request' });
    expect(missingCreator.status).toBe(400);
    expect(await missingCreator.json()).toEqual({ error: 'invalid_request' });
  });

  it('rejects missing, malformed, incorrect, and wrong-device credentials', async () => {
    const { input: body, created } = await AuthenticatedGroupDriver.create();
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
      creator_display_name: 'Santi',
    };

    const stub = env.GROUPS.get(objectId);
    const first = await stub.createGroup(input);
    const second = await stub.createGroup(input);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'group_exists' });
  });

  it('enforces group command validation at the Durable Object seam', async () => {
    const invalidId = env.GROUPS.idFromName(crypto.randomUUID());
    const invalidStub = env.GROUPS.get(invalidId);

    await expect(
      invalidStub.createGroup({
        name: '   ',
        currency_label: 'EUR',
        device_user_id: crypto.randomUUID(),
        creator_display_name: 'Santi',
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_request' });

    const group = await AuthenticatedGroupDriver.create();
    const objectId = env.GROUPS.idFromName(group.created.group.id);
    const stub = env.GROUPS.get(objectId);

    await expect(
      stub.updateGroup(
        {
          accessToken: group.created.access_token,
          deviceUserId: group.input.device_user_id,
        },
        { expected_version: group.created.group.version },
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid_request' });
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

    const { created } = await AuthenticatedGroupDriver.create();

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
