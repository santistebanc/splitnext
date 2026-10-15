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
  it('surfaces protocol failures on reconnect instead of swallowing them as network outages', async () => {
    let malformed = false;

    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => malformed && input.endsWith('/sync') ? Promise.resolve(new Response('<html>invalid</html>')) : exports.default.fetch(input, init),
      webSocket: () => ({ close: () => undefined }),
    });

    const key = await lab.addDevice();

    await lab.createGroup(key, { name: 'Failure categories', creator_member_name: 'Ana' });
    await lab.toggleDevice(key);
    await lab.addMember(key, 'Ben');
    malformed = true;
    await expect(lab.toggleDevice(key)).rejects.toMatchObject({ name: 'SplitnextProtocolError' });
    expect(deviceOf(lab, key).syncError).toMatchObject({ kind: 'protocol', message: 'invalid_json_response' });
    expect(deviceOf(lab, key).replica?.outbox).toHaveLength(1);
    malformed = false;
    await lab.syncDevice(key);
    expect(deviceOf(lab, key).syncError).toBeNull();
    lab.dispose();
  });

  it('shows separate live identities sharing one member and clears presence during outages', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    const first = await lab.addDevice();

    const group = await lab.createGroup(first, {
      name: 'Shared name presence',
      creator_member_name: 'Santi',
    });

    const memberId = group.projected_snapshot?.members[0]?.id;
    const link = lab.inviteLink(first);

    if (!memberId || !link) throw new Error('initial_group_missing');
    const second = await lab.addDevice();
    await lab.joinWithInvite(second, link, {
      kind: 'existing',
      member_id: memberId,
    });
    const firstId = deviceOf(lab, first).session?.identity.id;
    const secondId = deviceOf(lab, second).session?.identity.id;

    if (!firstId || !secondId) throw new Error('identity_missing');
    const both = [firstId, secondId].sort();
    await expect.poll(() => deviceOf(lab, first).presence).toEqual(both);
    await expect.poll(() => deviceOf(lab, second).presence).toEqual(both);
    const revision = deviceOf(lab, first).replica?.revision;
    await lab.toggleDevice(second);
    await expect.poll(() => deviceOf(lab, first).presence).toEqual([firstId]);
    expect(deviceOf(lab, second).presence).toBeNull();
    expect(deviceOf(lab, first).replica?.revision).toBe(revision);
    await lab.toggleDevice(second);
    await expect.poll(() => deviceOf(lab, first).presence).toEqual(both);
    lab.toggleRealtime(first);
    expect(deviceOf(lab, first).presence).toBeNull();
    lab.dispose();
  });
  it('creates an identity once a newly opened offline device reconnects', async () => {
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

  it('joins a group from another device with a separate identity', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    const first = await lab.addDevice();

    const group = await lab.createGroup(first, {
      name: 'Shared identity group',
      creator_member_name: 'Santi',
    });

    const firstSession = deviceOf(lab, first).session;
    const memberId = group.projected_snapshot?.members[0]?.id;

    if (!memberId) throw new Error('creator_member_missing');

    const inviteLink = lab.inviteLink(first);

    expect(group.projected_snapshot?.invite.token).toBeTruthy();
    expect(
      deviceOf(lab, first).requests.some(({ path }) =>
        path.endsWith('/invite'),
      ),
    ).toBe(false);

    if (!inviteLink) throw new Error('invite_missing');

    const second = await lab.addDevice();
    const secondSession = deviceOf(lab, second).session;

    expect(secondSession?.identity.id).not.toBe(firstSession?.identity.id);
    await lab.joinWithInvite(second, inviteLink, {
      kind: 'existing',
      member_id: memberId,
    });

    expect(lab.inviteLink(second)).toBe(inviteLink);

    await lab.regenerateInvite(second);
    await lab.syncDevice(first);
    expect(lab.inviteLink(first)).toBe(lab.inviteLink(second));
    expect(lab.inviteLink(first)).not.toBe(inviteLink);

    const third = await lab.addDevice();
    const currentLink = lab.inviteLink(first);

    if (!currentLink) throw new Error('Expected the shared link');

    const joinedByName = await lab.joinWithInvite(third, currentLink, {
      kind: 'new',
      display_name: ' santi ',
    });

    expect(joinedByName.projected_snapshot?.members).toHaveLength(1);
    expect(
      joinedByName.projected_snapshot?.access_grants.map(
        (grant) => grant.preferred_member_id,
      ),
    ).toEqual([memberId, memberId, memberId]);
    expect(lab.inviteLink(third)).toBe(currentLink);

    const joinedGroupResponse = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${group.group_id}`,
    );

    const joinedGroupState = z
      .object({
        snapshot: z.object({
          access_grants: z.array(z.object({ identity_id: z.string() })),
        }),
      })
      .parse(await joinedGroupResponse.json());

    expect(joinedGroupState.snapshot.access_grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identity_id: firstSession?.identity.id }),
        expect.objectContaining({ identity_id: secondSession?.identity.id }),
      ]),
    );
    expect(joinedGroupState.snapshot.access_grants).toHaveLength(3);
    expect(lab.state.server.identityDirectory?.identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: secondSession?.identity.id,
          devices: [expect.objectContaining({ id: secondSession?.device.id })],
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
      fetch: (input: string, init?: RequestInit) =>
        exports.default.fetch(input, init),
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
    expect(restoredLab.state.devices[deviceKey]?.replica?.outbox).toHaveLength(
      1,
    );
    expect(
      restoredLab.state.devices[deviceKey]?.replica?.projected_snapshot?.group
        .name,
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

  it('reconciles divergent devices with Live off, exposes notices, and retries or dismisses them', async () => {
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
      creator_member_name: 'Santi',
    });

    await invite(lab, one, two, 'Robin');
    lab.toggleRealtime(one);
    lab.toggleRealtime(two);
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
    const notice = deviceOf(lab, two).replica?.notices[0];

    if (!notice) throw new Error('missing conflict notice');
    await lab.retryNotice(two, notice.command.command_id);
    expect(lab.state.server.snapshot?.group.name).toBe('Device two name');
    expect(deviceOf(lab, two).replica?.notices).toHaveLength(0);
    await lab.renameGroup(two, 'Another retry', 'Original name');
    const dismissible = deviceOf(lab, two).replica?.notices[0];

    if (!dismissible) throw new Error('missing dismissible notice');
    await lab.dismissNotice(two, dismissible.command.command_id);
    expect(deviceOf(lab, two).replica?.notices).toHaveLength(0);
    expect(lab.state.server.snapshot?.group.name).toBe('Device two name');
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
      creator_member_name: 'Santi',
    });

    await invite(lab, creator, member, 'Robin');

    const memberSyncCount = () =>
      deviceOf(lab, member).requests.filter(
        (request) => request.path === `/groups/${group.group_id}/sync`,
      ).length;

    const beforeInviteChange = memberSyncCount();

    await lab.regenerateInvite(creator);

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
      creator_member_name: 'Santi',
    });

    await invite(lab, one, two, 'Robin');

    const unusedDeviceGroup = await lab.createGroup(three, {
      name: 'No current device',
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
      creator_member_name: 'Santi',
    });

    const trip = await lab.createGroup(two, {
      name: 'Trip',
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
        expect.objectContaining({
          group_id: flat.group_id,
          name: 'Shared flat',
        }),
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
  await lab.regenerateInvite(from);

  const link = lab.inviteLink(from);

  if (!link) throw new Error('invite_link_missing');

  return lab.joinWithInvite(to, link, {
    kind: 'new',
    display_name: displayName,
  });
}

function deviceOf(lab: SyncLab, key: string) {
  const device = lab.state.devices[key];

  if (!device) throw new Error('device_missing');

  return device;
}
