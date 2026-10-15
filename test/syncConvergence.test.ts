import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MemoryClientStorage,
  SplitnextNetworkError,
  SplitnextRequestError,
  SplitnextSyncClient,
  activeMembers,
  type ClientPreferredMemberChoice,
  type CommandIntent,
  type RealtimeSocketHandlers,
  type SyncDeviceTransport,
  type SyncTransport,
} from '../src/client';
import { requiresServerDecision } from '../src/domain/commands';
import { createIdentifier } from '../src/domain/ids';
import { memberNameKey } from '../src/domain/members';
import { groupSnapshotSchema, type GroupSnapshot } from '../src/domain/sync';
import { memoryTransport } from '../src/memoryTransport';
import { randomDeviceSecret } from './harness';

/**
 * Model-based check of the offline-first promise: whatever devices do while
 * offline, flaky, or reloading, in two tabs at once, and while realtime
 * announcements start background synchronization, once everyone reconnects
 * they converge on the server's state and every command receives exactly
 * one outcome. A failure prints the shrunk list of steps that breaks it; pass
 * the printed seed and path to `fc.assert` to replay it.
 *
 * To cover a new command, add a generator for it to `commandArbitrary`.
 */

const deviceCount = 3;

const tabCount = 2;

const memberNames = ['Ana', 'ana', 'Ben', 'Cy', 'Dee'];

const groupNames = ['Trip', 'Lisbon', 'Ski'];

type Fault = 'none' | 'lose_request' | 'lose_response';

/** What happens to the first request a device sends during one step. */
const faultArbitrary = fc.oneof(
  { arbitrary: fc.constant<Fault>('none'), weight: 3 },
  { arbitrary: fc.constant<Fault>('lose_request'), weight: 1 },
  { arbitrary: fc.constant<Fault>('lose_response'), weight: 1 },
);

const pick = fc.nat({ max: 9 });

/** One generator per group command; members are picked from the sender's projection. */
const commandArbitrary = fc.oneof(
  fc.record({ type: fc.constant('group.rename' as const), name: fc.constantFrom(...groupNames) }),
  fc.record({ type: fc.constant('member.create' as const), name: fc.constantFrom(...memberNames) }),
  fc.record({ type: fc.constant('member.rename' as const), member: pick, name: fc.constantFrom(...memberNames) }),
  fc.record({ type: fc.constant('member.archive' as const), member: pick }),
  fc.record({ type: fc.constant('preference.set' as const), member: pick }),
  fc.record({ type: fc.constant('group.leave' as const) }),
);

type CommandStep = typeof commandArbitrary extends fc.Arbitrary<infer T> ? T : never;

const actionArbitrary = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('submit' as const), command: commandArbitrary }), weight: 6 },
  fc.record({ kind: fc.constant('goOffline' as const) }),
  fc.record({ kind: fc.constant('goOnline' as const) }),
  fc.record({ kind: fc.constant('open' as const) }),
  fc.record({ kind: fc.constant('reload' as const) }),
  fc.record({ kind: fc.constant('rejoin' as const), member: fc.option(pick), name: fc.constantFrom(...memberNames) }),
  fc.record({ kind: fc.constant('regenerateInvite' as const) }),
  fc.record({ kind: fc.constant('retryNotice' as const), notice: pick }),
  fc.record({ kind: fc.constant('dismissNotice' as const), notice: pick }),
);

/** The intent a person would submit for a generated command, if its member exists. */
function intentFor(command: CommandStep, snapshot: GroupSnapshot): CommandIntent | null {
  const member = (index: number) => snapshot.members[index % snapshot.members.length]?.id;

  switch (command.type) {
    case 'group.rename':
      return { type: command.type, payload: { name: command.name } };
    case 'member.create':
      return { type: command.type, payload: { display_name: command.name } };
    case 'member.rename': {
      const memberId = member(command.member);

      return memberId ? { type: command.type, payload: { member_id: memberId, display_name: command.name } } : null;
    }

    case 'member.archive':
    case 'preference.set': {
      const memberId = member(command.member);

      return memberId ? { type: command.type, payload: { member_id: memberId } } : null;
    }

    case 'group.leave':
      return { type: command.type, payload: {} };
  }
}

const stepArbitrary = fc.record({
  device: fc.nat({ max: deviceCount - 1 }),
  tab: fc.nat({ max: tabCount - 1 }),
  fault: faultArbitrary,
  // Starts while earlier concurrent steps are still running.
  concurrent: fc.oneof({ arbitrary: fc.constant(false), weight: 3 }, { arbitrary: fc.constant(true), weight: 1 }),
  action: actionArbitrary,
});

type Step = typeof stepArbitrary extends fc.Arbitrary<infer T> ? T : never;

type Device = {
  secret: string;
  /** One installation's storage, shared by its tabs. */
  storage: MemoryClientStorage;
  tabs: SplitnextSyncClient[];
  /** Every command this installation queued, from its tabs' diagnostics. */
  queued: string[];
  /** Notices this installation retried or dismissed. */
  resolved: Set<string>;
  /** A rejoin the person started but never saw finish; they try it again. */
  unfinishedJoin: ClientPreferredMemberChoice | null;
};

type Simulation = {
  groupId: string;
  faults: Map<string, Fault>;
  open: (device: Device, tab: number) => SplitnextSyncClient;
};

/** Realtime connections per group, announcing revisions like the server does. */
class RealtimeHub {
  private readonly sockets = new Map<string, Set<RealtimeSocketHandlers>>();

  constructor(private readonly revision: (groupId: string) => number | null) {}

  connect(groupId: string, handlers: RealtimeSocketHandlers) {
    const group = this.sockets.get(groupId) ?? new Set<RealtimeSocketHandlers>();

    this.sockets.set(groupId, group);
    group.add(handlers);

    // Every connection starts with the current revision, so it catches up.
    setTimeout(() => {
      if (!group.has(handlers)) return;
      handlers.open();
      this.send(handlers, groupId);
    }, 0);

    return {
      close: () => {
        if (group.delete(handlers)) setTimeout(() => handlers.close(1000, 'unsubscribed'), 0);
      },
    };
  }

  announce(groupId: string): void {
    for (const handlers of this.sockets.get(groupId) ?? []) setTimeout(() => this.send(handlers, groupId), 0);
  }

  private send(handlers: RealtimeSocketHandlers, groupId: string): void {
    const revision = this.revision(groupId);

    if (revision !== null) handlers.message(JSON.stringify({ type: 'revision', revision }));
  }
}

/** Loses one request or its response, as a flaky network would, and announces changes. */
function flakyTransport(api: SyncTransport, faults: Map<string, Fault>, hub: RealtimeHub): SyncTransport {
  return {
    createAnonymousIdentity: (secret) => api.createAnonymousIdentity(secret),
    forDevice: (secret): SyncDeviceTransport => {
      const device = api.forDevice(secret);

      async function deliver<T>(request: () => Promise<T>, changes?: string): Promise<T> {
        const fault = faults.get(secret) ?? 'none';

        faults.delete(secret);

        if (fault === 'lose_request') throw new SplitnextNetworkError(new TypeError('request_lost'));
        const result = await request();

        if (changes) hub.announce(changes);

        if (fault === 'lose_response') throw new SplitnextNetworkError(new TypeError('response_lost'));

        return result;
      }

      return {
        currentIdentity: () => deliver(() => device.currentIdentity()),
        createGroup: (input, context) => deliver(() => device.createGroup(input, context)),
        joinGroup: (groupId, input, context) => deliver(() => device.joinGroup(groupId, input, context), groupId),
        syncGroup: (groupId, input, context) => deliver(() => device.syncGroup(groupId, input, context), groupId),
        regenerateInvite: (groupId, input, context) => deliver(() => device.regenerateInvite(groupId, input, context), groupId),
        previewInvite: (groupId, token, context) => deliver(() => device.previewInvite(groupId, token, context)),
        listGroups: (context) => deliver(() => device.listGroups(context)),
        openRealtime: (groupId, handlers) => hub.connect(groupId, handlers),
      };
    },
  };
}

async function simulate(steps: readonly Step[]): Promise<void> {
  const now = new Date().toISOString();
  const session = { identity: { id: createIdentifier(), created_at: now }, device: { id: createIdentifier(), created_at: now } };
  const server = await memoryTransport(session, [], { connection: 'online', latency: 0, failure: 'none', log: () => undefined });
  const faults = new Map<string, Fault>();
  const hub = new RealtimeHub((groupId) => server.repository(groupId)?.state?.revision ?? null);
  const api = flakyTransport(server.api, faults, hub);
  const backgroundErrors: Error[] = [];

  function open(device: Device, tab: number): SplitnextSyncClient {
    const client = new SplitnextSyncClient({
      api, storage: device.storage, device_secret: device.secret,
      realtime_reconnect_delay_ms: () => 0,
      on_background_error: (error) => backgroundErrors.push(error),
    });

    client.observeDiagnostics((event) => {
      if (event.kind === 'command_queued') device.queued.push(event.command_id);
    });
    device.tabs[tab] = client;

    return client;
  }

  const devices = Array.from({ length: deviceCount }, (): Device => {
    const device: Device = {
      secret: randomDeviceSecret(), storage: new MemoryClientStorage(), tabs: [],
      queued: [], resolved: new Set(), unfinishedJoin: null,
    };

    for (let tab = 0; tab < tabCount; tab += 1) open(device, tab);

    return device;
  });

  const first = (device: Device | undefined) => {
    const client = device?.tabs[0];

    if (!client) throw new Error('missing_tab');

    return client;
  };

  const [creator, ...joiners] = devices;

  await first(creator).initializeIdentity();
  const created = await first(creator).createGroup({ name: 'Trip', creator_member_name: 'Ana' });
  const groupId = created.group_id;
  const token = created.projected_snapshot?.invite.token;

  if (!token) throw new Error('missing_invite');

  for (const [index, device] of joiners.entries()) {
    await first(device).initializeIdentity();
    await first(device).joinGroup(groupId, { kind: 'new', display_name: memberNames[index + 2] ?? 'Dee' }, token);
  }

  for (const device of devices) for (const tab of device.tabs) tab.watchGroup(groupId);

  const simulation: Simulation = { groupId, faults, open };
  const running: Promise<void>[] = [];

  for (const step of steps) {
    const device = devices[step.device];

    if (!device) throw new Error('missing_device');

    if (!step.concurrent) await Promise.all(running.splice(0));

    const run = perform(simulation, device, step).then(async () => {
      const state = await first(device).inspect(groupId);

      // Someone who sees the group again has no reason to repeat a lost rejoin.
      if (!state.hidden) device.unfinishedJoin = null;

      if (state.projected_snapshot) expectValidSnapshot(state.projected_snapshot);
    });

    // A failure surfaces when the step is awaited, not as an unhandled rejection.
    run.catch(() => undefined);

    if (step.concurrent) running.push(run);
    else await run;
  }

  await Promise.all(running);

  // Everyone reconnects, finishes what they started, and synchronizes until
  // background work settles: every tab delivers, then observes the result.
  faults.clear();

  for (const device of devices) for (const tab of device.tabs) tab.setOnline(true);

  for (const device of devices) {
    if (device.unfinishedJoin) await rejoin(first(device), groupId, device.unfinishedJoin, 'none');
  }

  for (let round = 0; round < 3; round += 1) {
    for (const device of devices) for (const tab of device.tabs) await tab.refreshGroup(groupId);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const recorded = server.repository(groupId);

  if (!recorded?.state) throw new Error('missing_server_group');
  const { revision, snapshot } = recorded.state;

  expectValidSnapshot(snapshot);

  // Background synchronization only ever fails because of an injected fault.
  expect(backgroundErrors.filter((error) => !(error instanceof SplitnextNetworkError))).toEqual([]);

  for (const device of devices) {
    const replica = await first(device).inspect(groupId);

    expect(replica.outbox).toEqual([]);
    expect(replica.revision).toBe(revision);
    expect(replica.confirmed_snapshot).toEqual(snapshot);
    expect(replica.projected_snapshot).toEqual(snapshot);
  }

  // Every queued command reached the server exactly once.
  const outcomes = recorded.command_outcomes;
  const outcomeIds = outcomes.map((entry) => entry.command_id);
  const queuedIds = devices.flatMap((device) => device.queued);

  expect(new Set(outcomeIds).size).toBe(outcomeIds.length);
  expect(new Set(queuedIds).size).toBe(queuedIds.length);
  expect(new Set(outcomeIds)).toEqual(new Set(queuedIds));

  // Each revision is one applied transition with one audit event.
  expect(recorded.audit_events.map((event) => event.revision)).toEqual(
    Array.from({ length: revision }, (_, index) => index + 1),
  );

  // Every unsuccessful command stays visible until its device resolves it.
  for (const device of devices) {
    const replica = await first(device).inspect(groupId);
    const noticed = new Map(replica.notices.map((notice) => [notice.outcome.command_id, notice.outcome]));

    for (const entry of outcomes) {
      const unsuccessful = entry.outcome.status === 'rejected' || entry.outcome.status === 'superseded';

      if (!unsuccessful || !device.queued.includes(entry.command_id) || device.resolved.has(entry.command_id)) continue;
      expect(noticed.get(entry.command_id)).toEqual(entry.outcome);
    }

    for (const commandId of noticed.keys()) expect(device.queued).toContain(commandId);
  }
}

/** Runs one step the way the app would, skipping what the app would not offer. */
async function perform(simulation: Simulation, device: Device, step: Step): Promise<void> {
  const { groupId, faults } = simulation;
  const { action } = step;
  // Concurrent steps could consume each other's faults, so only sequential ones inject them.
  const fault = step.concurrent ? 'none' : step.fault;
  const client = device.tabs[step.tab];

  if (!client) throw new Error('missing_tab');
  const state = await client.inspect(groupId);
  const snapshot = state.projected_snapshot;
  const online = client.isOnline();

  if (!snapshot) throw new Error('missing_replica');
  const notice = (index: number) => state.notices[index % Math.max(state.notices.length, 1)];

  if (fault !== 'none') faults.set(device.secret, fault);

  try {
    switch (action.kind) {
      case 'goOffline':
        for (const tab of device.tabs) tab.setOnline(false);

        return;
      case 'goOnline':
        for (const tab of device.tabs) tab.setOnline(true);

        return;
      case 'reload': {
        const reloaded = simulation.open(device, step.tab);

        reloaded.setOnline(online);
        await attempt(fault, () => reloaded.initializeIdentity());

        if (!state.hidden) reloaded.watchGroup(groupId);

        return;
      }

      case 'open':
        // Opening a group synchronizes it, fetching a left group's snapshot.
        if (online) await attempt(fault, () => state.hidden ? client.refreshGroup(groupId) : client.syncGroup(groupId));

        return;
      case 'rejoin': {
        if (!online || !state.hidden) return;
        const active = activeMembers(snapshot);
        const existing = action.member === null ? undefined : active[action.member % active.length];

        const choice: ClientPreferredMemberChoice = existing
          ? { kind: 'existing', member_id: existing.id }
          : { kind: 'new', display_name: action.name };

        const result = await rejoin(client, groupId, choice, fault);

        device.unfinishedJoin = result === 'unfinished' ? choice : null;

        // A rejoin that reports success shows the group again.
        if (result === 'joined' && !step.concurrent) expect((await client.inspect(groupId)).hidden).toBe(false);

        return;
      }

      case 'retryNotice': {
        const retried = notice(action.notice);

        if (!retried || state.hidden || (retried.command.type === 'group.leave' && !online)) return;
        await attempt(fault, () => client.retryNotice(groupId, retried.command.command_id), step.concurrent);
        device.resolved.add(retried.command.command_id);

        return;
      }

      case 'dismissNotice': {
        const dismissed = notice(action.notice);

        if (!dismissed) return;
        await client.dismissNotice(groupId, dismissed.command.command_id);
        device.resolved.add(dismissed.command.command_id);

        return;
      }

      case 'regenerateInvite':
        if (online && !state.hidden) await attempt(fault, () => client.regenerateInvite(groupId));

        return;
      case 'submit': {
        const intent = intentFor(action.command, snapshot);

        // The app offers commands only for a group it shows, and leaving only online.
        if (!intent || state.hidden || (requiresServerDecision(intent.type) && !online)) return;
        const done = await attempt(fault, () => client.submit(groupId, intent));

        // A leave that reports success shows the group as left, even if its response was lost.
        if (done && intent.type === 'group.leave' && !step.concurrent) expect((await client.inspect(groupId)).hidden).toBe(true);
      }
    }
  } finally {
    if (fault !== 'none') faults.delete(device.secret);
  }
}

/**
 * Runs an operation, accepting only a network failure the step injected and,
 * when tabs race, a notice another tab already resolved.
 */
async function attempt<T>(fault: Fault, operation: () => Promise<T>, racing = false): Promise<boolean> {
  try {
    await operation();

    return true;
  } catch (error) {
    if (error instanceof SplitnextNetworkError && fault !== 'none') return false;

    if (racing && error instanceof Error && error.message === 'notice_not_found') return false;

    throw error;
  }
}

/** A rejoin may also race with the chosen member being archived meanwhile. */
async function rejoin(
  client: SplitnextSyncClient,
  groupId: string,
  choice: ClientPreferredMemberChoice,
  fault: Fault,
): Promise<'joined' | 'unfinished' | 'rejected'> {
  try {
    return (await attempt(fault, () => client.joinGroup(groupId, choice))) ? 'joined' : 'unfinished';
  } catch (error) {
    if (error instanceof SplitnextRequestError && (error.code === 'member_archived' || error.code === 'member_not_found'))
      return 'rejected';

    throw error;
  }
}

/** Rules that hold for every server snapshot and every local projection. */
function expectValidSnapshot(snapshot: GroupSnapshot): void {
  groupSnapshotSchema.parse(snapshot);
  const active = activeMembers(snapshot);

  expect(new Set(snapshot.members.map((entry) => entry.id)).size).toBe(snapshot.members.length);
  expect(new Set(active.map((entry) => memberNameKey(entry.display_name))).size).toBe(active.length);

  for (const grant of snapshot.access_grants) {
    if (grant.hidden_at) expect(grant.preferred_member_id).toBeNull();

    if (grant.preferred_member_id) expect(active.map((entry) => entry.id)).toContain(grant.preferred_member_id);
  }
}

const leave = { kind: 'submit', command: { type: 'group.leave' } } as const;

const sequential = { tab: 0, concurrent: false } as const;

/** Rare sequences worth checking on every run; each found a bug once. */
const examples: [Step[]][] = [
  // A rejoin whose response was lost must not be replayed after leaving again.
  [[
    { ...sequential, device: 1, fault: 'none', action: leave },
    { ...sequential, device: 1, fault: 'lose_response', action: { kind: 'rejoin', member: null, name: 'Dee' } },
    { ...sequential, device: 1, fault: 'none', action: { kind: 'open' } },
    { ...sequential, device: 1, fault: 'none', action: leave },
    { ...sequential, device: 1, fault: 'none', action: { kind: 'rejoin', member: 0, name: 'Dee' } },
  ]],
  // A leave whose request was lost reaches the server before a rejoin.
  [[
    { ...sequential, device: 0, fault: 'lose_request', action: leave },
    { ...sequential, device: 0, fault: 'none', action: { kind: 'rejoin', member: null, name: 'Ana' } },
  ]],
  // Choosing who you are, queued alongside leaving, cannot apply after the leave.
  [[
    { device: 1, tab: 0, concurrent: true, fault: 'none', action: leave },
    { device: 1, tab: 0, concurrent: true, fault: 'none', action: { kind: 'submit', command: { type: 'preference.set', member: 0 } } },
  ]],
  // A replaced link whose follow-up sync finds the device offline still succeeds.
  [[
    { device: 1, tab: 0, concurrent: true, fault: 'none', action: { kind: 'regenerateInvite' } },
    { device: 1, tab: 0, concurrent: true, fault: 'none', action: { kind: 'goOffline' } },
  ]],
];

describe('offline synchronization', () => {
  it('converges every device on the server state with one outcome per command', async () => {
    const steps = fc.array(stepArbitrary, { minLength: 1, maxLength: 60, size: 'max' });

    await fc.assert(fc.asyncProperty(steps, simulate), { numRuns: 100, examples });
  }, 120_000);
});
