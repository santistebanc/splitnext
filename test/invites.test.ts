import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

const identitySchema = z.object({ identity: z.object({ id: z.uuid() }) });

const createdGroupSchema = z.object({
  group: z.object({ id: z.uuid(), revision: z.number() }),
});

const inviteSchema = z.object({
  revision: z.number(),
  invite: z.object({
    id: z.uuid(),
    token: z.string(),
    join_url: z.string(),
    expires_at: z.iso.datetime(),
  }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('reusable group links', () => {
  it('gives a second identity permanent access with a new preferred member', async () => {
    const fixture = await createFixture('A', 'B');
    const invite = await rotateLink(fixture);
    const memberId = crypto.randomUUID();

    const response = await redeemLink(
      fixture,
      fixture.joiner.deviceSecret,
      invite.invite.token,
      memberId,
      'Robin',
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
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

    const syncResponse = await exports.default.fetch(
      `https://splitnext.test/groups/${fixture.groupId}/sync`,
      {
        method: 'POST',
        headers: requestHeaders(fixture.joiner.deviceSecret),
        body: JSON.stringify({ known_revision: 3, commands: [] }),
      },
    );

    expect(syncResponse.status).toBe(200);
    expect(await syncResponse.json()).toMatchObject({
      revision: 3,
      state: { kind: 'unchanged' },
    });
  });

  it('makes redemption retry-safe after access has been granted', async () => {
    const fixture = await createFixture('C', 'D');
    const invite = await rotateLink(fixture);
    const memberId = crypto.randomUUID();

    const first = await redeemLink(
      fixture,
      fixture.joiner.deviceSecret,
      invite.invite.token,
      memberId,
      'Robin',
    );

    const repeated = await redeemLink(
      fixture,
      fixture.joiner.deviceSecret,
      invite.invite.token,
      memberId,
      'Robin',
    );

    expect(await repeated.json()).toEqual(await first.json());
  });

  it('revokes the previous link when a new link is created', async () => {
    const fixture = await createFixture('E', 'F');
    const first = await rotateLink(fixture);
    const second = await rotateLink(fixture);

    expect(second.invite.token).not.toBe(first.invite.token);

    const response = await redeemLink(
      fixture,
      fixture.joiner.deviceSecret,
      first.invite.token,
      crypto.randomUUID(),
      'Robin',
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid_invite' });
  });

  it('does not create a member whose normalized active name is already used', async () => {
    const fixture = await createFixture('G', 'H');
    const invite = await rotateLink(fixture);

    const response = await redeemLink(
      fixture,
      fixture.joiner.deviceSecret,
      invite.invite.token,
      crypto.randomUUID(),
      '  ＳaｎTi  ',
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'member_name_taken' });

    const syncResponse = await exports.default.fetch(
      `https://splitnext.test/groups/${fixture.groupId}/sync`,
      {
        method: 'POST',
        headers: requestHeaders(fixture.creator.deviceSecret),
        body: JSON.stringify({ known_revision: null, commands: [] }),
      },
    );

    expect(await syncResponse.json()).toMatchObject({
      revision: 2,
      state: {
        snapshot: {
          members: [{ display_name: 'Santi' }],
          access_grants: [{ actor_handle: 'User 1' }],
        },
      },
    });
  });

  it('publishes group-link creation and redemption in OpenAPI', async () => {
    const document = await fetchOpenApiDocument();

    expect(document.paths['/groups/{groupId}/invite-link'].post.responses)
      .toHaveProperty('201');
    expect(document.paths['/join/{groupId}/{inviteToken}'].post.responses)
      .toHaveProperty('200');
  });
});

async function createFixture(creatorSeed: string, joinerSeed: string) {
  const creator = await createIdentity(creatorSeed);
  const joiner = await createIdentity(joinerSeed);
  const groupId = crypto.randomUUID();

  const response = await exports.default.fetch(
    'https://splitnext.test/groups',
    {
      method: 'POST',
      headers: requestHeaders(creator.deviceSecret),
      body: JSON.stringify({
        group_id: groupId,
        name: 'Berlin flat',
        currency_code: 'EUR',
        creator_member_name: 'Santi',
      }),
    },
  );

  createdGroupSchema.parse(await response.json());

  return { creator, joiner, groupId };
}

async function createIdentity(seed: string) {
  const deviceSecret = seed.repeat(43);

  const response = await exports.default.fetch(
    'https://splitnext.test/identities/anonymous',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_secret: deviceSecret }),
    },
  );

  const body = identitySchema.parse(await response.json());

  return { deviceSecret, identityId: body.identity.id };
}

async function rotateLink(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const response = await exports.default.fetch(
    `https://splitnext.test/groups/${fixture.groupId}/invite-link`,
    {
      method: 'POST',
      headers: requestHeaders(fixture.creator.deviceSecret),
    },
  );

  return inviteSchema.parse(await response.json());
}

function redeemLink(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  deviceSecret: string,
  token: string,
  memberId: string,
  displayName: string,
) {
  return exports.default.fetch(
    `https://splitnext.test/join/${fixture.groupId}/${token}`,
    {
      method: 'POST',
      headers: requestHeaders(deviceSecret),
      body: JSON.stringify({
        preferred_member: {
          kind: 'new',
          member_id: memberId,
          display_name: displayName,
        },
      }),
    },
  );
}

function requestHeaders(deviceSecret: string) {
  return {
    authorization: `Bearer v1.${deviceSecret}`,
    'content-type': 'application/json',
  };
}
