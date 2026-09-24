import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { applyTestMigrations } from './harness';

const identitySchema = z.object({ identity: z.object({ id: identifierSchema }) });

const createdGroupSchema = z.object({
  group: z.object({ id: identifierSchema, revision: z.number() }),
  member: z.object({
    id: identifierSchema,
    display_name: z.string(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('member.create sync command', () => {
  it('applies the command, updates the projection, and records an audit id', async () => {
    const fixture = await createGroupFixture('p');
    const command = createMemberCommand('Alex');
    const response = await sync(fixture, 1, [command]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      revision: 2,
      outcomes: [
        {
          command_id: command.command_id,
          command_type: 'member.create',
          status: 'applied',
          reason: null,
          audit_id: expect.any(String),
          target: { kind: 'member', id: command.payload.member_id },
          server_state: {
            kind: 'member',
            member: {
              id: command.payload.member_id,
              display_name: 'Alex',
              status: 'active',
            },
          },
        },
      ],
      state: {
        kind: 'snapshot',
        snapshot: {
          members: [
            { display_name: 'Santi' },
            { id: command.payload.member_id, display_name: 'Alex' },
          ],
        },
      },
    });

    const unchanged = await sync(fixture, 2, []);

    expect(await unchanged.json()).toEqual({
      revision: 2,
      outcomes: [],
      state: { kind: 'unchanged' },
    });
  });

  it('returns the stored outcome without duplicating the audit entry on retry', async () => {
    const fixture = await createGroupFixture('q');
    const command = createMemberCommand('Alex');
    const first = await sync(fixture, 1, [command]);

    const firstBody = z
      .object({ outcomes: z.array(z.unknown()) })
      .parse(await first.json());

    const repeated = await sync(fixture, 2, [command]);
    const repeatedBody = await repeated.json();

    expect(repeatedBody).toMatchObject({
      revision: 2,
      outcomes: firstBody.outcomes,
      state: { kind: 'snapshot' },
    });
  });

  it('supersedes a command when its active member name is already used', async () => {
    const fixture = await createGroupFixture('r');
    const command = createMemberCommand('  ＳaｎTi  ');
    const response = await sync(fixture, 1, [command]);

    expect(await response.json()).toMatchObject({
      revision: 1,
      outcomes: [
        {
          command_id: command.command_id,
          status: 'superseded',
          reason: 'member_name_taken',
          audit_id: null,
          server_state: {
            kind: 'member',
            member: { id: fixture.created.member.id, display_name: 'Santi' },
          },
        },
      ],
      state: { kind: 'snapshot' },
    });
  });

  it('rejects reuse of a command id with different input', async () => {
    const fixture = await createGroupFixture('s');
    const command = createMemberCommand('Alex');

    await sync(fixture, 1, [command]);

    const response = await sync(fixture, 2, [
      { ...command, payload: { ...command.payload, display_name: 'Robin' } },
    ]);

    expect(await response.json()).toMatchObject({
      revision: 2,
      outcomes: [
        {
          command_id: command.command_id,
          status: 'rejected',
          reason: 'idempotency_conflict',
          audit_id: null,
          server_state: null,
        },
      ],
      state: { kind: 'snapshot' },
    });
  });

  it('processes a batch in order so later commands see earlier results', async () => {
    const fixture = await createGroupFixture('t');
    const first = createMemberCommand('Alex');
    const second = createMemberCommand('alex');
    const response = await sync(fixture, 1, [first, second]);

    expect(await response.json()).toMatchObject({
      revision: 2,
      outcomes: [
        { command_id: first.command_id, status: 'applied' },
        {
          command_id: second.command_id,
          status: 'superseded',
          reason: 'member_name_taken',
          server_state: {
            kind: 'member',
            member: { id: first.payload.member_id, display_name: 'Alex' },
          },
        },
      ],
      state: {
        kind: 'snapshot',
        snapshot: {
          members: [
            { display_name: 'Santi' },
            { id: first.payload.member_id, display_name: 'Alex' },
          ],
        },
      },
    });
  });
});

function createMemberCommand(displayName: string) {
  return {
    command_id: createIdentifier(),
    type: 'member.create',
    payload: {
      member_id: createIdentifier(),
      display_name: displayName,
    },
  };
}

async function createGroupFixture(seed: string) {
  const deviceSecret = seed.repeat(43);

  const identityResponse = await exports.default.fetch(
    'https://splitnext.test/identities/anonymous',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_secret: deviceSecret }),
    },
  );

  const identity = identitySchema.parse(await identityResponse.json());

  const groupResponse = await exports.default.fetch(
    'https://splitnext.test/groups',
    {
      method: 'POST',
      headers: requestHeaders(deviceSecret),
      body: JSON.stringify({
        group_id: createIdentifier(),
        name: 'Berlin flat',
        currency_code: 'EUR',
        creator_member_name: 'Santi',
      }),
    },
  );

  return {
    deviceSecret,
    identityId: identity.identity.id,
    created: createdGroupSchema.parse(await groupResponse.json()),
  };
}

function sync(
  fixture: Awaited<ReturnType<typeof createGroupFixture>>,
  knownRevision: number | null,
  commands: ReturnType<typeof createMemberCommand>[],
) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${fixture.created.group.id}/sync`,
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
