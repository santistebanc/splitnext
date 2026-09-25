import { exports } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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
    expect(lab.state.devices).toEqual({});
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
