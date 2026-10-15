import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryClientStorage, SplitnextSyncClient, type ClientStorageAdapter } from '../src/client';
import type { ClientStorageUpdate } from '../src/client/storage';
import { createIdentifier } from '../src/domain/ids';
import { memoryTransport } from '../src/memoryTransport';
import { randomDeviceSecret } from './harness';

/**
 * The client keeps one installation document, and every operation parses,
 * validates, and rewrites all of it. These budgets catch a change that adds
 * storage round trips to an operation, bloats the document, or makes a large
 * installation slow, before devices feel it. Raise a budget only on purpose.
 */

const groupCount = 12;

const memberCount = 40;

const noticeCount = 5;

const queuedCount = 20;

/** About 1.5 times the 88 KiB this installation takes today. */
const documentBudgetKiB = 128;

/**
 * About a frame. Operations take 2 to 3 ms on a development machine, leaving
 * room for slower CI machines while catching a change that makes them grow
 * faster than the document.
 */
const operationBudgetMs = 20;

/** Counts storage round trips and remembers the document's size. */
class MeasuredStorage implements ClientStorageAdapter {
  private readonly saved = new MemoryClientStorage();
  reads = 0;
  writes = 0;
  bytes = 0;

  read(): Promise<string | null> {
    this.reads += 1;

    return this.saved.read();
  }

  update<T>(change: (current: string | null) => ClientStorageUpdate<T>): Promise<T> {
    this.writes += 1;

    return this.saved.update((current) => {
      const updated = change(current);

      this.bytes = updated.serialized.length;

      return updated;
    });
  }

  /** Round trips made by one operation. */
  async count<T>(operation: () => Promise<T>): Promise<{ reads: number; writes: number }> {
    const before = { reads: this.reads, writes: this.writes };

    await operation();

    return { reads: this.reads - before.reads, writes: this.writes - before.writes };
  }
}

const storage = new MeasuredStorage();

let client: SplitnextSyncClient;

let groupIds: string[] = [];

beforeAll(async () => {
  const now = new Date().toISOString();
  const session = { identity: { id: createIdentifier(), created_at: now }, device: { id: createIdentifier(), created_at: now } };
  const server = await memoryTransport(session, [], { connection: 'online', latency: 0, failure: 'none', log: () => undefined });

  client = new SplitnextSyncClient({ api: server.api, storage, device_secret: randomDeviceSecret() });
  await client.initializeIdentity();

  for (let group = 0; group < groupCount; group += 1) {
    const { group_id: groupId } = await client.createGroup({ name: `Group ${group}`, creator_member_name: 'Ana' });

    groupIds.push(groupId);
    client.setOnline(false);

    for (let member = 1; member < memberCount; member += 1)
      await client.submit(groupId, { type: 'member.create', payload: { display_name: `Member ${member}` } });

    client.setOnline(true);
    await client.syncGroup(groupId);
  }

  const [open = ''] = groupIds;
  const members = (await client.inspect(open)).projected_snapshot?.members ?? [];

  // Renames to a taken name come back superseded, as notices to review.
  for (const member of members.slice(2, 2 + noticeCount))
    await client.submit(open, { type: 'member.rename', payload: { member_id: member.id, display_name: 'Member 1' } });

  // An offline session leaves intent queued, which every read replays.
  client.setOnline(false);

  for (const [index, member] of members.slice(10, 10 + queuedCount).entries())
    await client.submit(open, { type: 'member.rename', payload: { member_id: member.id, display_name: `Renamed ${index}` } });
}, 120_000);

/** The median duration of an operation run several times, in milliseconds. */
async function median<T>(runs: number, operation: (run: number) => Promise<T>): Promise<number> {
  const durations: number[] = [];

  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();

    await operation(run);
    durations.push(performance.now() - started);
  }

  return durations.sort((left, right) => left - right)[Math.floor(runs / 2)] ?? 0;
}

describe('installation storage', () => {
  it('holds a large installation within its size budget', async () => {
    const [open = ''] = groupIds;
    const state = await client.inspect(open);

    expect(state.notices).toHaveLength(noticeCount);
    expect(state.outbox).toHaveLength(queuedCount);
    expect(storage.bytes / 1024, `document is ${Math.round(storage.bytes / 1024)} KiB`).toBeLessThan(documentBudgetKiB);
  });

  it('reads and writes the document a fixed number of times per operation', async () => {
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

  it('keeps local operations on a large installation within their time budget', async () => {
    const [open = ''] = groupIds;
    const renamed = (await client.inspect(open)).projected_snapshot?.members.slice(30, 35).map((member) => member.id) ?? [];

    const timings = {
      submit: await median(15, (run) => client.submit(open, {
        type: 'member.rename',
        payload: { member_id: renamed[run % renamed.length] ?? '', display_name: `Timed ${run}` },
      })),
      inspect: await median(15, () => client.inspect(open)),
      installation: await median(15, () => client.installationState([open])),
    };

    for (const [operation, duration] of Object.entries(timings))
      expect(duration, `${operation} took ${duration} ms; all: ${JSON.stringify(timings)}`).toBeLessThan(operationBudgetMs);
  });
});
