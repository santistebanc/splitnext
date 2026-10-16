import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
  type ClientTransportEvent,
} from '../src/client';
import { applyTestMigrations, createDeviceSecret } from './harness';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

beforeAll(async () => {
  await applyTestMigrations();
});

describe('invite links in the client SDK', () => {
  it('shares the same current link with joined participants and retains it offline', async () => {
    const diagnostics: ClientTransportEvent[] = [];
    const creator = await createClient(undefined, diagnostics);
    const joiner = await createClient(undefined, diagnostics);
    const created = await createGroup(creator);
    const invited = await creator.regenerateInvite(created.group_id);
    const token = invited.projected_snapshot?.invite.token;

    if (!token) throw new Error('invite_token_missing');

    const preview = await joiner.previewInvite(created.group_id, token);

    const joined = await joiner.joinGroup(
      created.group_id,
      { kind: 'existing', member_id: preview.members[0]?.id ?? '' },
      token,
    );

    expect(invited.projected_snapshot?.invite?.id).toBe(
      invited.projected_snapshot?.invite.id,
    );
    expect(preview.group.name).toBe('Berlin flat');
    expect(joined.projected_snapshot?.invite?.id).toBe(
      invited.projected_snapshot?.invite.id,
    );
    expect(joined.projected_snapshot?.invite).toEqual(
      invited.projected_snapshot?.invite,
    );

    joiner.setOnline(false);
    const offline = await joiner.inspect(created.group_id);

    expect(offline.projected_snapshot?.invite.token).toBe(token);
    joiner.setOnline(true);

    const replacement = await creator.regenerateInvite(created.group_id);

    expect(replacement.projected_snapshot?.invite.id).not.toBe(
      invited.projected_snapshot?.invite.id,
    );
    expect(replacement.projected_snapshot?.invite).not.toBeNull();
    await expect(joiner.previewInvite(created.group_id, token)).rejects.toThrow(
      'invite_replaced',
    );

    const synchronized = await joiner.syncGroup(created.group_id);

    expect(synchronized.projected_snapshot?.invite.id).toBe(
      replacement.projected_snapshot?.invite.id,
    );
    expect(synchronized.projected_snapshot?.invite).toEqual(
      replacement.projected_snapshot?.invite,
    );
    expect(JSON.stringify(diagnostics)).not.toContain(token);
    expect(JSON.stringify(diagnostics)).not.toContain(
      replacement.projected_snapshot?.invite.token,
    );
  });

  it('retries a lost creation with the same token instead of rotating', async () => {
    let loseNextInviteResponse = true;

    const creator = await createClient(async (input, init) => {
      const response = await exports.default.fetch(input, init);

      if (
        loseNextInviteResponse &&
        new URL(input).pathname.endsWith('/invite')
      ) {
        loseNextInviteResponse = false;
        throw new TypeError('simulated_response_loss');
      }

      return response;
    });

    const created = await createGroup(creator);

    await expect(creator.regenerateInvite(created.group_id)).rejects.toThrow(
      'simulated_response_loss',
    );

    const retried = await creator.regenerateInvite(created.group_id);

    // The lost attempt already created the link at revision 2; a rotation
    // would have produced revision 3.
    expect(retried.revision).toBe(2);
    expect(retried.projected_snapshot?.invite.id).toBe(
      retried.projected_snapshot?.invite?.id,
    );
  });
  it('keeps a newer link when a lost replacement is retried after another participant changes it', async () => {
    let loseNextResponse = true;

    const creator = await createClient(async (input, init) => {
      const response = await exports.default.fetch(input, init);

      if (
        loseNextResponse &&
        init?.method === 'PUT' &&
        new URL(input).pathname.endsWith('/invite')
      ) {
        loseNextResponse = false;
        throw new TypeError('simulated_response_loss');
      }

      return response;
    });

    const visitor = await createClient();
    const created = await createGroup(creator);
    const initial = created.projected_snapshot?.invite;
    const member = created.projected_snapshot?.members[0];

    if (!initial || !member)
      throw new Error('Expected the initial link and member');

    await visitor.joinGroup(
      created.group_id,
      { kind: 'existing', member_id: member.id },
      initial.token,
    );
    await expect(creator.regenerateInvite(created.group_id)).rejects.toThrow(
      'simulated_response_loss',
    );

    const replacement = await visitor.regenerateInvite(created.group_id);
    const retried = await creator.regenerateInvite(created.group_id);

    expect(retried.revision).toBe(replacement.revision);
    expect(retried.projected_snapshot?.invite.id).toBe(
      replacement.projected_snapshot?.invite.id,
    );
    expect(retried.projected_snapshot?.invite).toEqual(
      replacement.projected_snapshot?.invite,
    );

    if (!replacement.projected_snapshot?.invite)
      throw new Error('Expected the replacement link');

    expect(
      await creator.previewInvite(
        created.group_id,
        replacement.projected_snapshot.invite.token,
      ),
    ).toMatchObject({
      group: { name: 'Berlin flat' },
    });
  });
});

async function createClient(
  fetch?: Fetch,
  diagnostics?: ClientTransportEvent[],
) {
  const api = new SplitnextClient({
    baseUrl: 'https://splitnext.test',
    fetch: fetch ?? ((input, init) => exports.default.fetch(input, init)),
    observer: (event) => diagnostics?.push(event),
  });

  const client = new SplitnextSyncClient({
    api,
    device_secret: createDeviceSecret(),
    storage: new MemoryClientStorage(),
  });

  await client.initializeIdentity();

  return client;
}

function createGroup(client: SplitnextSyncClient) {
  return client.createGroup({
    name: 'Berlin flat',
    creator_member_name: 'Santi',
  });
}
