import { MemoryClientStorage, SplitnextSyncClient, type ClientStorageAdapter } from '../../src/client';
import type { ClientStorageUpdate } from '../../src/client/storage';
import { createIdentifier } from '../../src/domain/ids';
import { memoryTransport } from '../../src/memoryTransport';
import { createDeviceSecret } from '../harness';

const groupCount = 12;

const memberCount = 40;

export const noticeCount = 5;

export const queuedCount = 20;

/** About 1.5 times the 88 KiB this installation takes today. */
export const documentBudgetKiB = 128;

/**
 * About a frame. Operations take 2 to 3 ms on a development machine, leaving
 * room for slower CI machines while catching a change that makes them grow
 * faster than the document.
 */
export const operationBudgetMs = 20;

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


export async function largeInstallation() {
  const storage = new MeasuredStorage();
  const groupIds: string[] = [];
  const now = new Date().toISOString();
  const session = { identity: { id: createIdentifier(), created_at: now }, device: { id: createIdentifier(), created_at: now } };
  const server = await memoryTransport(session, [], { connection: 'online', latency: 0, failure: 'none', log: () => undefined });

  const client = new SplitnextSyncClient({ api: server.api, storage, device_secret: createDeviceSecret() });
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

  // Renames based on a name the member no longer has come back superseded,
  // as notices to review.
  for (const member of members.slice(2, 2 + noticeCount))
    await client.submit(open, {
      type: 'member.rename',
      payload: { member_id: member.id, display_name: 'Renamed', expected_display_name: 'Stale name' },
    });

  // An offline session leaves intent queued, which every read replays.
  client.setOnline(false);

  for (const [index, member] of members.slice(10, 10 + queuedCount).entries())
    await client.submit(open, { type: 'member.rename', payload: { member_id: member.id, display_name: `Renamed ${index}` } });

  return { storage, client, groupIds };
}
