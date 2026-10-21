import { describe, expect, it } from 'vitest';
import { initializeGroup } from '../src/domain/groups';
import { createIdentifier } from '../src/domain/ids';
import { createInviteToken } from '../src/domain/invites';
import {
  MemoryClientStorage,
  parseClientDocument,
  emptyClientDocument,
} from '../src/client/storage';
import { upgradeClientStorage } from '../src/client/storageUpgrade';

function fixture() {
  const created = initializeGroup({
    group_id: createIdentifier(),
    name: 'Trip',
    creator_member_name: 'Santi',
    creator_identity_id: createIdentifier(),
    member_id: createIdentifier(),
    invite_id: createIdentifier(),
    invite_token: createInviteToken(),
    invite_token_hash: 'hash',
    created_at: '2026-10-14T10:00:00.000Z',
  }).view;

  const { token, ...metadata } = created.invite;

  const snapshot = {
    group: created.group,
    members: [created.member],
    expenses: [],
          settlements: [],
    access_grants: [created.access],
    invite: created.invite,
  };

  const previous = {
    ...emptyClientDocument(),
    schema_version: 1,
    groups: [
      {
        group_id: created.group.id,
        revision: 1,
        snapshot: { ...snapshot, invite: metadata },
        outbox: [],
        notices: [],
        last_synced_at: null,
      },
    ],
    own_invites: [
      {
        group_id: created.group.id,
        invite_id: created.invite.id,
        token,
        confirmed: true,
      },
    ],
  };

  return { previous, snapshot };
}

describe('client storage upgrades', () => {
  it('upgrades a saved creator link offline without making a request', async () => {
    const { previous, snapshot } = fixture();
    const storage = new MemoryClientStorage(JSON.stringify(previous));

    await upgradeClientStorage(storage, false, async () => {
      throw new Error('unexpected_request');
    });

    expect(
      parseClientDocument(await storage.read()).groups[0]?.snapshot.invite,
    ).toEqual(snapshot.invite);
  });

  it('keeps the original document intact if a needed server refresh fails', async () => {
    const { previous } = fixture();
    previous.own_invites = [];
    const serialized = JSON.stringify(previous);
    const storage = new MemoryClientStorage(serialized);

    await expect(
      upgradeClientStorage(storage, true, async () => {
        throw new Error('network_error');
      }),
    ).rejects.toThrow('network_error');
    expect(await storage.read()).toBe(serialized);
  });

  it('keeps edits queued while an upgrade request is in flight and retries pending invite replacements', async () => {
    const { previous, snapshot } = fixture();
    previous.own_invites[0]!.confirmed = false;
    const storage = new MemoryClientStorage(JSON.stringify(previous));

    const pending = {
      command: {
        command_id: createIdentifier(),
        type: 'group.rename',
        payload: { expected_name: 'Trip', name: 'New trip' },
      },
      queued_at: '2026-10-14T10:01:00.000Z',
    };

    await upgradeClientStorage(storage, true, async () => {
      await storage.update((serialized) => {
        const latest = JSON.parse(serialized!);
        latest.groups[0].outbox.push(pending);

        return { serialized: JSON.stringify(latest), result: undefined };
      });

      return { revision: 2, snapshot };
    });

    const upgraded = parseClientDocument(await storage.read());
    expect(upgraded.groups[0]?.outbox).toEqual([pending]);
    expect(upgraded.pending_invites).toMatchObject([
      { token: previous.own_invites[0]?.token },
    ]);
    expect(upgraded.groups[0]?.revision).toBe(2);

    await upgradeClientStorage(storage, true, async () => {
      throw new Error('unexpected_second_upgrade');
    });
  });
});
