import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { memberSchema, type Member } from '../src/memberDirectory';
import {
  AuthenticatedGroupDriver,
  failureBody,
  successBody,
} from './groupDriver';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

const memberFields = Object.keys(memberSchema.shape).sort();

beforeAll(async () => {
  await applyTestMigrations();
});

describe('members API', () => {
  it('creates a versioned member inside its group object', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const createdReply = await group.createMember({ display_name: 'Ada Lovelace' });
    const created = successBody(createdReply, 201).member;

    expect(Object.keys(created).sort()).toEqual(memberFields);
    expect(created).toMatchObject({
      version: 1,
      deleted_at: null,
      display_name: 'Ada Lovelace',
    });
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(created.updated_at).toBe(created.created_at);

    // Persistence is proven the way a caller would observe it. Which columns
    // the row has is the column-parity test's job, not this one's.
    const retrieved = await group.getMember(created.id);

    expect(successBody(retrieved, 200)).toEqual({ member: created });
  });

  it('lists and retrieves members', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const createdReply = await group.createMember({ display_name: 'Ada' });
    const created = successBody(createdReply, 201).member;
    const listedReply = await group.listMembers();
    const listed = successBody(listedReply, 200).members;
    const retrievedReply = await group.getMember(created.id);

    expect(listed).toHaveLength(2);
    expect(listed).toEqual(
      expect.arrayContaining([group.created.member, created]),
    );
    expect(successBody(retrievedReply, 200)).toEqual({ member: created });
  });

  it('renames a member and advances its version', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const originalReply = await group.createMember({ display_name: 'Ada' });
    const original = successBody(originalReply, 201).member;

    const updatedReply = await group.updateMember(original.id, {
      expected_version: original.version,
      display_name: 'Grace',
    });

    const updated = successBody(updatedReply, 200).member;

    expect(updated).toEqual({
      ...original,
      version: 2,
      updated_at: expect.any(String),
      display_name: 'Grace',
    });

    const retrieved = await group.getMember(original.id);

    expect(successBody(retrieved, 200)).toEqual({ member: updated });
  });

  it('does not advance the version for a no-op rename and rejects a stale one', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const originalReply = await group.createMember({ display_name: 'Ada' });
    const original = successBody(originalReply, 201).member;

    const unchanged = await group.updateMember(original.id, {
      expected_version: 1,
      display_name: original.display_name,
    });

    const changed = await group.updateMember(original.id, {
      expected_version: 1,
      display_name: 'Version two',
    });

    const stale = await group.updateMember(original.id, {
      expected_version: 1,
      display_name: 'Stale edit',
    });

    expect(successBody(unchanged, 200).member).toEqual(original);
    successBody(changed, 200);
    expect(failureBody(stale, 409)).toEqual({ error: 'version_conflict' });
  });

  it('soft-deletes a member and hides it from active reads', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const originalReply = await group.createMember({ display_name: 'Ada' });
    const original = successBody(originalReply, 201).member;

    const deletedReply = await group.deleteMember(original.id, {
      expected_version: original.version,
    });

    const deleted = successBody(deletedReply, 200).member;

    expect(deleted).toEqual({
      ...original,
      version: 2,
      updated_at: expect.any(String),
      deleted_at: expect.any(String),
    });

    const listedReply = await group.listMembers();
    const retrieved = await group.getMember(original.id);
    const objectId = env.GROUPS.idFromName(group.created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<Member>('SELECT * FROM members WHERE id = ?', original.id)
          .toArray()[0],
    );

    const repeatedDelete = await group.deleteMember(original.id, {
      expected_version: deleted.version,
    });

    const deletedUpdate = await group.updateMember(original.id, {
      expected_version: deleted.version,
      display_name: 'Too late',
    });

    expect(successBody(listedReply, 200)).toEqual({
      members: [group.created.member],
    });
    expect(failureBody(retrieved, 410)).toEqual({ error: 'member_deleted' });
    expect(stored).toEqual(deleted);
    expect(failureBody(repeatedDelete, 410)).toEqual({ error: 'member_deleted' });
    expect(failureBody(deletedUpdate, 410)).toEqual({ error: 'member_deleted' });
  });

  it('rejects stale deletion and mutations of an unknown member', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const originalReply = await group.createMember({ display_name: 'Ada' });
    const original = successBody(originalReply, 201).member;

    await group.updateMember(original.id, {
      expected_version: 1,
      display_name: 'Version two',
    });

    const stale = await group.deleteMember(original.id, {
      expected_version: 1,
    });

    const missingId = crypto.randomUUID();

    const missingUpdate = await group.updateMember(missingId, {
      expected_version: 1,
      display_name: 'Nobody',
    });

    const missingDelete = await group.deleteMember(missingId, {
      expected_version: 1,
    });

    expect(failureBody(stale, 409)).toEqual({ error: 'version_conflict' });
    expect(failureBody(missingUpdate, 404)).toEqual({ error: 'member_not_found' });
    expect(failureBody(missingDelete, 404)).toEqual({ error: 'member_not_found' });
  });

  it('lists the creator and returns 404 for an unknown member', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const listed = await group.listMembers();
    const missing = await group.getMember(crypto.randomUUID());

    expect(successBody(listed, 200)).toEqual({ members: [group.created.member] });
    expect(failureBody(missing, 404)).toEqual({ error: 'member_not_found' });
  });

  it('rejects invalid member input and missing credentials', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const url = `https://splitnext.test/groups/${group.created.group.id}/members`;

    const invalid = await exports.default.fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${group.created.access_token}`,
        'content-type': 'application/json',
        'x-device-user-id': group.input.device_user_id,
      },
      body: JSON.stringify({ display_name: '' }),
    });

    const unauthorized = await exports.default.fetch(url);

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_request' });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: 'unauthorized' });
  });

  it('enforces member command validation at the Durable Object seam', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const objectId = env.GROUPS.idFromName(group.created.group.id);
    const stub = env.GROUPS.get(objectId);

    await expect(
      stub.createMember(
        {
          accessToken: group.created.access_token,
          deviceUserId: group.input.device_user_id,
        },
        { display_name: '   ' },
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid_request' });

    const listed = await group.listMembers();

    expect(successBody(listed, 200)).toEqual({ members: [group.created.member] });
  });

  it('revokes a member capability when that member is deleted', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const deleted = await group.deleteMember(group.created.member.id, {
      expected_version: group.created.member.version,
    });

    const deletedMember = successBody(deleted, 200).member;

    const denied = await group.getGroup();
    const objectId = env.GROUPS.idFromName(group.created.group.id);

    const storedAccess = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<{ revoked_at: string | null }>(
            'SELECT revoked_at FROM member_access WHERE member_id = ?',
            group.created.member.id,
          )
          .toArray()[0],
    );

    expect(deletedMember.deleted_at).not.toBeNull();
    expect(storedAccess?.revoked_at).toBe(deletedMember.deleted_at);
    expect(failureBody(denied, 401)).toEqual({ error: 'unauthorized' });
  });

  it('refuses member operations after the group is deleted', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const deletion = await group.deleteGroup({
      expected_version: group.created.group.version,
    });

    const members = await group.listMembers();

    successBody(deletion, 200);
    expect(failureBody(members, 410)).toEqual({ error: 'group_deleted' });
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
