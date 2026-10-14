import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { initializeGroup } from '../src/domain/groups';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import {
  createInviteToken,
  hashInviteToken,
  inviteTokenSchema,
} from '../src/domain/invites';
import { MemoryGroupRepository } from '../src/groupRepository';
import { GroupStore } from '../src/groupStore';
import {
  groupSessionSchema,
  syncGroupResponseSchema,
} from '../src/domain/sync';
import {
  applyTestMigrations,
  fetchOpenApiDocument,
  randomDeviceSecret,
} from './harness';

const identitySchema = z.object({
  identity: z.object({ id: identifierSchema }),
});

const createdSchema = z.object({
  group: z.object({ id: identifierSchema }),
  member: z.object({ id: identifierSchema }),
});

const inviteSchema = z.object({
  revision: z.number(),
  invite: z.strictObject({
    id: identifierSchema,
    created_by_identity_id: identifierSchema,
    created_at: z.iso.datetime(),
    token: inviteTokenSchema,
  }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('joining through an invite link', () => {
  it('grants a second identity access with a new preferred member', async () => {
    const fixture = await createFixture();
    const { token } = await regenerateInvite(fixture);
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
        access_grants: [{ actor_handle: 'User 1' }, { actor_handle: 'User 2' }],
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

  it('returns the original response when a join is retried after regeneration', async () => {
    const fixture = await createFixture();
    const invite = await regenerateInvite(fixture);
    const request = { ...newMemberJoin('Robin'), invite_token: invite.token };
    const first = await join(fixture, request);

    await regenerateInvite(fixture);

    const repeated = await join(fixture, request);

    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(await first.json());
  });

  it('can select an existing member nonexclusively', async () => {
    const fixture = await createFixture();
    const { token } = await regenerateInvite(fixture);

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

  it('joins an existing active member by name without duplicates and retains the submitted id as an alias', async () => {
    const fixture = await createFixture();
    const { token } = await regenerateInvite(fixture);

    const request = {
      ...newMemberJoin(' santi '),
      invite_token: token,
    };

    const response = await join(fixture, request);

    expect(response.status).toBe(200);
    const joined = groupSessionSchema.parse(await response.json());
    expect(joined.snapshot.members).toHaveLength(1);
    expect(joined.access.preferred_member_id).toBe(fixture.created.member.id);
    expect(
      joined.snapshot.access_grants.map((grant) => grant.preferred_member_id),
    ).toEqual([fixture.created.member.id, fixture.created.member.id]);

    const repeated = await join(fixture, request);
    expect(repeated.status).toBe(200);
    expect(groupSessionSchema.parse(await repeated.json()).revision).toBe(
      joined.revision,
    );

    const sync = await exports.default.fetch(
      `https://splitnext.test/groups/${fixture.groupId}/sync`,
      {
        method: 'POST',
        headers: requestHeaders(fixture.joiner.deviceSecret),
        body: JSON.stringify({
          known_revision: joined.revision,
          commands: [
            {
              command_id: createIdentifier(),
              type: 'member.rename',
              payload: {
                member_id: request.preferred_member.member_id,
                expected_display_name: 'Santi',
                display_name: 'Santiago',
              },
            },
          ],
        }),
      },
    );

    expect(sync.status).toBe(200);
    const synchronized = syncGroupResponseSchema.parse(await sync.json());
    expect(synchronized.outcomes[0]?.status).toBe('applied');

    if (synchronized.state.kind !== 'snapshot')
      throw new Error('Expected a snapshot');
    expect(synchronized.state.snapshot.members).toMatchObject([
      { id: fixture.created.member.id, display_name: 'Santiago' },
    ]);

    const reusedId = await join(fixture, {
      ...request,
      join_id: createIdentifier(),
      preferred_member: {
        ...request.preferred_member,
        display_name: 'Someone else',
      },
    });

    expect(reusedId.status).toBe(409);
    expect(await reusedId.json()).toEqual({ error: 'member_id_exists' });
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
    const invite = await regenerateInvite(fixture);

    await join(fixture, {
      ...newMemberJoin('Robin'),
      invite_token: invite.token,
    });
    await regenerateInvite(fixture);
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
    const first = await regenerateInvite(fixture);
    const second = await regenerateInvite(fixture);

    // A delayed retry of the old creation must not reactivate its link or
    // invalidate the newly generated one.
    const retried = await putInvite(fixture, {
      invite_id: first.id,
      token: first.token,
    });

    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      revision: second.revision,
      invite: { id: second.id },
    });

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
    expect(await withFirst.json()).toEqual({ error: 'invite_replaced' });
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

  it('keeps access granted through a link after it is regenerated', async () => {
    const fixture = await createFixture();
    const invite = await regenerateInvite(fixture);

    await join(fixture, {
      ...newMemberJoin('Robin'),
      invite_token: invite.token,
    });

    const replacement = await regenerateInvite(fixture);
    const synced = await sync(fixture.groupId, fixture.joiner.deviceSecret, []);

    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({
      state: { snapshot: { invite: { id: replacement.id } } },
    });
  });

  it('returns the same link when a creation is retried', async () => {
    const fixture = await createFixture();
    const inviteId = createIdentifier();
    const token = createInviteToken();
    const first = await putInvite(fixture, { invite_id: inviteId, token });
    const repeated = await putInvite(fixture, { invite_id: inviteId, token });

    const conflicting = await putInvite(fixture, {
      invite_id: inviteId,
      token: createInviteToken(),
    });

    expect(first.status).toBe(200);
    expect(await repeated.json()).toEqual(await first.json());
    expect(conflicting.status).toBe(409);
  });

  it('lets only participants manage links', async () => {
    const fixture = await createFixture();

    const response = await exports.default.fetch(
      `https://splitnext.test/groups/${fixture.groupId}/invite`,
      {
        method: 'PUT',
        headers: requestHeaders(fixture.joiner.deviceSecret),
        body: JSON.stringify({
          invite_id: createIdentifier(),
          token: createInviteToken(),
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it('previews the group and its active members for a link holder', async () => {
    const fixture = await createFixture();
    const { token } = await regenerateInvite(fixture);
    const preview = await previewInvite(fixture, token);
    const unknown = await previewInvite(fixture, createInviteToken());

    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      group: { id: fixture.groupId, name: 'Berlin flat' },
      members: [
        { id: fixture.created.member.id, display_name: 'Santi', in_use: true },
      ],
    });
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toEqual({ error: 'invite_invalid' });
  });

  it('shares the token in authorized snapshots and omits it from previews', async () => {
    const fixture = await createFixture();
    const { token } = await regenerateInvite(fixture);

    const inspection = await exports.default.fetch(
      `https://splitnext.test/groups/${fixture.groupId}/sync`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer v1.${fixture.creator.deviceSecret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ known_revision: 0, commands: [] }),
      },
    );

    const serialized = JSON.stringify(await inspection.json());

    expect(inspection.status).toBe(200);
    expect(serialized).toContain(token);
    expect(serialized).not.toContain(await hashInviteToken(token));

    const preview = await previewInvite(fixture, token);
    expect(await preview.text()).not.toContain(token);
  });

  it('does not expose collection creation or standalone revocation', async () => {
    const fixture = await createFixture();
    const invite = await regenerateInvite(fixture);

    for (const path of [
      `/groups/${fixture.groupId}/invites`,
      `/groups/${fixture.groupId}/invites/${invite.id}/revoke`,
    ]) {
      const response = await exports.default.fetch(
        `https://splitnext.test${path}`,
        {
          method: 'POST',
          headers: requestHeaders(fixture.creator.deviceSecret),
          body: JSON.stringify({
            invite_id: createIdentifier(),
            token: createInviteToken(),
          }),
        },
      );

      expect(response.status).toBe(404);
    }

    // Neither discarded operation can remove or replace the current link.
    expect((await previewInvite(fixture, invite.token)).status).toBe(200);
  });

  it('publishes invite routes and no direct joining', async () => {
    const document = await fetchOpenApiDocument();

    expect(document.paths).toHaveProperty(['/groups/{groupId}/invite']);
    expect(document.paths).toHaveProperty(['/groups/{groupId}/invite/preview']);
    expect(document.paths).not.toHaveProperty(['/groups/{groupId}/invites']);
    expect(document.paths).not.toHaveProperty([
      '/groups/{groupId}/invites/{inviteId}/revoke',
    ]);
    expect(document.paths['/groups/{groupId}/invite']).toHaveProperty('put');
    expect(document.paths['/groups/{groupId}/invite']).not.toHaveProperty(
      'post',
    );
    expect(
      JSON.stringify(document.paths['/groups/{groupId}/join']),
    ).not.toContain('without an invitation');
    expect(JSON.stringify(document.paths)).not.toContain('expires_at');
    expect(JSON.stringify(document.paths)).not.toContain('expires_in_hours');
  });
});

describe('permanent invite links', () => {
  it('allows joining years later until the link is regenerated', async () => {
    const store = new GroupStore(new MemoryGroupRepository());
    const groupId = createIdentifier();
    const creatorId = createIdentifier();
    const token = createInviteToken();
    const tokenHash = await hashInviteToken(token);

    store.create(
      initializeGroup({
        group_id: groupId,
        creator_identity_id: creatorId,
        member_id: createIdentifier(),
        name: 'Berlin flat',
        creator_member_name: 'Santi',
        invite_id: createIdentifier(),
        invite_token_hash: 'initial-invite-hash',
        invite_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        created_at: '2026-09-24T10:00:00.000Z',
      }),
    );
    store.regenerateInvite({
      group_id: groupId,
      identity_id: creatorId,
      invite_id: createIdentifier(),
      token_hash: tokenHash,
      token,
      created_at: '2026-09-24T10:00:00.000Z',
    });

    const joinAt = (joinedAt: string) =>
      store.join({
        group_id: groupId,
        identity_id: createIdentifier(),
        join_id: createIdentifier(),
        joined_at: joinedAt,
        invite_token_hash: tokenHash,
        preferred_member: {
          kind: 'new',
          member_id: createIdentifier(),
          display_name: 'Robin',
        },
      });

    expect(joinAt('2050-09-24T10:00:00.000Z')).toMatchObject({ ok: true });
    expect(store.previewInvite(tokenHash)).toMatchObject({ ok: true });

    store.regenerateInvite({
      group_id: groupId,
      identity_id: creatorId,
      invite_id: createIdentifier(),
      token_hash: await hashInviteToken(createInviteToken()),
      token: createInviteToken(),
      created_at: '2050-09-24T11:00:00.000Z',
    });

    expect(store.previewInvite(tokenHash)).toEqual({
      ok: false,
      error: 'invite_replaced',
    });
    expect(joinAt('2050-09-24T12:00:00.000Z')).toEqual({
      ok: false,
      error: 'invite_replaced',
    });
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

  const response = await exports.default.fetch(
    'https://splitnext.test/groups',
    {
      method: 'POST',
      headers: requestHeaders(creator.deviceSecret),
      body: JSON.stringify({
        group_id: groupId,
        name: 'Berlin flat',
        creator_member_name: 'Santi',
        invite: { invite_id: createIdentifier(), token: createInviteToken() },
      }),
    },
  );

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

function putInvite(
  fixture: Fixture,
  body: { invite_id: string; token: string },
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.groupId}/invite`,
    {
      method: 'PUT',
      headers: requestHeaders(fixture.creator.deviceSecret),
      body: JSON.stringify(body),
    },
  );
}

async function regenerateInvite(fixture: Fixture) {
  const token = createInviteToken();

  const response = await putInvite(fixture, {
    invite_id: createIdentifier(),
    token,
  });

  expect(response.status).toBe(200);

  const created = inviteSchema.parse(await response.json());

  return { token, id: created.invite.id, revision: created.revision };
}

function previewInvite(fixture: Fixture, token: string) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.groupId}/invite/preview`,
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
