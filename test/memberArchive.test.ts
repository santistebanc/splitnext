import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { createInviteToken } from '../src/domain/invites';
import { applyTestMigrations } from './harness';

const createdGroupSchema = z.object({
  group: z.object({ id: identifierSchema, revision: z.number() }),
  member: z.object({ id: identifierSchema, display_name: z.string() }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('member.archive sync command', () => {
  it('archives the member and clears every preference pointing to it', async () => {
    const fixture = await createGroupFixture('i');
    const command = archiveCommand(fixture.created.member.id);
    const response = await sync(fixture, 1, [command]);

    expect(await response.json()).toMatchObject({
      revision: 2,
      outcomes: [
        {
          command_id: command.command_id,
          command_type: 'member.archive',
          status: 'applied',
          reason: null,
          audit_id: expect.any(String),
          server_state: {
            kind: 'member',
            member: {
              id: fixture.created.member.id,
              display_name: 'Santi',
              status: 'archived',
            },
          },
        },
      ],
      state: {
        kind: 'snapshot',
        snapshot: {
          members: [{ id: fixture.created.member.id, status: 'archived' }],
          access_grants: [{ preferred_member_id: null }],
        },
      },
    });
  });

  it('returns no_effect when the member is already archived', async () => {
    const fixture = await createGroupFixture('j');

    await sync(fixture, 1, [archiveCommand(fixture.created.member.id)]);

    const repeatedIntent = archiveCommand(fixture.created.member.id);
    const response = await sync(fixture, 1, [repeatedIntent]);

    expect(await response.json()).toMatchObject({
      revision: 2,
      outcomes: [
        {
          command_id: repeatedIntent.command_id,
          status: 'no_effect',
          reason: null,
          audit_id: null,
          server_state: { member: { status: 'archived' } },
        },
      ],
    });
  });

  it('makes an archived name available to a later command in the batch', async () => {
    const fixture = await createGroupFixture('k');
    const archive = archiveCommand(fixture.created.member.id);
    const replacementId = createIdentifier();

    const create = {
      command_id: createIdentifier(),
      type: 'member.create',
      payload: { member_id: replacementId, display_name: 'sAnTi' },
    };

    const response = await sync(fixture, 1, [archive, create]);

    expect(await response.json()).toMatchObject({
      revision: 3,
      outcomes: [
        { command_id: archive.command_id, status: 'applied' },
        { command_id: create.command_id, status: 'applied' },
      ],
      state: {
        snapshot: {
          members: [
            { id: fixture.created.member.id, status: 'archived' },
            { id: replacementId, display_name: 'sAnTi', status: 'active' },
          ],
        },
      },
    });
  });

  it('rejects an archive when the member does not exist', async () => {
    const fixture = await createGroupFixture('l');
    const command = archiveCommand(createIdentifier());
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

  it('returns the original applied outcome when the command is retried', async () => {
    const fixture = await createGroupFixture('m');
    const command = archiveCommand(fixture.created.member.id);
    const first = await sync(fixture, 1, [command]);
    const firstBody = await first.json();
    const repeated = await sync(fixture, 2, [command]);

    expect(await repeated.json()).toMatchObject({
      revision: 2,
      outcomes: z.object({ outcomes: z.array(z.unknown()) }).parse(firstBody)
        .outcomes,
    });
  });
});

function archiveCommand(memberId: string) {
  return {
    command_id: createIdentifier(),
    type: 'member.archive',
    payload: { member_id: memberId },
  };
}

async function createGroupFixture(seed: string) {
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

  return {
    deviceSecret,
    created: createdGroupSchema.parse(await response.json()),
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
