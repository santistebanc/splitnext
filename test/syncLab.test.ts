import { exports } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MemoryClientStorage } from '../src/client';
import { SyncLab } from '../src/lab/syncLab';
import {
  applyTestMigrations,
  settleWorkerSockets,
  workerWebSocket,
} from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

afterEach(() => settleWorkerSockets());

describe('synchronization lab', () => {
  it('creates a guest identity once a newly opened offline device reconnects', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    await lab.toggleServer();
    const device = await lab.addDevice();

    expect(deviceOf(lab, device).session).toBeNull();

    await lab.toggleServer();

    expect(deviceOf(lab, device).session).not.toBeNull();
    expect(deviceOf(lab, device).requests.map(({ path }) => path)).toContain(
      '/identities/anonymous',
    );

    await lab.reset();
    lab.dispose();
  });

  it('links the guest device and brings its groups to the account identity', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });


    const first = await lab.addDevice();

    const group = await lab.createGroup(first, {
      name: 'Shared identity group',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    const second = await lab.addDevice();

    const guestOnlyGroup = await lab.createGroup(second, {
      name: 'Guest-only group',
      currency_code: 'EUR',
      creator_member_name: 'Robin',
    });

    const guestIdentityId = deviceOf(lab, second).session?.identity.id;

    const firstSession = deviceOf(lab, first).session;
    const accountName = `same-person-${crypto.randomUUID()}@example.test`;
    const linkedSession = await lab.signInWithMockAccount(first, accountName);

    expect(linkedSession.identity.id).toBe(firstSession?.identity.id);

    await lab.signInWithMockAccount(second, accountName);
    const secondSession = deviceOf(lab, second).session;

    expect(secondSession?.identity.id).toBe(firstSession?.identity.id);
    expect(guestIdentityId).not.toBe(firstSession?.identity.id);
    expect(secondSession?.device.id).not.toBe(firstSession?.device.id);
    expect(deviceOf(lab, second).requests.map(({ path }) => path)).toContain(
      '/debug/auth/mock/sign-in',
    );
    expect(deviceOf(lab, second).requests.map(({ path }) => path)).toContain(
      '/identities/anonymous',
    );
    expect(lab.state.server.incoming.map(({ path }) => path)).toContain(
      '/debug/auth/mock/sign-in',
    );
    expect(deviceOf(lab, second).groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group_id: group.group_id, status: 'active' }),
        expect.objectContaining({ group_id: guestOnlyGroup.group_id, status: 'active' }),
      ]),
    );

    const mergedGroupResponse = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${guestOnlyGroup.group_id}`,
    );

    const mergedGroupState = z
      .object({
        snapshot: z.object({
          access_grants: z.array(z.object({ identity_id: z.string() })),
        }),
      })
      .parse(await mergedGroupResponse.json());

    expect(deviceOf(lab, second).session?.identity.id).toBe(firstSession?.identity.id);
    expect(mergedGroupState.snapshot.access_grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identity_id: firstSession?.identity.id }),
      ]),
    );
    expect(mergedGroupState.snapshot.access_grants).toHaveLength(1);

    await lab.selectGroup(second, guestOnlyGroup.group_id);
    await expect(lab.addMember(second, 'After merge')).resolves.toMatchObject({
      projected_snapshot: {
        members: expect.arrayContaining([
          expect.objectContaining({ display_name: 'After merge' }),
        ]),
      },
    });

    const restored = await lab.selectGroup(second, group.group_id);

    expect(restored.projected_snapshot?.group.name).toBe('Shared identity group');
    expect(lab.state.server.identityDirectory?.identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstSession?.identity.id,
          devices: expect.arrayContaining([
            expect.objectContaining({ id: firstSession?.device.id }),
            expect.objectContaining({ id: secondSession?.device.id }),
          ]),
        }),
      ]),
    );

    await lab.reset();
    lab.dispose();
  });

  it('merges duplicate group access and uses the latest preferred member', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    const first = await lab.addDevice();
    const second = await lab.addDevice();
    const accountName = `conflict-${crypto.randomUUID()}@example.test`;
    const accountSession = deviceOf(lab, first).session;

    const group = await lab.createGroup(first, {
      name: 'One participant after merge',
      currency_code: 'EUR',
      creator_member_name: 'Account member',
    });

    await lab.signInWithMockAccount(first, accountName);

    await lab.createInvite(first);
    const inviteLink = lab.inviteLink(first);

    if (!inviteLink) throw new Error('invite_missing');

    await lab.joinWithInvite(second, inviteLink, {
      kind: 'new',
      display_name: 'Guest member',
    });

    const guestMemberId = deviceOf(lab, second).replica?.projected_snapshot?.members
      .find(({ display_name }) => display_name === 'Guest member')?.id;

    const guestIdentityId = deviceOf(lab, second).session?.identity.id;

    const auditBefore = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${group.group_id}`,
    );

    const debugGroupSchema = z.object({
      revision: z.number(),
      snapshot: z.object({
        access_grants: z.array(
          z.object({ identity_id: z.string(), preferred_member_id: z.string().nullable() }),
        ),
      }),
    });

    const auditBeforeBody = debugGroupSchema.parse(await auditBefore.json());

    expect(accountSession?.identity.id).not.toBe(guestIdentityId);
    expect(guestMemberId).toBeTruthy();

    await lab.signInWithMockAccount(second, accountName);

    const serverGroup = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${group.group_id}`,
    );

    const serverState = debugGroupSchema.parse(await serverGroup.json());

    const accountAccess = serverState.snapshot.access_grants.filter(
      ({ identity_id }) => identity_id === accountSession?.identity.id,
    );

    expect(accountAccess).toHaveLength(1);
    expect(accountAccess[0]?.preferred_member_id).toBe(guestMemberId);
    expect(serverState.snapshot.access_grants).toHaveLength(1);
    expect(serverState.revision).toBeGreaterThan(auditBeforeBody.revision);

    const directory = await exports.default.fetch(
      'https://splitnext.test/debug/identity-directory',
    );

    const identities = z
      .object({
        identities: z.array(
          z.object({ id: z.string(), merged_into: z.string().optional() }),
        ),
      })
      .parse(await directory.json());

    expect(identities.identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: guestIdentityId,
          merged_into: accountSession?.identity.id,
        }),
      ]),
    );

    await lab.reset();
    lab.dispose();
  });

  it('restores device credentials and pending local work after a tester reload', async () => {
    const stores = new Map<string, MemoryClientStorage>();

    const options = {
      baseUrl: 'https://splitnext.test',
      fetch: (input: string, init?: RequestInit) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
      clearDeviceStorage: (key: string) => stores.delete(key),
      storageForDevice: (key: string) => {
        let storage = stores.get(key);

        if (!storage) {
          storage = new MemoryClientStorage();
          stores.set(key, storage);
        }

        return storage;
      },
    };

    const firstLab = new SyncLab(options);
    const deviceKey = await firstLab.addDevice();

    const group = await firstLab.createGroup(deviceKey, {
      name: 'Survives refresh',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await firstLab.toggleDevice(deviceKey);
    await firstLab.renameGroup(deviceKey, 'Pending while offline');

    const savedDevices = firstLab.persistedDevices();
    firstLab.dispose();

    const restoredLab = new SyncLab(options);
    await restoredLab.restoreDevices(savedDevices);

    expect(restoredLab.state.devices[deviceKey]?.session?.identity.id).toBe(
      firstLab.state.devices[deviceKey]?.session?.identity.id,
    );
    expect(restoredLab.state.devices[deviceKey]?.replica?.outbox).toHaveLength(1);
    expect(
      restoredLab.state.devices[deviceKey]?.replica?.projected_snapshot?.group.name,
    ).toBe('Pending while offline');
    expect(restoredLab.state.devices[deviceKey]?.selectedGroupId).toBe(
      group.group_id,
    );

    await restoredLab.reset();
    restoredLab.clearDevices();
    expect(stores.has(deviceKey)).toBe(false);
    restoredLab.dispose();
  });

  it('adds registered devices and removes them without touching the server', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    expect(lab.state.devices).toEqual({});

    const one = await lab.addDevice();
    const two = await lab.addDevice();
    const three = await lab.addDevice();

    await lab.createGroup(one, {
      name: 'Flat',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });
    await invite(lab, one, two, 'Robin');

    const subscribers = async () => {
      await lab.refreshServer();

      return lab.state.server.subscribers.length;
    };

    await expect.poll(subscribers).toBe(2);
    lab.removeDevice(two);

    expect(Object.values(lab.state.devices).map(({ label }) => label)).toEqual([
      'Device 1',
      'Device 3',
    ]);
    expect(deviceOf(lab, three).session).not.toBeNull();
    await expect.poll(subscribers).toBe(1);
    expect(lab.state.server.identityDirectory?.identities).toHaveLength(3);
    lab.dispose();
  });

  it('models divergent devices and reads authoritative state directly', async () => {
    let nextSecret = 0;

    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
      createDeviceSecret: () =>
        nextSecret++ === 0 ? 'l'.repeat(43) : 'm'.repeat(43),
      now: () => new Date('2026-09-24T10:00:00.000Z'),
    });

    const one = await lab.addDevice();
    const two = await lab.addDevice();

    await lab.createGroup(one, {
      name: 'Original name',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await invite(lab, one, two, 'Robin');
    await lab.toggleDevice(one);
    await lab.toggleDevice(two);

    await lab.renameGroup(one, 'Device one name');
    await lab.renameGroup(two, 'Device two name');
    await lab.refreshServer();

    expect(deviceOf(lab, one).replica?.projected_snapshot?.group.name).toBe(
      'Device one name',
    );
    expect(deviceOf(lab, two).replica?.projected_snapshot?.group.name).toBe(
      'Device two name',
    );
    expect(lab.state.server.snapshot?.group.name).toBe('Original name');

    await lab.toggleDevice(one);
    await lab.toggleDevice(two);

    expect(lab.state.server.snapshot?.group.name).toBe('Device one name');
    expect(deviceOf(lab, two).replica?.projected_snapshot?.group.name).toBe(
      'Device one name',
    );
    expect(deviceOf(lab, two).commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'superseded',
          detail: 'group_changed',
        }),
      ]),
    );
    expect(deviceOf(lab, one).requests.length).toBeGreaterThan(0);
    expect(lab.state.server.incoming.length).toBeGreaterThan(0);
    lab.dispose();
  });
  it('pushes changes to the other device through realtime announcements', async () => {
    const secrets = ['n'.repeat(43), 'o'.repeat(43)];

    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
      createDeviceSecret: () => secrets.shift() ?? 'p'.repeat(43),
    });

    const one = await lab.addDevice();
    const two = await lab.addDevice();

    await lab.createGroup(one, {
      name: 'Original name',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await invite(lab, one, two, 'Robin');
    await expect.poll(() => deviceOf(lab, two).realtimeStatus).toBe('open');
    await lab.refreshServer();

    expect(lab.state.server.subscribers).toHaveLength(2);

    await lab.renameGroup(one, 'Pushed name');

    await expect
      .poll(() => deviceOf(lab, two).replica?.projected_snapshot?.group.name)
      .toBe('Pushed name');
    expect(deviceOf(lab, two).realtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: 'Revision 4 announced' }),
      ]),
    );

    lab.toggleRealtime(two);
    await lab.renameGroup(one, 'Unannounced name');

    expect(deviceOf(lab, two).realtimeStatus).toBe('off');
    expect(deviceOf(lab, two).replica?.projected_snapshot?.group.name).toBe(
      'Pushed name',
    );

    lab.toggleRealtime(two);

    await expect
      .poll(() => deviceOf(lab, two).replica?.projected_snapshot?.group.name)
      .toBe('Unannounced name');
    lab.dispose();
  });
  it('syncs invite changes to members but not to an unjoined identity', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    const creator = await lab.addDevice();
    const member = await lab.addDevice();
    const outsider = await lab.addDevice();

    const group = await lab.createGroup(creator, {
      name: 'Private group',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await invite(lab, creator, member, 'Robin');

    const memberSyncCount = () =>
      deviceOf(lab, member).requests.filter(
      (request) => request.path === `/groups/${group.group_id}/sync`,
      ).length;

    const beforeInviteChange = memberSyncCount();

    await lab.createInvite(creator);

    await expect.poll(memberSyncCount).toBeGreaterThan(beforeInviteChange);
    expect(
      deviceOf(lab, outsider).requests.some((request) =>
        request.path.includes(group.group_id),
      ),
    ).toBe(false);
    expect(deviceOf(lab, outsider).groups).toEqual([]);
    lab.dispose();
  });

  it('erases identities and known groups, then starts over', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    const one = await lab.addDevice();
    const two = await lab.addDevice();
    const three = await lab.addDevice();

    const created = await lab.createGroup(one, {
      name: 'Doomed',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await invite(lab, one, two, 'Robin');

    const unusedDeviceGroup = await lab.createGroup(three, {
      name: 'No current device',
      currency_code: 'EUR',
      creator_member_name: 'Ari',
    });

    lab.removeDevice(three);
    await lab.refreshServer();

    expect(lab.knownGroups()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group_id: created.group_id, name: 'Doomed' }),
        expect.objectContaining({
          group_id: unusedDeviceGroup.group_id,
          name: 'No current device',
        }),
      ]),
    );

    const cleared = await lab.reset();

    expect(cleared).toContain(created.group_id);
    expect(cleared).toContain(unusedDeviceGroup.group_id);
    expect(lab.state.inspectedGroupId).toBeNull();
    expect(Object.keys(lab.state.devices)).toHaveLength(2);
    expect(deviceOf(lab, one).session).not.toBeNull();
    expect(deviceOf(lab, one).replica?.projected_snapshot?.group.name).toBe(
      'Doomed',
    );
    expect(lab.state.server.groups).toEqual([]);
    expect(lab.state.server.identityDirectory).toEqual({ identities: [] });

    const inspection = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${created.group_id}`,
    );

    expect(inspection.status).toBe(404);

    const forgottenDeviceGroup = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${unusedDeviceGroup.group_id}`,
    );

    expect(forgottenDeviceGroup.status).toBe(404);

    lab.clearDevices();
    expect(lab.state.devices).toEqual({});

    await lab.addDevice();
    await lab.addDevice();

    expect(lab.state.server.identityDirectory?.identities).toHaveLength(2);
    lab.dispose();
  });

  it('keeps devices working through a server outage and delivers afterward', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    const one = await lab.addDevice();
    const two = await lab.addDevice();

    await lab.createGroup(one, {
      name: 'Before outage',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await invite(lab, one, two, 'Robin');
    await lab.toggleServer();

    const queued = await lab.renameGroup(one, 'During outage');

    expect(queued.outbox).toHaveLength(1);
    expect(queued.projected_snapshot?.group.name).toBe('During outage');
    expect(lab.state.server.snapshot?.group.name).toBe('Before outage');

    await lab.toggleServer();

    expect(lab.state.server.snapshot?.group.name).toBe('During outage');
    expect(deviceOf(lab, one).replica?.outbox).toEqual([]);
    await expect
      .poll(() => deviceOf(lab, two).replica?.projected_snapshot?.group.name)
      .toBe('During outage');
    lab.dispose();
  });

  it('lets each device create, join, switch between, and leave groups', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    const one = await lab.addDevice();
    const two = await lab.addDevice();

    const flat = await lab.createGroup(one, {
      name: 'Flat',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    const trip = await lab.createGroup(two, {
      name: 'Trip',
      currency_code: 'USD',
      creator_member_name: 'Robin',
    });

    await invite(lab, one, two, 'Robin');
    await lab.selectGroup(two, trip.group_id);
    await invite(lab, two, one, 'Santi');

    expect(deviceOf(lab, one).groups.map(({ name }) => name)).toEqual([
      'Flat',
      'Trip',
    ]);
    expect(deviceOf(lab, two).selectedGroupId).toBe(trip.group_id);
    expect(deviceOf(lab, one).selectedGroupId).toBe(trip.group_id);

    // Device 1 is looking at Trip; a rename of Flat still reaches its list.
    await lab.selectGroup(two, flat.group_id);
    await lab.renameGroup(two, 'Shared flat');

    await expect
      .poll(() => deviceOf(lab, one).groups.map(({ name }) => name))
      .toEqual(['Shared flat', 'Trip']);

    await lab.selectGroup(one, flat.group_id);
    await lab.leaveGroup(one);

    expect(deviceOf(lab, one).groups).toMatchObject([
      { group_id: trip.group_id, status: 'active' },
      { group_id: flat.group_id, status: 'left' },
    ]);

    // The server panel lists all groups represented in the server index.
    expect(lab.knownGroups()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group_id: flat.group_id, name: 'Shared flat' }),
        expect.objectContaining({ group_id: trip.group_id, name: 'Trip' }),
      ]),
    );

    await lab.inspectGroup(trip.group_id);

    expect(lab.state.server.snapshot?.group.name).toBe('Trip');
    lab.dispose();
  });

  it('rejoins a left group as a member chosen from its current list', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    const one = await lab.addDevice();
    const two = await lab.addDevice();

    const group = await lab.createGroup(one, {
      name: 'Flat',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await invite(lab, one, two, 'Robin');
    await lab.leaveGroup(two);
    await lab.addMember(one, 'Taylor');

    // Opening the left group fetches members added since leaving.
    const reopened = await lab.selectGroup(two, group.group_id);

    const taylor = reopened.projected_snapshot?.members.find(
      (member) => member.display_name === 'Taylor',
    );

    if (!taylor) throw new Error('member_missing');

    const rejoined = await lab.rejoinGroup(two, {
      kind: 'existing',
      member_id: taylor.id,
    });

    expect(rejoined.hidden).toBe(false);
    expect(
      rejoined.projected_snapshot?.access_grants.find(
        (grant) => grant.identity_id === rejoined.session?.identity.id,
      )?.preferred_member_id,
    ).toBe(taylor.id);
    expect(deviceOf(lab, two).groups).toMatchObject([
      { group_id: group.group_id, status: 'active' },
    ]);
    lab.dispose();
  });
});

/** Creates a link on the selected group of one device and joins from another. */
async function invite(
  lab: SyncLab,
  from: string,
  to: string,
  displayName: string,
) {
  await lab.createInvite(from);

  const link = lab.inviteLink(from);

  if (!link) throw new Error('invite_link_missing');

  return lab.joinWithInvite(to, link, { kind: 'new', display_name: displayName });
}

function deviceOf(lab: SyncLab, key: string) {
  const device = lab.state.devices[key];

  if (!device) throw new Error('device_missing');

  return device;
}
