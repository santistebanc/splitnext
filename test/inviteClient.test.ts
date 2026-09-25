import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
} from '../src/client';
import { applyTestMigrations, randomDeviceSecret } from './harness';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

beforeAll(async () => {
  await applyTestMigrations();
});

describe('invite links in the client SDK', () => {
  it('keeps the plaintext link only on the device that created it', async () => {
    const creator = await createClient();
    const joiner = await createClient();
    const created = await createGroup(creator);
    const invited = await creator.createInvite(created.group_id, 24);
    const token = invited.own_invite?.token;

    if (!token) throw new Error('invite_token_missing');

    const preview = await joiner.previewInvite(created.group_id, token);

    const joined = await joiner.joinGroup(
      created.group_id,
      { kind: 'existing', member_id: preview.members[0]?.id ?? '' },
      token,
    );

    expect(invited.projected_snapshot?.invite?.id).toBe(
      invited.own_invite?.invite_id,
    );
    expect(preview.group.name).toBe('Berlin flat');
    expect(joined.projected_snapshot?.invite?.id).toBe(
      invited.own_invite?.invite_id,
    );
    expect(joined.own_invite).toBeNull();

    const revoked = await creator.revokeInvite(created.group_id);

    expect(revoked.projected_snapshot?.invite).toBeNull();
    expect(revoked.own_invite).toBeNull();
  });

  it('retries a lost creation with the same token instead of rotating', async () => {
    let loseNextInviteResponse = true;

    const creator = await createClient(async (input, init) => {
      const response = await exports.default.fetch(input, init);

      if (loseNextInviteResponse && new URL(input).pathname.endsWith('/invites')) {
        loseNextInviteResponse = false;
        throw new TypeError('simulated_response_loss');
      }

      return response;
    });

    const created = await createGroup(creator);

    await expect(creator.createInvite(created.group_id)).rejects.toThrow(
      'simulated_response_loss',
    );

    const retried = await creator.createInvite(created.group_id);

    // The lost attempt already created the link at revision 2; a rotation
    // would have produced revision 3.
    expect(retried.revision).toBe(2);
    expect(retried.own_invite?.invite_id).toBe(
      retried.projected_snapshot?.invite?.id,
    );
  });
});

async function createClient(fetch?: Fetch) {
  const api = new SplitnextClient({
    baseUrl: 'https://splitnext.test',
    fetch: fetch ?? ((input, init) => exports.default.fetch(input, init)),
  });

  const client = new SplitnextSyncClient({
    api,
    device_secret: randomDeviceSecret(),
    storage: new MemoryClientStorage(),
  });

  await client.initializeIdentity();

  return client;
}

function createGroup(client: SplitnextSyncClient) {
  return client.createGroup({
    name: 'Berlin flat',
    currency_code: 'EUR',
    creator_member_name: 'Santi',
  });
}
