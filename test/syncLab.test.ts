import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { SyncLab } from '../src/lab/syncLab';
import { applyTestMigrations } from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('synchronization lab', () => {
  it('models divergent devices and reads authoritative state directly', async () => {
    let nextSecret = 0;

    const lab = new SyncLab({
      baseUrl: 'https://splitnext.test',
      fetch: (input, init) => exports.default.fetch(input, init),
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
  });
});
