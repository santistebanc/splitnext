import { expect, it } from 'vitest';
import { MemoryClientStorage, SplitnextSyncClient } from '../src/client';
import { createIdentifier } from '../src/domain/ids';
import { memoryTransport } from '../src/memoryTransport';

it('retains stale repayment edits as notices and restores exactly across devices', async () => {
  const at = new Date().toISOString();
  const server = await memoryTransport({ identity: { id: createIdentifier(), created_at: at }, device: { id: createIdentifier(), created_at: at } }, [], { connection: 'online', latency: 0, failure: 'none', log: () => undefined });
  const a = new SplitnextSyncClient({ api: server.api, device_secret: 'a'.repeat(43), storage: new MemoryClientStorage() });
  const b = new SplitnextSyncClient({ api: server.api, device_secret: 'b'.repeat(43), storage: new MemoryClientStorage() });

  await a.initializeIdentity();
  await b.initializeIdentity();
  const created = await a.createGroup({ name: 'Repayments', creator_member_name: 'Ana' });
  const groupId = created.group_id;
  const added = await a.submit(groupId, { type: 'member.create', payload: { display_name: 'Ben' } });
  const [ana, ben] = added.projected_snapshot?.members ?? [];

  if (!ana || !ben || !added.projected_snapshot) throw new Error('missing members');
  await b.joinGroup(groupId, { kind: 'existing', member_id: ana.id }, added.projected_snapshot.invite.token);
  const settlementId = createIdentifier();
  const entry = { from_member_id: ben.id, to_member_id: ana.id, currency: 'EUR', amount: 300 };

  await a.submit(groupId, { type: 'settlement.record', payload: { ...entry, settlement_id: settlementId } });
  await b.syncGroup(groupId);
  a.setOnline(false);
  b.setOnline(false);
  await a.submit(groupId, { type: 'settlement.edit', payload: { ...entry, settlement_id: settlementId, amount: 400 } });
  await b.submit(groupId, { type: 'settlement.edit', payload: { ...entry, settlement_id: settlementId, amount: 500 } });
  a.setOnline(true);
  b.setOnline(true);
  await a.syncGroup(groupId);
  const stale = await b.syncGroup(groupId);

  expect(stale.notices).toMatchObject([{ outcome: { status: 'superseded', reason: 'settlement_changed' } }]);
  expect(stale.projected_snapshot?.settlements).toMatchObject([{ amount: 400, version: 2 }]);
  await b.submit(groupId, { type: 'settlement.remove', payload: { settlement_id: settlementId } });
  const restored = await a.submit(groupId, { type: 'settlement.restore', payload: { settlement_id: settlementId } });

  expect(restored.projected_snapshot?.settlements).toMatchObject([{ amount: 400, status: 'active', version: 4 }]);
  expect(server.repository(groupId)?.audit_events.filter((event) => event.change.action.startsWith('settlement.'))).toHaveLength(4);
});


it('authoritatively rejects a stale offline reversal and retains its notice', async () => {
  const at = new Date().toISOString();
  const server = await memoryTransport({ identity: { id: createIdentifier(), created_at: at }, device: { id: createIdentifier(), created_at: at } }, [], { connection: 'online', latency: 0, failure: 'none', log: () => undefined });
  const a = new SplitnextSyncClient({ api: server.api, device_secret: 'c'.repeat(43), storage: new MemoryClientStorage() });
  const b = new SplitnextSyncClient({ api: server.api, device_secret: 'd'.repeat(43), storage: new MemoryClientStorage() });
  await a.initializeIdentity();
  await b.initializeIdentity();
  const created = await a.createGroup({ name: 'Undo', creator_member_name: 'Ana' });
  const groupId = created.group_id;
  const added = await a.submit(groupId, { type: 'member.create', payload: { display_name: 'Ben' } });
  const [ana, ben] = added.projected_snapshot?.members ?? [];

  if (!ana || !ben || !added.projected_snapshot) throw new Error('missing members');
  await b.joinGroup(groupId, { kind: 'existing', member_id: ben.id }, added.projected_snapshot.invite.token);
  const settlementId = createIdentifier();
  const entry = { from_member_id: ben.id, to_member_id: ana.id, currency: 'EUR', amount: 300 };
  await a.submit(groupId, { type: 'settlement.record', payload: { ...entry, settlement_id: settlementId } });
  await b.syncGroup(groupId);
  const history = await b.activity(groupId);
  const recorded = history.activity.find((event) => event.change.action === 'settlement.recorded');

  if (!recorded) throw new Error('missing record');
  b.setOnline(false);
  const undone = await b.submit(groupId, { type: 'change.undo', payload: { event_id: recorded.id } });
  expect(undone.projected_snapshot?.settlements[0]?.status).toBe('removed');
  await a.submit(groupId, { type: 'settlement.edit', payload: { ...entry, amount: 500, settlement_id: settlementId } });
  b.setOnline(true);
  const stale = await b.syncGroup(groupId);
  expect(stale.projected_snapshot?.settlements[0]).toMatchObject({ amount: 500, status: 'active' });
  expect(stale.notices).toMatchObject([{ command: { type: 'change.undo' }, outcome: { status: 'superseded', reason: 'undo_changed' } }]);
});
