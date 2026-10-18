import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { createInviteToken, groupInviteSchema } from '../src/domain/invites';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

const identityResponseSchema = z.object({
  identity: z.object({ id: identifierSchema }),
});

const groupResponseSchema = z.object({
  invite: groupInviteSchema,
  group: z.strictObject({
    id: identifierSchema,
    name: z.string(),
    created_at: z.iso.datetime(),
    revision: z.number(),
  }),
  member: z.object({
    id: identifierSchema,
    display_name: z.string(),
    status: z.string(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
  access: z.object({
    identity_id: identifierSchema,
    actor_handle: z.string(),
    preferred_member_id: identifierSchema,
    granted_at: z.iso.datetime(),
    hidden_at: z.null(),
  }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('group sync API', () => {
  it('bootstraps an authorized client from a consistent snapshot', async () => {
    const fixture = await createGroupFixture('i');
    const response = await sync(fixture, null);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revision: 1,
      outcomes: [],
      state: {
        kind: 'snapshot',
        snapshot: {
          group: {
            id: fixture.created.group.id,
            name: fixture.created.group.name,
            created_at: fixture.created.group.created_at,
          },
          members: [fixture.created.member],
          expenses: [],
          access_grants: [fixture.created.access],
          invite: fixture.created.invite,
        },
      },
    });
  });

  it('returns unchanged when the client already has the current revision', async () => {
    const fixture = await createGroupFixture('j');
    const response = await sync(fixture, 1);

    expect(await response.json()).toEqual({
      revision: 1,
      outcomes: [],
      state: { kind: 'unchanged' },
    });
  });

  it('replaces stale client state with a complete snapshot', async () => {
    const fixture = await createGroupFixture('k');
    const response = await sync(fixture, 0);

    expect(await response.json()).toMatchObject({
      revision: 1,
      outcomes: [],
      state: { kind: 'snapshot' },
    });
  });

  it('repairs an impossible future revision with a snapshot', async () => {
    const fixture = await createGroupFixture('l');
    const response = await sync(fixture, 99);

    expect(await response.json()).toMatchObject({
      revision: 1,
      outcomes: [],
      state: { kind: 'snapshot' },
    });
  });

  it('does not reveal group state to an identity without a grant', async () => {
    const fixture = await createGroupFixture('m');
    const outsider = await createIdentity('n');

    const response = await sync(
      { ...fixture, deviceSecret: outsider.deviceSecret },
      null,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects unknown command types', async () => {
    const fixture = await createGroupFixture('o');

    const response = await exports.default.fetch(
      `https://splitnext.test/groups/${fixture.created.group.id}/sync`,
      {
        method: 'POST',
        headers: authHeaders(fixture.deviceSecret),
        body: JSON.stringify({
          known_revision: 1,
          commands: [{ type: 'anything' }],
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('publishes sync in OpenAPI', async () => {
    const document = await fetchOpenApiDocument();

    expect(
      document.paths['/groups/{groupId}/sync'].post.responses,
    ).toHaveProperty('200');
  });
});

async function createGroupFixture(seed: string) {
  const identity = await createIdentity(seed);
  const groupId = createIdentifier();

  const response = await exports.default.fetch(
    'https://splitnext.test/groups',
    {
      method: 'POST',
      headers: authHeaders(identity.deviceSecret),
      body: JSON.stringify({
        group_id: groupId,
        name: 'Berlin flat',
        creator_member_name: 'Santi',
        invite: { invite_id: createIdentifier(), token: createInviteToken() },
      }),
    },
  );

  return {
    ...identity,
    created: groupResponseSchema.parse(await response.json()),
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

  const body = identityResponseSchema.parse(await response.json());

  return { deviceSecret, identityId: body.identity.id };
}

function sync(
  fixture: Awaited<ReturnType<typeof createGroupFixture>>,
  knownRevision: number | null,
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.created.group.id}/sync`,
    {
      method: 'POST',
      headers: authHeaders(fixture.deviceSecret),
      body: JSON.stringify({ known_revision: knownRevision, commands: [] }),
    },
  );
}

function authHeaders(deviceSecret: string) {
  return {
    authorization: `Bearer v1.${deviceSecret}`,
    'content-type': 'application/json',
  };
}
