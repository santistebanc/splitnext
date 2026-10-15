import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
} from '../src/client';
import {
  applyTestMigrations,
  joinThroughInvite,
  randomDeviceSecret,
} from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('groups an identity can access', () => {
  it('lists created and joined groups and marks the ones left', async () => {
    const alice = await createDevice();
    const bob = await createDevice();
    const flat = await createGroup(alice.client, 'Flat');
    const trip = await createGroup(bob.client, 'Trip');

    await joinThroughInvite(bob.client, alice.client, trip.group_id, {
      kind: 'new',
      display_name: 'Alice',
    });
    await alice.client.submit(flat.group_id, { type: 'group.leave', payload: {} });

    expect(await alice.client.listGroups()).toMatchObject([
      { group_id: trip.group_id, name: 'Trip', status: 'active' },
      { group_id: flat.group_id, name: 'Flat', status: 'left' },
    ]);
    expect(await bob.client.listGroups()).toMatchObject([
      { group_id: trip.group_id, status: 'active' },
    ]);
  });

  it('shows another participant’s rename once the identity synchronizes', async () => {
    const alice = await createDevice();
    const bob = await createDevice();
    const group = await createGroup(alice.client, 'Before');

    await joinThroughInvite(alice.client, bob.client, group.group_id, {
      kind: 'new',
      display_name: 'Bob',
    });
    await alice.client.submit(group.group_id, { type: 'group.rename', payload: { name: 'After' } });

    const beforeSync = await listFromServer(bob.secret);

    await bob.client.syncGroup(group.group_id);

    expect(beforeSync).toMatchObject([{ name: 'Before' }]);
    expect(await listFromServer(bob.secret)).toMatchObject([{ name: 'After' }]);
  });

  it('lets a device that lost its storage find and reopen its groups', async () => {
    const original = await createDevice();
    const group = await createGroup(original.client, 'Flat');
    const restored = await createDevice(original.secret);

    expect(await restored.client.listGroups()).toMatchObject([
      {
        group_id: group.group_id,
        stored_locally: false,
        member_count: null,
        you_name: null,
      },
    ]);

    const reopened = await restored.client.syncGroup(group.group_id);

    expect(reopened.projected_snapshot?.group.name).toBe('Flat');
    expect(await restored.client.listGroups()).toMatchObject([
      {
        group_id: group.group_id,
        stored_locally: true,
        member_count: 1,
        you_name: reopened.projected_snapshot?.members[0]?.display_name,
      },
    ]);
  });

  it('keeps listing known groups while offline', async () => {
    const device = await createDevice();
    const group = await createGroup(device.client, 'Flat');

    await device.client.listGroups();
    device.client.setOnline(false);

    expect(await device.client.listGroups()).toMatchObject([
      { group_id: group.group_id, status: 'active' },
    ]);
  });

  it('requires a device credential', async () => {
    const response = await exports.default.fetch(
      'https://splitnext.test/identity/groups',
    );

    expect(response.status).toBe(401);
  });
});

function createApi() {
  return new SplitnextClient({
    baseUrl: 'https://splitnext.test',
    fetch: (input, init) => exports.default.fetch(input, init),
  });
}

async function createDevice(secret = randomDeviceSecret()) {
  const client = new SplitnextSyncClient({
    api: createApi(),
    device_secret: secret,
    storage: new MemoryClientStorage(),
  });

  await client.initializeIdentity();

  return { secret, client };
}

function createGroup(client: SplitnextSyncClient, name: string) {
  return client.createGroup({
    name,
    creator_member_name: 'Santi',
  });
}

async function listFromServer(secret: string) {
  return (await createApi().forDevice(secret).listGroups()).groups;
}
