import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

const identitySchema = z.object({ identity: z.object({ id: identifierSchema }) });

const createdSchema = z.object({
  group: z.object({ id: identifierSchema }),
  member: z.object({ id: identifierSchema }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('direct group joining', () => {
  it('grants a second identity access with a new preferred member', async () => {
    const fixture = await createFixture('A', 'B');
    const memberId = createIdentifier();

    const request = {
      join_id: createIdentifier(),
      preferred_member: {
        kind: 'new' as const,
        member_id: memberId,
        display_name: 'Robin',
      },
    };

    const response = await join(fixture, request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      revision: 2,
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

  it('returns the original response when a join is retried', async () => {
    const fixture = await createFixture('C', 'D');
    const request = newMemberJoin('Robin');
    const first = await join(fixture, request);
    const repeated = await join(fixture, request);

    expect(await repeated.json()).toEqual(await first.json());
  });

  it('can select an existing member nonexclusively', async () => {
    const fixture = await createFixture('E', 'F');

    const response = await join(fixture, {
      join_id: createIdentifier(),
      preferred_member: {
        kind: 'existing',
        member_id: fixture.created.member.id,
      },
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
    const fixture = await createFixture('G', 'H');
    const response = await join(fixture, newMemberJoin(' santi '));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'member_name_taken' });
  });

  it('returns not found for an unknown group', async () => {
    const joiner = await createIdentity('I');

    const response = await exports.default.fetch(
      `https://splitnext.test/groups/${createIdentifier()}/join`,
      {
        method: 'POST',
        headers: requestHeaders(joiner.deviceSecret),
        body: JSON.stringify(newMemberJoin('Robin')),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'group_not_found' });
  });

  it('publishes direct joining and no invitation routes', async () => {
    const document = await fetchOpenApiDocument();

    expect(document.paths['/groups/{groupId}/join'].post.responses).toHaveProperty(
      '200',
    );
    expect(document.paths).not.toHaveProperty('/groups/{groupId}/invite-link');
    expect(document.paths).not.toHaveProperty('/join/{groupId}/{inviteToken}');
  });
});

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

async function createFixture(creatorSeed: string, joinerSeed: string) {
  const creator = await createIdentity(creatorSeed);
  const joiner = await createIdentity(joinerSeed);
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

  const identity = identitySchema.parse(await response.json());

  return { deviceSecret, identityId: identity.identity.id };
}

function join(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  request: ReturnType<typeof newMemberJoin> | {
    join_id: string;
    preferred_member: { kind: 'existing'; member_id: string };
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

function requestHeaders(deviceSecret: string) {
  return {
    authorization: `Bearer v1.${deviceSecret}`,
    'content-type': 'application/json',
  };
}
