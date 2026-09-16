import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { groupInviteSchema } from '../src/inviteDirectory';
import {
  AuthenticatedGroupDriver,
  failureBody,
  successBody,
} from './groupDriver';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const sha256Hex = /^[a-f0-9]{64}$/;

type StoredInvite = {
  id: string;
  kind: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

beforeAll(async () => {
  await applyTestMigrations();
});

describe('group invite API', () => {
  it('creates a seven-day group link and stores only its token hash', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const reply = await group.createGroupInvite();
    const created = successBody(reply, 201);

    expect(Object.keys(created.invite).sort()).toEqual(
      Object.keys(groupInviteSchema.shape).sort(),
    );
    expect(created.invite).toMatchObject({
      kind: 'group',
      revoked_at: null,
      status: 'active',
    });
    expect(
      Date.parse(created.invite.expires_at) -
        Date.parse(created.invite.created_at),
    ).toBe(SEVEN_DAYS_MS);
    expect(created.join_url).toBe(
      `https://splitnext.test/join/${group.created.group.id}/${created.invite_token}`,
    );

    const objectId = env.GROUPS.idFromName(group.created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<StoredInvite>('SELECT * FROM invites WHERE id = ?', created.invite.id)
          .toArray()[0],
    );

    expect(stored).toEqual({
      id: created.invite.id,
      kind: 'group',
      token_hash: expect.stringMatching(sha256Hex),
      created_at: created.invite.created_at,
      expires_at: created.invite.expires_at,
      revoked_at: null,
    });
    expect(stored?.token_hash).not.toBe(created.invite_token);
  });

  it('accepts a future expiry and rejects an expiry that has passed', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const accepted = await group.createGroupInvite({ expires_at: expiresAt });

    const rejected = await group.createGroupInvite({
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(successBody(accepted, 201).invite.expires_at).toBe(expiresAt);
    expect(failureBody(rejected, 400)).toEqual({ error: 'invalid_request' });

    const listed = successBody(await group.listGroupInvites(), 200);

    expect(listed.invites).toHaveLength(1);
  });

  it('lists invite metadata without returning either form of its secret', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const first = successBody(await group.createGroupInvite(), 201);
    const second = successBody(await group.createGroupInvite(), 201);
    const listed = successBody(await group.listGroupInvites(), 200);
    const serialized = JSON.stringify(listed);

    expect(listed.invites).toEqual([first.invite, second.invite]);
    expect(serialized).not.toContain(first.invite_token);
    expect(serialized).not.toContain(second.invite_token);
    expect(serialized).not.toContain('token_hash');
    expect(serialized).not.toContain('join_url');
  });

  it('derives expired status from the deadline instead of storing mutable state', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const created = successBody(await group.createGroupInvite(), 201).invite;
    const expiredAt = new Date(Date.now() - 1_000).toISOString();
    const objectId = env.GROUPS.idFromName(group.created.group.id);

    await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) => {
        state.storage.sql.exec(
          'UPDATE invites SET expires_at = ? WHERE id = ?',
          expiredAt,
          created.id,
        );
      },
    );

    const listed = successBody(await group.listGroupInvites(), 200);

    expect(listed.invites).toEqual([
      { ...created, expires_at: expiredAt, status: 'expired' },
    ]);
  });

  it('disables an invite idempotently and retains its record', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const created = successBody(await group.createGroupInvite(), 201).invite;

    const first = successBody(
      await group.revokeGroupInvite(created.id),
      200,
    ).invite;

    const second = successBody(
      await group.revokeGroupInvite(created.id),
      200,
    ).invite;

    expect(first).toEqual({
      ...created,
      revoked_at: expect.any(String),
      status: 'revoked',
    });
    expect(second).toEqual(first);
    expect(successBody(await group.listGroupInvites(), 200)).toEqual({
      invites: [first],
    });
  });

  it('returns not found for an unknown invite', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const response = await group.revokeGroupInvite(crypto.randomUUID());

    expect(failureBody(response, 404)).toEqual({ error: 'invite_not_found' });
  });

  it('requires member access and refuses invite operations after group deletion', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const url = `https://splitnext.test/groups/${group.created.group.id}/invites`;
    const unauthorized = await exports.default.fetch(url);

    await group.deleteGroup({ expected_version: group.created.group.version });

    const deleted = await group.listGroupInvites();

    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: 'unauthorized' });
    expect(failureBody(deleted, 410)).toEqual({ error: 'group_deleted' });
  });

  it('publishes the complete group-invite lifecycle in OpenAPI', async () => {
    const document = await fetchOpenApiDocument();
    const collection = document.paths['/groups/{groupId}/invites'];
    const item = document.paths['/groups/{groupId}/invites/{inviteId}'];

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
    expect(Object.keys(item.delete.responses)).toEqual([
      '200',
      '400',
      '401',
      '404',
      '410',
      '500',
    ]);
  });
});
