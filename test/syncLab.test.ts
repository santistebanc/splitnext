import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { SyncLab } from '../src/lab/syncLab';
import { applyTestMigrations, workerWebSocket } from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('synchronization lab', () => {
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

    await lab.initializeDevices();

    const created = await lab.createGroup({
      name: 'Original name',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await lab.joinGroup(created.group_id, 'Robin');
    await lab.toggleDevice('one');
    await lab.toggleDevice('two');

    await lab.renameGroup('one', 'Device one name');
    await lab.renameGroup('two', 'Device two name');
    await lab.refreshServer();

    expect(lab.state.devices.one.replica?.projected_snapshot?.group.name).toBe(
      'Device one name',
    );
    expect(lab.state.devices.two.replica?.projected_snapshot?.group.name).toBe(
      'Device two name',
    );
    expect(lab.state.server.snapshot?.group.name).toBe('Original name');

    await lab.toggleDevice('one');
    await lab.toggleDevice('two');

    expect(lab.state.server.snapshot?.group.name).toBe('Device one name');
    expect(lab.state.devices.two.replica?.projected_snapshot?.group.name).toBe(
      'Device one name',
    );
    expect(lab.state.devices.two.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'superseded',
          detail: 'group_changed',
        }),
      ]),
    );
    expect(lab.state.devices.one.requests.length).toBeGreaterThan(0);
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

    await lab.initializeDevices();

    const created = await lab.createGroup({
      name: 'Original name',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await lab.joinGroup(created.group_id, 'Robin');
    await expect.poll(() => lab.state.devices.two.realtimeStatus).toBe('open');
    await lab.refreshServer();

    expect(lab.state.server.subscribers).toHaveLength(2);

    await lab.renameGroup('one', 'Pushed name');

    await expect
      .poll(() => lab.state.devices.two.replica?.projected_snapshot?.group.name)
      .toBe('Pushed name');
    expect(lab.state.devices.two.realtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: 'Revision 3 announced' }),
      ]),
    );

    lab.toggleRealtime('two');
    await lab.renameGroup('one', 'Unannounced name');

    expect(lab.state.devices.two.realtimeStatus).toBe('off');
    expect(lab.state.devices.two.replica?.projected_snapshot?.group.name).toBe(
      'Pushed name',
    );

    lab.toggleRealtime('two');

    await expect
      .poll(() => lab.state.devices.two.replica?.projected_snapshot?.group.name)
      .toBe('Unannounced name');
    lab.dispose();
  });
  it('erases identities and known groups, then starts over', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    await lab.initializeDevices();

    const created = await lab.createGroup({
      name: 'Doomed',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await lab.joinGroup(created.group_id, 'Robin');

    const cleared = await lab.reset(['q'.repeat(22)]);

    expect(cleared).toEqual([created.group_id, 'q'.repeat(22)]);
    expect(lab.state.groupId).toBeNull();
    expect(lab.state.devices.one.session).toBeNull();
    expect(lab.state.server.identityDirectory).toEqual({ identities: [] });

    const inspection = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${created.group_id}`,
    );

    expect(inspection.status).toBe(404);

    await lab.initializeDevices();

    expect(lab.state.server.identityDirectory?.identities).toHaveLength(2);
    lab.dispose();
  });
  it('keeps devices working through a server outage and delivers afterward', async () => {
    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
      webSocket: workerWebSocket,
    });

    await lab.initializeDevices();

    const created = await lab.createGroup({
      name: 'Before outage',
      currency_code: 'EUR',
      creator_member_name: 'Santi',
    });

    await lab.joinGroup(created.group_id, 'Robin');
    await lab.toggleServer();

    const queued = await lab.renameGroup('one', 'During outage');

    expect(queued.outbox).toHaveLength(1);
    expect(queued.projected_snapshot?.group.name).toBe('During outage');
    expect(lab.state.server.snapshot?.group.name).toBe('Before outage');

    await lab.toggleServer();

    expect(lab.state.server.snapshot?.group.name).toBe('During outage');
    expect(lab.state.devices.one.replica?.outbox).toEqual([]);
    await expect
      .poll(() => lab.state.devices.two.replica?.projected_snapshot?.group.name)
      .toBe('During outage');
    lab.dispose();
  });
});
