import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { memberSchema, type Member } from '../src/member';
import { createGroup, type CreateGroupResponse } from './groupFixture';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

const memberFields = Object.keys(memberSchema.shape).sort();

type MemberResponse = {
  member: Member;
};

beforeAll(async () => {
  await applyTestMigrations();
});

function capabilityHeaders(created: CreateGroupResponse, deviceUserId: string) {
  return {
    authorization: `Bearer ${created.access_token}`,
    'x-device-user-id': deviceUserId,
  };
}

function postMember(
  created: CreateGroupResponse,
  deviceUserId: string,
  displayName: string,
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${created.group.id}/members`,
    {
      method: 'POST',
      headers: {
        ...capabilityHeaders(created, deviceUserId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ display_name: displayName }),
    },
  );
}

async function createMember(
  created: CreateGroupResponse,
  deviceUserId: string,
  displayName = 'Ada',
) {
  const response = await postMember(created, deviceUserId, displayName);

  // SAFETY: This response is produced by the typed member creation route.
  const body = (await response.json()) as MemberResponse;

  return { body, response };
}

function patchMember(
  created: CreateGroupResponse,
  deviceUserId: string,
  memberId: string,
  expectedVersion: number,
  displayName: string,
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${created.group.id}/members/${memberId}`,
    {
      method: 'PATCH',
      headers: {
        ...capabilityHeaders(created, deviceUserId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        expected_version: expectedVersion,
        display_name: displayName,
      }),
    },
  );
}

function deleteMember(
  created: CreateGroupResponse,
  deviceUserId: string,
  memberId: string,
  expectedVersion: number,
) {
  const url = new URL(
    `https://splitnext.test/groups/${created.group.id}/members/${memberId}`,
  );

  url.searchParams.set('expected_version', String(expectedVersion));

  return exports.default.fetch(url, {
    method: 'DELETE',
    headers: capabilityHeaders(created, deviceUserId),
  });
}

describe('members API', () => {
  it('creates a versioned member inside its group object', async () => {
    const { body: groupInput, created } = await createGroup();

    const { body, response } = await createMember(
      created,
      groupInput.device_user_id,
      'Ada Lovelace',
    );

    expect(response.status).toBe(201);
    expect(Object.keys(body.member).sort()).toEqual(memberFields);
    expect(body.member).toMatchObject({
      version: 1,
      deleted_at: null,
      display_name: 'Ada Lovelace',
    });
    expect(body.member.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body.member.updated_at).toBe(body.member.created_at);

    const objectId = env.GROUPS.idFromName(created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<Member>(
            `SELECT id, version, created_at, updated_at, deleted_at, display_name
             FROM members WHERE id = ?`,
            body.member.id,
          )
          .toArray()[0],
    );

    expect(stored).toEqual(body.member);
    expect(stored).not.toHaveProperty('group_id');
  });

  it('lists and retrieves members', async () => {
    const { body: groupInput, created } = await createGroup();

    const { body: createdMember } = await createMember(
      created,
      groupInput.device_user_id,
    );

    const headers = capabilityHeaders(created, groupInput.device_user_id);
    const collectionUrl = `https://splitnext.test/groups/${created.group.id}/members`;

    const listed = await exports.default.fetch(collectionUrl, { headers });

    const retrieved = await exports.default.fetch(
      `${collectionUrl}/${createdMember.member.id}`,
      { headers },
    );

    // SAFETY: This response is produced by the typed member collection route.
    const listedBody = (await listed.json()) as { members: Member[] };

    expect(listed.status).toBe(200);
    expect(listedBody.members).toHaveLength(2);
    expect(listedBody.members).toEqual(
      expect.arrayContaining([created.member, createdMember.member]),
    );
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toEqual(createdMember);
  });

  it('renames a member and advances its version', async () => {
    const { body: groupInput, created } = await createGroup();

    const { body: original } = await createMember(
      created,
      groupInput.device_user_id,
    );

    const response = await patchMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      original.member.version,
      'Grace',
    );

    // SAFETY: This response is produced by the typed member update route.
    const updated = (await response.json()) as MemberResponse;

    expect(response.status).toBe(200);
    expect(updated.member).toEqual({
      ...original.member,
      version: 2,
      updated_at: expect.any(String),
      display_name: 'Grace',
    });

    const headers = capabilityHeaders(created, groupInput.device_user_id);

    const retrieved = await exports.default.fetch(
      `https://splitnext.test/groups/${created.group.id}/members/${original.member.id}`,
      { headers },
    );

    expect(await retrieved.json()).toEqual(updated);
  });

  it('does not advance the version for a no-op rename and rejects a stale one', async () => {
    const { body: groupInput, created } = await createGroup();

    const { body: original } = await createMember(
      created,
      groupInput.device_user_id,
    );

    const unchangedResponse = await patchMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      1,
      original.member.display_name,
    );

    // SAFETY: This response is produced by the typed member update route.
    const unchanged = (await unchangedResponse.json()) as MemberResponse;

    const changed = await patchMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      1,
      'Version two',
    );

    const stale = await patchMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      1,
      'Stale edit',
    );

    expect(unchanged.member).toEqual(original.member);
    expect(changed.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'version_conflict' });
  });

  it('soft-deletes a member and hides it from active reads', async () => {
    const { body: groupInput, created } = await createGroup();

    const { body: original } = await createMember(
      created,
      groupInput.device_user_id,
    );

    const response = await deleteMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      original.member.version,
    );

    // SAFETY: This response is produced by the typed member deletion route.
    const deleted = (await response.json()) as MemberResponse;

    expect(response.status).toBe(200);
    expect(deleted.member).toEqual({
      ...original.member,
      version: 2,
      updated_at: expect.any(String),
      deleted_at: expect.any(String),
    });

    const headers = capabilityHeaders(created, groupInput.device_user_id);
    const collectionUrl = `https://splitnext.test/groups/${created.group.id}/members`;
    const listed = await exports.default.fetch(collectionUrl, { headers });

    const retrieved = await exports.default.fetch(
      `${collectionUrl}/${original.member.id}`,
      { headers },
    );

    const objectId = env.GROUPS.idFromName(created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<Member>('SELECT * FROM members WHERE id = ?', original.member.id)
          .toArray()[0],
    );

    const repeatedDelete = await deleteMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      deleted.member.version,
    );

    const deletedUpdate = await patchMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      deleted.member.version,
      'Too late',
    );

    expect(await listed.json()).toEqual({ members: [created.member] });
    expect(retrieved.status).toBe(410);
    expect(await retrieved.json()).toEqual({ error: 'member_deleted' });
    expect(stored).toEqual(deleted.member);
    expect(repeatedDelete.status).toBe(410);
    expect(deletedUpdate.status).toBe(410);
  });

  it('rejects stale deletion and mutations of an unknown member', async () => {
    const { body: groupInput, created } = await createGroup();

    const { body: original } = await createMember(
      created,
      groupInput.device_user_id,
    );

    await patchMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      1,
      'Version two',
    );

    const stale = await deleteMember(
      created,
      groupInput.device_user_id,
      original.member.id,
      1,
    );

    const missingId = crypto.randomUUID();

    const missingUpdate = await patchMember(
      created,
      groupInput.device_user_id,
      missingId,
      1,
      'Nobody',
    );

    const missingDelete = await deleteMember(
      created,
      groupInput.device_user_id,
      missingId,
      1,
    );

    expect(stale.status).toBe(409);
    expect(missingUpdate.status).toBe(404);
    expect(missingDelete.status).toBe(404);
  });

  it('lists the creator and returns 404 for an unknown member', async () => {
    const { body: groupInput, created } = await createGroup();
    const headers = capabilityHeaders(created, groupInput.device_user_id);
    const collectionUrl = `https://splitnext.test/groups/${created.group.id}/members`;

    const listed = await exports.default.fetch(collectionUrl, { headers });

    const missing = await exports.default.fetch(
      `${collectionUrl}/${crypto.randomUUID()}`,
      { headers },
    );

    expect(await listed.json()).toEqual({ members: [created.member] });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'member_not_found' });
  });

  it('rejects invalid member input and missing credentials', async () => {
    const { body: groupInput, created } = await createGroup();
    const invalid = await postMember(created, groupInput.device_user_id, '');

    const unauthorized = await exports.default.fetch(
      `https://splitnext.test/groups/${created.group.id}/members`,
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_request' });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: 'unauthorized' });
  });

  it('revokes a member capability when that member is deleted', async () => {
    const { body: groupInput, created } = await createGroup();

    const response = await deleteMember(
      created,
      groupInput.device_user_id,
      created.member.id,
      created.member.version,
    );

    // SAFETY: This response is produced by the typed member deletion route.
    const deleted = (await response.json()) as MemberResponse;

    const denied = await exports.default.fetch(
      `https://splitnext.test/groups/${created.group.id}`,
      { headers: capabilityHeaders(created, groupInput.device_user_id) },
    );

    const objectId = env.GROUPS.idFromName(created.group.id);

    const storedAccess = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<{ revoked_at: string | null }>(
            'SELECT revoked_at FROM member_access WHERE member_id = ?',
            created.member.id,
          )
          .toArray()[0],
    );

    expect(response.status).toBe(200);
    expect(deleted.member.deleted_at).not.toBeNull();
    expect(storedAccess?.revoked_at).toBe(deleted.member.deleted_at);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: 'unauthorized' });
  });

  it('refuses member operations after the group is deleted', async () => {
    const { body: groupInput, created } = await createGroup();
    const headers = capabilityHeaders(created, groupInput.device_user_id);
    const groupUrl = `https://splitnext.test/groups/${created.group.id}`;

    const deletion = await exports.default.fetch(
      `${groupUrl}?expected_version=${created.group.version}`,
      { method: 'DELETE', headers },
    );

    const members = await exports.default.fetch(`${groupUrl}/members`, { headers });

    expect(deletion.status).toBe(200);
    expect(members.status).toBe(410);
    expect(await members.json()).toEqual({ error: 'group_deleted' });
  });

  it('publishes the complete member lifecycle in OpenAPI', async () => {
    const document = await fetchOpenApiDocument();
    const collection = document.paths['/groups/{groupId}/members'];
    const item = document.paths['/groups/{groupId}/members/{memberId}'];

    expect(Object.keys(collection.post.responses)).toEqual([
      '201',
      '400',
      '401',
      '410',
      '500',
    ]);
    expect(Object.keys(collection.get.responses)).toEqual([
      '200',
      '400',
      '401',
      '410',
      '500',
    ]);
    expect(Object.keys(item.get.responses)).toEqual([
      '200',
      '400',
      '401',
      '404',
      '410',
      '500',
    ]);
    expect(Object.keys(item.patch.responses)).toEqual([
      '200',
      '400',
      '401',
      '404',
      '409',
      '410',
      '500',
    ]);
    expect(Object.keys(item.delete.responses)).toEqual([
      '200',
      '400',
      '401',
      '404',
      '409',
      '410',
      '500',
    ]);
  });
});
