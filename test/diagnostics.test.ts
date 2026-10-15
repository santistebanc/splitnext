import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryClientStorage, SplitnextClient, SplitnextSyncClient, type ClientDiagnosticEvent, type ClientTransportEvent } from '../src/client';
import { createDispatcher, type DispatchRecord } from '../apps/client/src/model/actions';
import { AppController } from '../apps/client/src/model/controller';
import { createWorkbenchApp, type FakeAppOptions } from '../apps/client/src/workbench/app';
import { applyTestMigrations, randomDeviceSecret } from './harness';

beforeAll(applyTestMigrations);

const options: FakeAppOptions = {
  scenario: { members: ['Ana'], you: 'Ana', others: [], presence: 'realtime', othersOnline: true, connection: 'online' },
  connection: 'online', latency: 5, failure: 'none', log: () => undefined,
};

describe('action and SDK diagnostics', () => {
  it('retains attribution for simultaneous actions and describes approval and workflow changes', async () => {
    const app = await createWorkbenchApp(options);
    const actions = createDispatcher(app);
    const records: DispatchRecord[] = [];
    const events: ClientDiagnosticEvent[] = [];

    actions.observe((record) => records.push(record));
    actions.observeDiagnostics(() => { throw new Error('broken observer'); });
    actions.observeDiagnostics((event) => events.push(event));

    const results = await Promise.all([
      actions.dispatch('renameGroup', { name: 'New name' }),
      actions.dispatch('addMember', { name: 'Ben' }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['done', 'done']);
    const queued = events.flatMap((event) => event.kind === 'command_queued' ? [event] : []);

    expect(queued).toHaveLength(2);
    expect(new Set(queued.map((event) => event.invocation_id)).size).toBe(2);
    expect(new Set(queued.map((event) => event.invocation_id))).toEqual(new Set(records.map((record) => record.invocationId)));

    for (const queuedEvent of queued) {
      expect(events.some((event) => event.kind === 'request' && event.command_ids.includes(queuedEvent.command_id) && event.invocation_ids.includes(queuedEvent.invocation_id ?? 'missing'))).toBe(true);
    }

    const pending = await actions.dispatch('replaceInviteLink', {});

    if (pending.status !== 'needs_confirmation' || !pending.requestId) throw new Error('missing confirmation');
    const parent = records.at(-1)?.invocationId;

    expect((await actions.dispatch('confirmAction', { requestId: pending.requestId })).status).toBe('done');
    expect(records.find((record) => record.name === 'replaceInviteLink' && record.status === 'done')?.parentInvocationId).toBe(parent);
    await actions.dispatch('showCreateGroup', {});
    expect(records.at(-1)).toMatchObject({ before: { view: 'home' }, after: { view: 'create' }, durationMs: expect.any(Number) });
    app.dispose();
  });

  it('preserves offline attribution through reload and correlates the actual HTTP request without leaking input', async () => {
    const secret = randomDeviceSecret();
    const storage = new MemoryClientStorage();
    const transport: ClientTransportEvent[] = [];
    const bodies: string[] = [];

    const api = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      fetch: async (input, init) => { bodies.push(await new Request(input, init).text());

 return exports.default.fetch(input, init); },
      webSocket: () => ({ close: () => undefined }),
      observer: (event) => transport.push(event),
    });

    const client = new SplitnextSyncClient({ api, device_secret: secret, storage });
    const app = new AppController(client, { lastGroup: () => null, rememberGroup: () => undefined, lastYouName: () => null, rememberYouName: () => undefined });

    await app.start(true);
    await app.refresh();
    await app.createGroup({ name: 'Private group name', creator_member_name: 'Private member name' });
    await app.setOnline(false);
    const actions = createDispatcher(app);
    const records: DispatchRecord[] = [];

    actions.observe((record) => records.push(record));
    await actions.dispatch('addMember', { name: 'Private draft text' });
    const replica = app.snapshot().group;
    const pending = replica?.outbox[0];
    const invocation = records[0]?.invocationId;

    if (!replica || !pending || !invocation) throw new Error('missing queued intent');
    expect(pending.invocation_id).toBe(invocation);
    app.dispose();
    const reloaded = new SplitnextSyncClient({ api, device_secret: secret, storage });
    const events: ClientDiagnosticEvent[] = [];

    reloaded.observeDiagnostics((event) => events.push(event));
    const synced = await reloaded.syncGroup(replica.group_id);
    const request = events.find((event) => event.kind === 'request');

    expect(request).toMatchObject({ invocation_ids: [invocation], command_ids: [pending.command.command_id] });
    expect(events.at(-1)).toMatchObject({ kind: 'response', request_id: request?.request_id, outcomes: [{ command_id: pending.command.command_id, status: 'applied' }] });
    expect(transport.some((event) => event.kind === 'request' && event.request_id === request?.request_id && event.invocation_ids.includes(invocation))).toBe(true);
    expect(bodies.some((body) => body.includes('invocation_id'))).toBe(false);
    expect(synced.outbox).toHaveLength(0);

    for (const privateValue of [secret, 'Private draft text', 'Private member name', 'Private group name', replica.projected_snapshot?.invite.token ?? 'missing']) {
      expect(JSON.stringify(events)).not.toContain(privateValue);
    }
  });
});
