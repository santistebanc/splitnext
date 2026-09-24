import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  JsonClientStorage,
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
} from '../src/client';
import { applyTestMigrations } from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('stateful offline client SDK', () => {
  it('projects offline commands and reconciles them through the outbox', async () => {
    const client = createSyncClient('M');

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Berlin flat',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    client.setOnline(false);
    const offline = await client.addMember(created.group_id, 'Robin');

    expect(offline.revision).toBe(1);
    expect(offline.outbox).toHaveLength(1);
    expect(offline.confirmed_snapshot?.members).toHaveLength(1);
    expect(offline.projected_snapshot?.members).toMatchObject([
      { display_name: 'Santi' },
      { display_name: 'Robin' },
    ]);

    client.setOnline(true);
    const synchronized = await client.syncGroup(created.group_id);

    expect(synchronized.revision).toBe(2);
    expect(synchronized.outbox).toEqual([]);
    expect(synchronized.confirmed_snapshot?.members).toHaveLength(2);
  });

  it('turns a concurrent offline conflict into a local notice', async () => {
    const first = createSyncClient('N');
    const second = createSyncClient('O');

    await first.initializeIdentity();
    await second.initializeIdentity();

    const created = await first.createGroup({
      name: 'Berlin flat',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await second.joinGroup(created.group_id, {
      kind: 'new',
      display_name: 'Robin',
    });

    first.setOnline(false);
    second.setOnline(false);
    await first.renameGroup(created.group_id, 'Summer trip');
    await second.renameGroup(created.group_id, 'Winter trip');

    first.setOnline(true);
    await first.syncGroup(created.group_id);
    second.setOnline(true);
    const reconciled = await second.syncGroup(created.group_id);

    expect(reconciled.projected_snapshot?.group.name).toBe('Summer trip');
    expect(reconciled.outbox).toEqual([]);
    expect(reconciled.notices).toMatchObject([
      {
        command: {
          type: 'group.rename',
          payload: {
            expected_name: 'Berlin flat',
            name: 'Winter trip',
          },
        },
        outcome: {
          command_type: 'group.rename',
          status: 'superseded',
          reason: 'group_changed',
        },
      },
    ]);
  });

  it('owns preferred-member selection, removal, leaving, and rejoining', async () => {
    const client = createSyncClient('R');

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Berlin flat',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    const withRobin = await client.addMember(created.group_id, 'Robin');

    const robin = withRobin.projected_snapshot?.members.find(
      (member) => member.display_name === 'Robin',
    );

    const santi = withRobin.projected_snapshot?.members.find(
      (member) => member.display_name === 'Santi',
    );

    expect(robin).toBeDefined();
    expect(santi).toBeDefined();

    if (!robin || !santi) throw new Error('expected_members_missing');

    const preferred = await client.selectPreferredMember(
      created.group_id,
      robin.id,
    );

    expect(preferred.projected_snapshot?.access_grants[0]).toMatchObject({
      preferred_member_id: robin.id,
    });

    const removed = await client.removeMember(created.group_id, robin.id);

    expect(
      removed.projected_snapshot?.members.find(
        (member) => member.id === robin.id,
      ),
    ).toMatchObject({ status: 'archived' });
    expect(removed.projected_snapshot?.access_grants[0]).toMatchObject({
      preferred_member_id: null,
    });

    const left = await client.leaveGroup(created.group_id);

    expect(left.hidden).toBe(true);

    const rejoined = await client.joinGroup(created.group_id, {
      kind: 'existing',
      member_id: santi.id,
    });

    expect(rejoined.hidden).toBe(false);
    expect(rejoined.projected_snapshot?.access_grants[0]).toMatchObject({
      preferred_member_id: santi.id,
      hidden_at: null,
    });
  });

  it('retries the same command after the server response is lost', async () => {
    let loseNextSyncResponse = false;

    const api = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      fetch: async (input, init) => {
        const response = await exports.default.fetch(input, init);

        if (loseNextSyncResponse && new URL(input).pathname.endsWith('/sync')) {
          loseNextSyncResponse = false;
          throw new Error('simulated_response_loss');
        }

        return response;
      },
    });

    const client = new SplitnextSyncClient({
      api,
      device_secret: 'P'.repeat(43),
      storage: new MemoryClientStorage(),
    });

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Berlin flat',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    loseNextSyncResponse = true;

    await expect(client.addMember(created.group_id, 'Robin')).rejects.toThrow(
      'simulated_response_loss',
    );
    expect((await client.inspect(created.group_id)).outbox).toHaveLength(1);

    const retried = await client.syncGroup(created.group_id);

    expect(retried.outbox).toEqual([]);
    expect(retried.revision).toBe(2);
    expect(retried.projected_snapshot?.members).toHaveLength(2);
  });

  it('reuses the client-generated group id after a creation response is lost', async () => {
    let loseCreationResponse = false;

    const api = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      fetch: async (input, init) => {
        const response = await exports.default.fetch(input, init);

        if (
          loseCreationResponse &&
          new URL(input).pathname === '/groups'
        ) {
          loseCreationResponse = false;
          throw new Error('simulated_creation_response_loss');
        }

        return response;
      },
    });

    const client = new SplitnextSyncClient({
      api,
      device_secret: 'Q'.repeat(43),
      storage: new MemoryClientStorage(),
    });

    const input = {
      name: 'Retry group',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    };

    await client.initializeIdentity();
    loseCreationResponse = true;

    await expect(client.createGroup(input)).rejects.toThrow(
      'simulated_creation_response_loss',
    );

    const recovered = await client.createGroup(input);

    expect(recovered.revision).toBe(1);
    expect(recovered.projected_snapshot?.group.name).toBe('Retry group');
  });

  it('can swap the in-memory adapter for a JSON key-value adapter', async () => {
    const values = new Map<string, string>();

    const adapter = new JsonClientStorage(
      {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
      'device-one',
    );

    const document = {
      schema_version: 1 as const,
      session: null,
      groups: [],
      pending_group_creations: [],
      pending_joins: [],
    };

    await adapter.save(document);

    expect(await adapter.load()).toEqual(document);
  });
});

function createSyncClient(seed: string) {
  const api = new SplitnextClient({
    baseUrl: 'https://splitnext.test',
    fetch: (input, init) => exports.default.fetch(input, init),
  });

  return new SplitnextSyncClient({
    api,
    device_secret: seed.repeat(43),
    storage: new MemoryClientStorage(),
  });
}
