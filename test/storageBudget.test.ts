import { beforeAll, describe, expect, it } from 'vitest';
import { largeInstallation, documentBudgetKiB, noticeCount, queuedCount } from './fixtures/largeInstallation';

let fixture: Awaited<ReturnType<typeof largeInstallation>>;

beforeAll(async () => { fixture = await largeInstallation(); }, 120_000);

describe('installation storage', () => {
  it('holds a large installation within its size budget', async () => {
    const { client, storage, groupIds } = fixture;
    const [open = ''] = groupIds;
    const state = await client.inspect(open);

    expect(state.notices).toHaveLength(noticeCount);
    expect(state.outbox).toHaveLength(queuedCount);
    expect(storage.bytes / 1024, `document is ${Math.round(storage.bytes / 1024)} KiB`).toBeLessThan(documentBudgetKiB);
  });

  it('reads and writes the document a fixed number of times per operation', async () => {
    const { client, storage, groupIds } = fixture;
    const [open = '', other = ''] = groupIds;
    const [notice] = (await client.inspect(open)).notices;

    if (!notice) throw new Error('missing_notice');

    expect(await storage.count(() => client.inspect(open))).toEqual({ reads: 1, writes: 0 });
    expect(await storage.count(() => client.installationState([open]))).toEqual({ reads: 1, writes: 0 });
    expect(await storage.count(() => client.submit(open, { type: 'group.rename', payload: { name: 'Offline' } }))).toEqual({ reads: 0, writes: 1 });
    expect(await storage.count(() => client.dismissNotice(open, notice.outcome.command_id))).toEqual({ reads: 0, writes: 1 });

    // Online: save to the outbox, read what to send, record the response.
    client.setOnline(true);
    expect(await storage.count(() => client.submit(other, { type: 'group.rename', payload: { name: 'Online' } }))).toEqual({ reads: 1, writes: 2 });
    client.setOnline(false);
  });
});
