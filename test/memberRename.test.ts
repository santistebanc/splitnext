import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { createInviteToken } from '../src/domain/invites';
import { applyTestMigrations } from './harness';

const identitySchema = z.object({
  identity: z.object({ id: identifierSchema }),
});

const createdGroupSchema = z.object({
  group: z.object({ id: identifierSchema, revision: z.number() }),
  member: z.object({ id: identifierSchema, display_name: z.string() }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('member.rename sync command', () => {
  it('renames the member and returns the replacement snapshot', async () => {
    const fixture = await createGroupFixture('u');
    const command = renameCommand(fixture, 'Santi', 'Thomas');
    const response = await sync(fixture, 1, [command]);

    expect(await response.json()).toMatchObject({
      revision: 2,
      outcomes: [
        {
          command_id: command.command_id,
          command_type: 'member.rename',
          status: 'applied',
          reason: null,
          audit_id: expect.any(String),
          server_state: {
            kind: 'member',
            member: { id: fixture.created.member.id, display_name: 'Thomas' },
          },
        },
      ],
      state: {
        kind: 'snapshot',
        snapshot: {
          members: [{ id: fixture.created.member.id, display_name: 'Thomas' }],
        },
      },
    });
  });

  it('returns no_effect when another command already achieved the intent', async () => {
    const fixture = await createGroupFixture('v');

    await sync(fixture, 1, [renameCommand(fixture, 'Santi', 'Thomas')]);

    const command = renameCommand(fixture, 'Santi', 'Thomas');
    const response = await sync(fixture, 1, [command]);

    expect(await response.json()).toMatchObject({
      revision: 2,
      outcomes: [
        {
          command_id: command.command_id,
          status: 'no_effect',
          reason: null,
          audit_id: null,
          server_state: { member: { display_name: 'Thomas' } },
        },
      ],
    });
  });

  it('supersedes a stale rename instead of overwriting a newer name', async () => {
    const fixture = await createGroupFixture('w');

    await sync(fixture, 1, [renameCommand(fixture, 'Santi', 'Thomas')]);

    const staleCommand = renameCommand(fixture, 'Santi', 'Robin');
    const response = await sync(fixture, 1, [staleCommand]);

    expect(await response.json()).toMatchObject({
      revision: 2,
      outcomes: [
        {
          command_id: staleCommand.command_id,
          status: 'superseded',
          reason: 'member_changed',
          audit_id: null,
          server_state: { member: { display_name: 'Thomas' } },
        },
      ],
      state: {
        snapshot: { members: [{ display_name: 'Thomas' }] },
      },
    });
  });

  it('supersedes a rename when another active member uses the name', async () => {
    const fixture = await createGroupFixture('x');
    const createAlex = createMemberCommand('Alex');

    await sync(fixture, 1, [createAlex]);

    const command = renameCommand(fixture, 'Santi', 'alex');
    const response = await sync(fixture, 2, [command]);

    expect(await response.json()).toMatchObject({
      revision: 2,
      outcomes: [
        {
          command_id: command.command_id,
          status: 'superseded',
          reason: 'member_name_taken',
          server_state: { member: { display_name: 'Santi' } },
        },
      ],
    });
  });

  it('returns the original outcome when the same rename is retried', async () => {
    const fixture = await createGroupFixture('y');
    const command = renameCommand(fixture, 'Santi', 'Thomas');
    const first = await sync(fixture, 1, [command]);

    const firstBody = z
      .object({ outcomes: z.array(z.unknown()) })
      .parse(await first.json());

    const repeated = await sync(fixture, 2, [command]);

    expect(await repeated.json()).toMatchObject({
      revision: 2,
      outcomes: firstBody.outcomes,
    });
  });

  it('processes dependent renames in batch order', async () => {
    const fixture = await createGroupFixture('z');
    const first = renameCommand(fixture, 'Santi', 'Thomas');
    const second = renameCommand(fixture, 'Thomas', 'Robin');
    const response = await sync(fixture, 1, [first, second]);

    expect(await response.json()).toMatchObject({
      revision: 3,
      outcomes: [
        { command_id: first.command_id, status: 'applied' },
        { command_id: second.command_id, status: 'applied' },
      ],
      state: {
        snapshot: { members: [{ display_name: 'Robin' }] },
      },
    });
  });

  it('rejects a rename when its target does not exist', async () => {
    const fixture = await createGroupFixture('0');

    const command = {
      ...renameCommand(fixture, 'Missing', 'Robin'),
      payload: {
        member_id: createIdentifier(),
        expected_display_name: 'Missing',
        display_name: 'Robin',
      },
    };

    const response = await sync(fixture, 1, [command]);

    expect(await response.json()).toMatchObject({
      revision: 1,
      outcomes: [
        {
          command_id: command.command_id,
          status: 'rejected',
          reason: 'member_not_found',
          audit_id: null,
          server_state: null,
        },
      ],
    });
  });
});

function renameCommand(
  fixture: Awaited<ReturnType<typeof createGroupFixture>>,
  expectedDisplayName: string,
  displayName: string,
) {
  return {
    command_id: createIdentifier(),
    type: 'member.rename',
    payload: {
      member_id: fixture.created.member.id,
      expected_display_name: expectedDisplayName,
      display_name: displayName,
    },
  };
}

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

  identitySchema.parse(await identityResponse.json());

  const groupResponse = await exports.default.fetch(
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

  return {
    deviceSecret,
    created: createdGroupSchema.parse(await groupResponse.json()),
  };
}

function sync(
  fixture: Awaited<ReturnType<typeof createGroupFixture>>,
  knownRevision: number | null,
  commands: unknown[],
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
