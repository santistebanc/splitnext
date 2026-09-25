import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { initializeGroup } from '../src/domain/groups';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { createInviteToken, hashInviteToken } from '../src/domain/invites';
import { MemoryGroupRepository } from '../src/groupRepository';
import { GroupStore } from '../src/groupStore';
import {
  applyTestMigrations,
  fetchOpenApiDocument,
  randomDeviceSecret,
} from './harness';

const identitySchema = z.object({ identity: z.object({ id: identifierSchema }) });

const createdSchema = z.object({
  group: z.object({ id: identifierSchema }),
  member: z.object({ id: identifierSchema }),
});

const inviteSchema = z.object({
  revision: z.number(),
  invite: z.object({ id: identifierSchema, expires_at: z.iso.datetime() }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('joining through an invite link', () => {
  it('grants a second identity access with a new preferred member', async () => {
    const fixture = await createFixture();
    const { token } = await createInvite(fixture);
    const memberId = createIdentifier();

    const response = await join(fixture, {
      join_id: createIdentifier(),
      preferred_member: {
        kind: 'new',
        member_id: memberId,
        display_name: 'Robin',
      },
      invite_token: token,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      revision: 3,
      access: {
        identity_id: fixture.joiner.identityId,
        actor_handle: 'User 2',
        preferred_member_id: memberId,
        hidden_at: null,
      },
      snapshot: {
        members: [{ display_name: 'Santi' }, { display_name: 'Robin' }],
        access_grants: [
          { actor_handle: 'User 1' },
          { actor_handle: 'User 2' },
        ],
      },
    });
  });

  it('requires a current invite from identities joining for the first time', async () => {
    const fixture = await createFixture();

    const withoutInvite = await join(fixture, newMemberJoin('Robin'));

    const unknownInvite = await join(fixture, {
      ...newMemberJoin('Robin'),
      invite_token: createInviteToken(),
    });

    expect(withoutInvite.status).toBe(403);
    expect(await withoutInvite.json()).toEqual({ error: 'invite_required' });
    expect(unknownInvite.status).toBe(403);
    expect(await unknownInvite.json()).toEqual({ error: 'invite_invalid' });
  });

  it('returns the original response when a join is retried after revocation', async () => {
    const fixture = await createFixture();
    const invite = await createInvite(fixture);
    const request = { ...newMemberJoin('Robin'), invite_token: invite.token };
    const first = await join(fixture, request);

    await revokeInvite(fixture, invite.id);

    const repeated = await join(fixture, request);

    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(await first.json());
  });

  it('can select an existing member nonexclusively', async () => {
    const fixture = await createFixture();
    const { token } = await createInvite(fixture);

    const response = await join(fixture, {
      join_id: createIdentifier(),
      preferred_member: {
        kind: 'existing',
        member_id: fixture.created.member.id,
      },
      invite_token: token,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access: { preferred_member_id: fixture.created.member.id },
      snapshot: {
        members: [{ id: fixture.created.member.id }],
        access_grants: [
          { preferred_member_id: fixture.created.member.id },
          { preferred_member_id: fixture.created.member.id },
        ],
      },
    });
  });

  it('rejects a duplicate active member name', async () => {
    const fixture = await createFixture();
    const { token } = await createInvite(fixture);

    const response = await join(fixture, {
      ...newMemberJoin(' santi '),
      invite_token: token,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'member_name_taken' });
  });

  it('returns not found for an unknown group', async () => {
    const joiner = await createIdentity();

    const response = await exports.default.fetch(
      `https://splitnext.test/groups/${createIdentifier()}/join`,
      {
        method: 'POST',
        headers: requestHeaders(joiner.deviceSecret),
        body: JSON.stringify({
          ...newMemberJoin('Robin'),
          invite_token: createInviteToken(),
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'group_not_found' });
  });

  it('lets an identity that left rejoin without an invite', async () => {
    const fixture = await createFixture();
    const invite = await createInvite(fixture);

    await join(fixture, { ...newMemberJoin('Robin'), invite_token: invite.token });
    await revokeInvite(fixture, invite.id);
    await sync(fixture.groupId, fixture.joiner.deviceSecret, [
      { command_id: createIdentifier(), type: 'group.leave', payload: {} },
    ]);

    const rejoined = await join(fixture, {
      join_id: createIdentifier(),
      preferred_member: {
        kind: 'existing',
        member_id: fixture.created.member.id,
      },
    });

    expect(rejoined.status).toBe(200);
    expect(await rejoined.json()).toMatchObject({
      access: { actor_handle: 'User 2', hidden_at: null },
    });
  });
});

describe('group invite links', () => {
  it('replaces the previous link, which then stops working', async () => {
    const fixture = await createFixture();
    const first = await createInvite(fixture);
    const second = await createInvite(fixture);

    const withFirst = await join(fixture, {
      ...newMemberJoin('Robin'),
      invite_token: first.token,
    });

    const withSecond = await join(fixture, {
      ...newMemberJoin('Robin'),
      invite_token: second.token,
    });

    expect(second.revision).toBe(first.revision + 1);
    expect(withFirst.status).toBe(403);
    expect(await withFirst.json()).toEqual({ error: 'invite_revoked' });
    expect(withSecond.status).toBe(200);
    expect(await withSecond.json()).toMatchObject({
      snapshot: {
        invite: {
          id: second.id,
          created_by_identity_id: fixture.creator.identityId,
        },
      },
    });
  });

  it('keeps access granted through a link after the link is revoked', async () => {
    const fixture = await createFixture();
    const invite = await createInvite(fixture);

    await join(fixture, { ...newMemberJoin('Robin'), invite_token: invite.token });

    const revoked = await revokeInvite(fixture, invite.id);
    const synced = await sync(fixture.groupId, fixture.joiner.deviceSecret, []);

    expect(revoked.status).toBe(200);
    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({
      state: { snapshot: { invite: null } },
    });
  });

  it('returns the same link when a creation is retried', async () => {
    const fixture = await createFixture();
    const inviteId = createIdentifier();
    const token = createInviteToken();
    const first = await postInvite(fixture, { invite_id: inviteId, token });
    const repeated = await postInvite(fixture, { invite_id: inviteId, token });

    const conflicting = await postInvite(fixture, {
      invite_id: inviteId,
      token: createInviteToken(),
    });

    expect(first.status).toBe(201);
    expect(await repeated.json()).toEqual(await first.json());
    expect(conflicting.status).toBe(409);
  });

  it('lets only participants manage links', async () => {
    const fixture = await createFixture();

    const response = await exports.default.fetch(
      `https://splitnext.test/groups/${fixture.groupId}/invites`,
      {
        method: 'POST',
        headers: requestHeaders(fixture.joiner.deviceSecret),
        body: JSON.stringify({
          invite_id: createIdentifier(),
          token: createInviteToken(),
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it('bounds the lifetime a creator can choose', async () => {
    const fixture = await createFixture();

    const tooLong = await postInvite(fixture, {
      invite_id: createIdentifier(),
      token: createInviteToken(),
      expires_in_hours: 24 * 31,
    });

    const chosen = inviteSchema.parse(
      await (
        await postInvite(fixture, {
          invite_id: createIdentifier(),
          token: createInviteToken(),
          expires_in_hours: 1,
        })
      ).json(),
    );

    expect(tooLong.status).toBe(400);
    expect(Date.parse(chosen.invite.expires_at) - Date.now()).toBeLessThanOrEqual(
      3_600_000,
    );
  });

  it('previews the group and its active members for a link holder', async () => {
    const fixture = await createFixture();
    const { token } = await createInvite(fixture);
    const preview = await previewInvite(fixture, token);
    const unknown = await previewInvite(fixture, createInviteToken());

    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      group: { id: fixture.groupId, name: 'Berlin flat', currency_code: 'EUR' },
      members: [{ id: fixture.created.member.id, display_name: 'Santi' }],
    });
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toEqual({ error: 'invite_invalid' });
  });

  it('never exposes the token in group state', async () => {
    const fixture = await createFixture();
    const { token } = await createInvite(fixture);

    const inspection = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${fixture.groupId}`,
    );

    const serialized = JSON.stringify(await inspection.json());

    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(await hashInviteToken(token));
  });

  it('publishes invite routes and no direct joining', async () => {
    const document = await fetchOpenApiDocument();

    expect(document.paths).toHaveProperty(['/groups/{groupId}/invites']);
    expect(document.paths).toHaveProperty(['/groups/{groupId}/invites/preview']);
    expect(document.paths).toHaveProperty([
      '/groups/{groupId}/invites/{inviteId}/revoke',
    ]);
    expect(JSON.stringify(document.paths['/groups/{groupId}/join'])).not.toContain(
      'without an invitation',
    );
  });
});

describe('invite expiry', () => {
  it('refuses previews and joins once the link has expired', async () => {
    const store = new GroupStore(new MemoryGroupRepository());
    const groupId = createIdentifier();
    const creatorId = createIdentifier();
    const joinerId = createIdentifier();
    const tokenHash = await hashInviteToken(createInviteToken());

    store.create(
      initializeGroup({
        group_id: groupId,
        creator_identity_id: creatorId,
        member_id: createIdentifier(),
        name: 'Berlin flat',
        currency_code: 'EUR',
        creator_member_name: 'Santi',
        created_at: '2026-09-24T10:00:00.000Z',
      }),
    );
    store.createInvite({
      group_id: groupId,
      identity_id: creatorId,
      invite_id: createIdentifier(),
      token_hash: tokenHash,
      created_at: '2026-09-24T10:00:00.000Z',
      expires_at: '2026-09-24T11:00:00.000Z',
    });

    const joinAt = (joinedAt: string) =>
      store.join({
        group_id: groupId,
        identity_id: joinerId,
        join_id: createIdentifier(),
        joined_at: joinedAt,
        invite_token_hash: tokenHash,
        preferred_member: {
          kind: 'new',
          member_id: createIdentifier(),
          display_name: 'Robin',
        },
      });

    expect(store.previewInvite(tokenHash, '2026-09-24T11:00:00.000Z')).toEqual({
      ok: false,
      error: 'invite_expired',
    });
    expect(joinAt('2026-09-24T11:00:00.000Z')).toEqual({
      ok: false,
      error: 'invite_expired',
    });
    expect(joinAt('2026-09-24T10:59:59.000Z')).toMatchObject({ ok: true });
  });
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

function newMemberJoin(displayName: string) {
  return {
    join_id: createIdentifier(),
    preferred_member: {
      kind: 'new' as const,
      member_id: createIdentifier(),
      display_name: displayName,
    },
  };
}

async function createFixture() {
  const creator = await createIdentity();
  const joiner = await createIdentity();
  const groupId = createIdentifier();

  const response = await exports.default.fetch('https://splitnext.test/groups', {
    method: 'POST',
    headers: requestHeaders(creator.deviceSecret),
    body: JSON.stringify({
      group_id: groupId,
      name: 'Berlin flat',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    }),
  });

  return {
    groupId,
    creator,
    joiner,
    created: createdSchema.parse(await response.json()),
  };
}

async function createIdentity() {
  const deviceSecret = randomDeviceSecret();

  const response = await exports.default.fetch(
    'https://splitnext.test/identities/anonymous',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_secret: deviceSecret }),
    },
  );

  const identity = identitySchema.parse(await response.json());

  return { deviceSecret, identityId: identity.identity.id };
}

function postInvite(
  fixture: Fixture,
  body: { invite_id: string; token: string; expires_in_hours?: number },
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.groupId}/invites`,
    {
      method: 'POST',
      headers: requestHeaders(fixture.creator.deviceSecret),
      body: JSON.stringify(body),
    },
  );
}

async function createInvite(fixture: Fixture) {
  const token = createInviteToken();

  const response = await postInvite(fixture, {
    invite_id: createIdentifier(),
    token,
  });

  expect(response.status).toBe(201);

  const created = inviteSchema.parse(await response.json());

  return { token, id: created.invite.id, revision: created.revision };
}

function revokeInvite(fixture: Fixture, inviteId: string) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.groupId}/invites/${inviteId}/revoke`,
    { method: 'POST', headers: requestHeaders(fixture.creator.deviceSecret) },
  );
}

function previewInvite(fixture: Fixture, token: string) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.groupId}/invites/preview`,
    {
      method: 'POST',
      headers: requestHeaders(fixture.joiner.deviceSecret),
      body: JSON.stringify({ token }),
    },
  );
}

function join(
  fixture: Fixture,
  request: {
    join_id: string;
    preferred_member:
      | { kind: 'existing'; member_id: string }
      | { kind: 'new'; member_id: string; display_name: string };
    invite_token?: string;
  },
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.groupId}/join`,
    {
      method: 'POST',
      headers: requestHeaders(fixture.joiner.deviceSecret),
      body: JSON.stringify(request),
    },
  );
}

function sync(
  groupId: string,
  deviceSecret: string,
  commands: { command_id: string; type: string; payload: object }[],
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${groupId}/sync`,
    {
      method: 'POST',
      headers: requestHeaders(deviceSecret),
      body: JSON.stringify({ known_revision: null, commands }),
    },
  );
}

function requestHeaders(deviceSecret: string) {
  return {
    authorization: `Bearer v1.${deviceSecret}`,
    'content-type': 'application/json',
  };
}
