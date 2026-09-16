import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { accessTokenSchema } from '../src/accessCredential';
import {
  AuthenticatedGroupDriver,
  failureBody,
  previewGroupInvite,
  redeemGroupInvite,
  successBody,
} from './groupDriver';
import {
  forGroup,
  INVITE_CONTEXT_PATH,
  INVITE_REDEMPTIONS_PATH,
} from '../src/routes/invites';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

type StoredRedemption = {
  member_id: string;
  invite_id: string;
  redeemed_at: string;
};

type StoredAccess = {
  token_hash: string;
  member_id: string;
  device_user_id: string;
};

type RowCount = { count: number };

beforeAll(async () => {
  await applyTestMigrations();
});

// Expiry is tested by moving the clock, so no test may leave it moved.
afterEach(() => {
  vi.useRealTimers();
});

describe('group invite redemption API', () => {
  it('serves a browser form from the generated join URL', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const invite = successBody(await group.createGroupInvite(), 201);
    const response = await exports.default.fetch(invite.join_url);
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(page).toContain('id="join-form"');

    // The form must call routes that are actually registered, not merely agree
    // with itself about a string.
    const { paths } = await fetchOpenApiDocument();

    for (const route of [INVITE_REDEMPTIONS_PATH, INVITE_CONTEXT_PATH]) {
      expect(paths).toHaveProperty([route]);
      expect(page).toContain(forGroup(route, group.created.group.id));
    }

    expect(page).toContain('name="member_id"');
    expect(page).toContain(invite.invite_token);
  });

  it('shows only active members that have never received access', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const ada = successBody(
      await group.createMember({ display_name: 'Ada' }),
      201,
    ).member;

    const grace = successBody(
      await group.createMember({ display_name: 'Grace' }),
      201,
    ).member;

    const invite = successBody(await group.createGroupInvite(), 201);

    await group.deleteMember(grace.id, { expected_version: grace.version });

    const preview = await previewGroupInvite(group.created.group.id, {
      invite_token: invite.invite_token,
    });

    expect(successBody(preview, 200)).toEqual({
      group: {
        id: group.created.group.id,
        name: group.created.group.name,
        currency_label: group.created.group.currency_label,
      },
      claimable_members: [
        { id: ada.id, display_name: ada.display_name },
      ],
    });
  });

  it('claims a pre-created member exactly once', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const member = successBody(
      await group.createMember({ display_name: 'Ada' }),
      201,
    ).member;

    const invite = successBody(await group.createGroupInvite(), 201);
    const deviceUserId = crypto.randomUUID();

    const claimed = successBody(
      await redeemGroupInvite(group.created.group.id, {
        invite_token: invite.invite_token,
        device_user_id: deviceUserId,
        member: { kind: 'existing', member_id: member.id },
      }),
      201,
    );

    expect(claimed.member).toEqual(member);

    const authenticated = await exports.default.fetch(
      `https://splitnext.test/groups/${group.created.group.id}`,
      {
        headers: {
          authorization: `Bearer ${claimed.access_token}`,
          'x-device-user-id': deviceUserId,
        },
      },
    );

    const repeated = await redeemGroupInvite(group.created.group.id, {
      invite_token: invite.invite_token,
      device_user_id: crypto.randomUUID(),
      member: { kind: 'existing', member_id: member.id },
    });

    const preview = await previewGroupInvite(group.created.group.id, {
      invite_token: invite.invite_token,
    });

    expect(authenticated.status).toBe(200);
    expect(failureBody(repeated, 409)).toEqual({ error: 'member_claimed' });
    expect(successBody(preview, 200).claimable_members).toEqual([]);
    expect(successBody(await group.listMembers(), 200).members).toEqual([
      group.created.member,
      member,
    ]);
  });

  it('allows only one of two concurrent claims for the same member', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const member = successBody(
      await group.createMember({ display_name: 'Ada' }),
      201,
    ).member;

    const invite = successBody(await group.createGroupInvite(), 201);

    const redeem = (device_user_id: string) =>
      redeemGroupInvite(group.created.group.id, {
        invite_token: invite.invite_token,
        device_user_id,
        member: { kind: 'existing', member_id: member.id },
      });

    const replies = await Promise.all([
      redeem(crypto.randomUUID()),
      redeem(crypto.randomUUID()),
    ]);

    expect(replies.map(({ status }) => status).sort((a, b) => a - b)).toEqual([
      201,
      409,
    ]);

    const objectId = env.GROUPS.idFromName(group.created.group.id);

    const counts = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) => ({
        access: state.storage.sql
          .exec<RowCount>(
            'SELECT COUNT(*) AS count FROM member_access WHERE member_id = ?',
            member.id,
          )
          .toArray()[0]?.count,
        redemptions: state.storage.sql
          .exec<RowCount>(
            'SELECT COUNT(*) AS count FROM invite_redemptions WHERE member_id = ?',
            member.id,
          )
          .toArray()[0]?.count,
      }),
    );

    expect(counts).toEqual({ access: 1, redemptions: 1 });
  });

  it('refuses unknown and deleted member selections', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const member = successBody(
      await group.createMember({ display_name: 'Ada' }),
      201,
    ).member;

    const invite = successBody(await group.createGroupInvite(), 201);

    await group.deleteMember(member.id, { expected_version: member.version });

    const missing = await redeemGroupInvite(group.created.group.id, {
      invite_token: invite.invite_token,
      device_user_id: crypto.randomUUID(),
      member: { kind: 'existing', member_id: crypto.randomUUID() },
    });

    const deleted = await redeemGroupInvite(group.created.group.id, {
      invite_token: invite.invite_token,
      device_user_id: crypto.randomUUID(),
      member: { kind: 'existing', member_id: member.id },
    });

    expect(failureBody(missing, 404)).toEqual({ error: 'member_not_found' });
    expect(failureBody(deleted, 410)).toEqual({ error: 'member_deleted' });
  });

  it('creates a member, issues permanent access, and records the redemption', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const invite = successBody(await group.createGroupInvite(), 201);
    const deviceUserId = crypto.randomUUID();

    const reply = await redeemGroupInvite(group.created.group.id, {
      invite_token: invite.invite_token,
      device_user_id: deviceUserId,
      member: { kind: 'new', display_name: 'Alex' },
    });

    const redeemed = successBody(reply, 201);

    expect(redeemed.group).toEqual(group.created.group);
    expect(redeemed.member).toMatchObject({
      version: 1,
      display_name: 'Alex',
      deleted_at: null,
    });
    expect(accessTokenSchema.safeParse(redeemed.access_token).success).toBe(true);
    expect(redeemed.access_token).not.toBe(invite.invite_token);

    const authenticated = await exports.default.fetch(
      `https://splitnext.test/groups/${group.created.group.id}`,
      {
        headers: {
          authorization: `Bearer ${redeemed.access_token}`,
          'x-device-user-id': deviceUserId,
        },
      },
    );

    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({ group: group.created.group });

    const objectId = env.GROUPS.idFromName(group.created.group.id);

    const stored = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) => ({
        redemption: state.storage.sql
          .exec<StoredRedemption>('SELECT * FROM invite_redemptions')
          .toArray()[0],
        access: state.storage.sql
          .exec<StoredAccess>(
            `SELECT token_hash, member_id, device_user_id
             FROM member_access
             WHERE member_id = ?`,
            redeemed.member.id,
          )
          .toArray()[0],
      }),
    );

    expect(stored.redemption).toMatchObject({
      member_id: redeemed.member.id,
      invite_id: invite.invite.id,
    });
    expect(Date.parse(stored.redemption?.redeemed_at ?? '')).toBeGreaterThanOrEqual(
      Date.parse(redeemed.member.created_at),
    );
    expect(stored.access).toEqual({
      token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      member_id: redeemed.member.id,
      device_user_id: deviceUserId,
    });
    expect(stored.access?.token_hash).not.toBe(redeemed.access_token);
  });

  it('allows a group invite to create more than one distinct member', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const invite = successBody(await group.createGroupInvite(), 201);

    const first = successBody(
      await redeemGroupInvite(group.created.group.id, {
        invite_token: invite.invite_token,
        device_user_id: crypto.randomUUID(),
        member: { kind: 'new', display_name: 'Alex' },
      }),
      201,
    );

    const second = successBody(
      await redeemGroupInvite(group.created.group.id, {
        invite_token: invite.invite_token,
        device_user_id: crypto.randomUUID(),
        member: { kind: 'new', display_name: 'Sam' },
      }),
      201,
    );

    expect(second.member.id).not.toBe(first.member.id);
    expect(second.access_token).not.toBe(first.access_token);

    const members = successBody(await group.listMembers(), 200).members;

    expect(members).toEqual(
      expect.arrayContaining([
        group.created.member,
        first.member,
        second.member,
      ]),
    );

    const objectId = env.GROUPS.idFromName(group.created.group.id);

    const redemptionCount = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<RowCount>(
            'SELECT COUNT(*) AS count FROM invite_redemptions WHERE invite_id = ?',
            invite.invite.id,
          )
          .toArray()[0]?.count,
    );

    expect(redemptionCount).toBe(2);
  });

  it('rejects an invalid token without provisioning an unknown group', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const input = {
      invite_token: '0'.repeat(64),
      device_user_id: crypto.randomUUID(),
      member: { kind: 'new' as const, display_name: 'Alex' },
    };

    const wrongToken = await redeemGroupInvite(group.created.group.id, input);

    const wrongPreview = await previewGroupInvite(group.created.group.id, {
      invite_token: input.invite_token,
    });

    const unknownGroupId = crypto.randomUUID();
    const unknownGroup = await redeemGroupInvite(unknownGroupId, input);

    const unknownPreview = await previewGroupInvite(unknownGroupId, {
      invite_token: input.invite_token,
    });

    expect(failureBody(wrongToken, 401)).toEqual({ error: 'invite_invalid' });
    expect(failureBody(wrongPreview, 401)).toEqual({ error: 'invite_invalid' });
    expect(failureBody(unknownGroup, 401)).toEqual({ error: 'invite_invalid' });
    expect(failureBody(unknownPreview, 401)).toEqual({ error: 'invite_invalid' });

    const objectId = env.GROUPS.idFromName(unknownGroupId);

    const tables = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
          )
          .toArray(),
    );

    expect(tables).toEqual([]);
  });

  it('rejects expired and revoked invites without creating members', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const expired = successBody(await group.createGroupInvite(), 201);
    const revoked = successBody(await group.createGroupInvite(), 201);
    const objectId = env.GROUPS.idFromName(group.created.group.id);

    await group.revokeGroupInvite(revoked.invite.id);

    // Move past both deadlines instead of rewriting rows. The revoked invite is
    // now also past its date, so this checks revocation still wins.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(expired.invite.expires_at) + 1_000);

    const expiredReply = await redeemGroupInvite(group.created.group.id, {
      invite_token: expired.invite_token,
      device_user_id: crypto.randomUUID(),
      member: { kind: 'new', display_name: 'Too late' },
    });

    const revokedReply = await redeemGroupInvite(group.created.group.id, {
      invite_token: revoked.invite_token,
      device_user_id: crypto.randomUUID(),
      member: { kind: 'new', display_name: 'Disabled' },
    });

    expect(failureBody(expiredReply, 410)).toEqual({ error: 'invite_expired' });
    expect(failureBody(revokedReply, 410)).toEqual({ error: 'invite_revoked' });
    expect(successBody(await group.listMembers(), 200)).toEqual({
      members: [group.created.member],
    });

    const redemptionCount = await runInDurableObject(
      env.GROUPS.get(objectId),
      (_instance, state) =>
        state.storage.sql
          .exec<RowCount>('SELECT COUNT(*) AS count FROM invite_redemptions')
          .toArray()[0]?.count,
    );

    expect(redemptionCount).toBe(0);
  });

  it('refuses redemption after the group is deleted', async () => {
    const group = await AuthenticatedGroupDriver.create();
    const invite = successBody(await group.createGroupInvite(), 201);

    await group.deleteGroup({ expected_version: group.created.group.version });

    const response = await redeemGroupInvite(group.created.group.id, {
      invite_token: invite.invite_token,
      device_user_id: crypto.randomUUID(),
      member: { kind: 'new', display_name: 'Alex' },
    });

    expect(failureBody(response, 410)).toEqual({ error: 'group_deleted' });
  });

  it('validates redemption commands at both HTTP and Durable Object seams', async () => {
    const group = await AuthenticatedGroupDriver.create();

    const invalid = {
      invite_token: 'not-a-token',
      device_user_id: '',
      member: { kind: 'new' as const, display_name: '' },
    };

    const response = await exports.default.fetch(
      `https://splitnext.test/groups/${group.created.group.id}/invite-redemptions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(invalid),
      },
    );

    const objectId = env.GROUPS.idFromName(group.created.group.id);
    const stub = env.GROUPS.get(objectId);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    await expect(stub.redeemGroupInvite(invalid)).resolves.toEqual({
      ok: false,
      error: 'invalid_request',
    });
  });

  it('publishes invite redemption in OpenAPI', async () => {
    const document = await fetchOpenApiDocument();
    const route = document.paths['/groups/{groupId}/invite-redemptions'];
    const context = document.paths['/groups/{groupId}/invite-context'];

    expect(Object.keys(route.post.responses)).toEqual([
      '201',
      '400',
      '401',
      '404',
      '409',
      '410',
      '500',
    ]);
    expect(Object.keys(context.post.responses)).toEqual([
      '200',
      '400',
      '401',
      '410',
      '500',
    ]);
  });
});
