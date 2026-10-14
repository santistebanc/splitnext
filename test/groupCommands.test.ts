import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { createInviteToken } from '../src/domain/invites';
import { applyTestMigrations } from './harness';

const createdSchema = z.object({
  group: z.object({
    id: identifierSchema,
    revision: z.number(),
    name: z.string(),
  }),
  member: z.object({ id: identifierSchema }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('group and preference sync commands', () => {
  it('renames a group without overwriting a concurrent rename', async () => {
    const fixture = await createFixture('J');

    const first = {
      command_id: createIdentifier(),
      type: 'group.rename',
      payload: { expected_name: 'Berlin flat', name: 'Summer trip' },
    };

    const stale = {
      command_id: createIdentifier(),
      type: 'group.rename',
      payload: { expected_name: 'Berlin flat', name: 'Winter trip' },
    };

    const firstResponse = await sync(fixture, 1, [first]);
    const staleResponse = await sync(fixture, 1, [stale]);

    expect(await firstResponse.json()).toMatchObject({
      revision: 2,
      outcomes: [{ status: 'applied', command_type: 'group.rename' }],
      state: { snapshot: { group: { name: 'Summer trip' } } },
    });
    expect(await staleResponse.json()).toMatchObject({
      revision: 2,
      outcomes: [
        {
          status: 'superseded',
          reason: 'group_changed',
          server_state: { kind: 'group', group: { name: 'Summer trip' } },
        },
      ],
    });
  });

  it('selects a preferred member after creating it in the same batch', async () => {
    const fixture = await createFixture('K');
    const memberId = createIdentifier();

    const response = await sync(fixture, 1, [
      {
        command_id: createIdentifier(),
        type: 'member.create',
        payload: { member_id: memberId, display_name: 'Robin' },
      },
      {
        command_id: createIdentifier(),
        type: 'preference.set',
        payload: { member_id: memberId },
      },
    ]);

    expect(await response.json()).toMatchObject({
      revision: 3,
      outcomes: [
        { status: 'applied', command_type: 'member.create' },
        { status: 'applied', command_type: 'preference.set' },
      ],
      state: {
        snapshot: {
          access_grants: [{ preferred_member_id: memberId }],
        },
      },
    });
  });

  it('leaves by hiding access and clearing the preferred member, then rejoins', async () => {
    const fixture = await createFixture('L');

    const leave = await sync(fixture, 1, [
      {
        command_id: createIdentifier(),
        type: 'group.leave',
        payload: {},
      },
    ]);

    const leaveBody = await leave.json();

    expect(leaveBody).toMatchObject({
      revision: 2,
      outcomes: [{ status: 'applied', command_type: 'group.leave' }],
      state: {
        snapshot: {
          access_grants: [
            { preferred_member_id: null, hidden_at: expect.any(String) },
          ],
        },
      },
    });

    const rejoin = await exports.default.fetch(
      `https://splitnext.test/groups/${fixture.groupId}/join`,
      {
        method: 'POST',
        headers: requestHeaders(fixture.deviceSecret),
        body: JSON.stringify({
          join_id: createIdentifier(),
          preferred_member: {
            kind: 'existing',
            member_id: fixture.memberId,
          },
        }),
      },
    );

    expect(await rejoin.json()).toMatchObject({
      revision: 3,
      access: {
        preferred_member_id: fixture.memberId,
        hidden_at: null,
      },
    });
  });
});

async function createFixture(seed: string) {
  const deviceSecret = seed.repeat(43);

  await exports.default.fetch('https://splitnext.test/identities/anonymous', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_secret: deviceSecret }),
  });

  const response = await exports.default.fetch(
    'https://splitnext.test/groups',
    {
      method: 'POST',
      headers: requestHeaders(deviceSecret),
      body: JSON.stringify({
        group_id: createIdentifier(),
        name: 'Berlin flat',
        creator_member_name: 'Santi',
        invite: { invite_id: createIdentifier(), token: createInviteToken() },
      }),
    },
  );

  const created = createdSchema.parse(await response.json());

  return {
    deviceSecret,
    groupId: created.group.id,
    memberId: created.member.id,
  };
}

function sync(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  knownRevision: number,
  commands: object[],
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.groupId}/sync`,
    {
      method: 'POST',
      headers: requestHeaders(fixture.deviceSecret),
      body: JSON.stringify({ known_revision: knownRevision, commands }),
    },
  );
}

function requestHeaders(deviceSecret: string) {
  return {
    authorization: `Bearer v1.${deviceSecret}`,
    'content-type': 'application/json',
  };
}
