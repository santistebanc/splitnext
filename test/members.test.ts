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

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ members: [createdMember.member] });
    expect(retrieved.status).toBe(200);
    expect(await retrieved.json()).toEqual(createdMember);
  });

  it('returns an empty list and 404 for an unknown member', async () => {
    const { body: groupInput, created } = await createGroup();
    const headers = capabilityHeaders(created, groupInput.device_user_id);
    const collectionUrl = `https://splitnext.test/groups/${created.group.id}/members`;

    const listed = await exports.default.fetch(collectionUrl, { headers });

    const missing = await exports.default.fetch(
      `${collectionUrl}/${crypto.randomUUID()}`,
      { headers },
    );

    expect(await listed.json()).toEqual({ members: [] });
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

  it('publishes member creation, listing, and retrieval in OpenAPI', async () => {
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
  });
});
