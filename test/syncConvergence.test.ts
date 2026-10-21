import fc from 'fast-check';
import type { AuditEvent } from '../src/domain/audit';
import { describe, expect, it } from 'vitest';
import {
  ClientStorageError,
  MemoryClientStorage,
  SplitnextNetworkError,
  SplitnextRequestError,
  SplitnextSyncClient,
  activeMembers,
  type ClientPreferredMemberChoice,
  type ClientStorageAdapter,
  type CommandIntent,
  type RealtimeSocketHandlers,
  type SyncDeviceTransport,
  type SyncTransport,
} from '../src/client';
import type { ClientStorageUpdate } from '../src/client/storage';
import { requiresServerDecision } from '../src/domain/commands';
import { expenseMemberIds, groupBalances } from '../src/domain/expenses';
import { createIdentifier } from '../src/domain/ids';
import { groupSnapshotSchema, type GroupSnapshot } from '../src/domain/sync';
import { memoryTransport } from '../src/memoryTransport';
import { createDeviceSecret } from './harness';

/**
 * Model-based check of the offline-first promise: whatever devices do in two
 * groups while offline, flaky, reloading, or failing to save, in two tabs at
 * once, and while realtime announcements start background synchronization,
 * once everyone reconnects they converge on the server's state, list exactly
 * the groups the server lets them access, and every command receives exactly
 * one outcome. A failure prints the shrunk list of steps that breaks it; pass
 * the printed seed and path to `fc.assert` to replay it.
 *
 * To cover a new command, add a generator for it to `commandArbitrary`.
 */

const deviceCount = 3;

const tabCount = 2;

/** Device 0 creates the first group and device 1 the second, which device 0 can join through its link. */
const groupCount = 2;

const memberNames = ['Ana', 'ana', 'Ben', 'Cy', 'Dee'];

const groupNames = ['Trip', 'Lisbon', 'Ski'];

type Fault = 'none' | 'lose_request' | 'lose_response';

/** What happens to the first request a device sends during one step. */
const faultArbitrary = fc.oneof(
  { arbitrary: fc.constant<Fault>('none'), weight: 3 },
  { arbitrary: fc.constant<Fault>('lose_request'), weight: 1 },
  { arbitrary: fc.constant<Fault>('lose_response'), weight: 1 },
);

/** Which storage operation of a device fails during one step, as with a full disk; null for none. */
const storageFaultArbitrary = fc.oneof(
  { arbitrary: fc.constant(null), weight: 5 },
  { arbitrary: fc.nat({ max: 3 }), weight: 1 },
);

type Injected = { network: Fault; storage: number | null };

const noFaults: Injected = { network: 'none', storage: null };

const pick = fc.nat({ max: 9 });

/**
 * An expense as someone enters it: members picked from any in the sender's
 * projection, removed ones included, so late expenses are exercised, and
 * totals that rarely split evenly so extra units keep moving.
 */
const expenseEntry = {
  payer: pick,
  participants: fc.uniqueArray(pick, { minLength: 1, maxLength: 4 }),
  exact: fc.option(fc.nat({ max: 50 })),
  total: fc.integer({ min: 1, max: 1_000 }),
  currency: fc.constantFrom('EUR', 'JPY'),
};

/** One generator per group command; members are picked from the sender's projection. */
const commandArbitrary = fc.oneof(
  fc.record({ type: fc.constant('change.undo' as const), event: pick }),
  fc.record({ type: fc.constant('group.rename' as const), name: fc.constantFrom(...groupNames) }),
  fc.record({ type: fc.constant('member.create' as const), name: fc.constantFrom(...memberNames) }),
  fc.record({ type: fc.constant('member.rename' as const), member: pick, name: fc.constantFrom(...memberNames) }),
  fc.record({ type: fc.constant('member.remove' as const), member: pick }),
  fc.record({ type: fc.constant('member.restore' as const), member: pick }),
  fc.record({ type: fc.constant('preference.set' as const), member: pick }),
  fc.record({ type: fc.constant('group.leave' as const) }),
  fc.record({ type: fc.constant('settlement.edit' as const), settlement: pick, from: pick, to: pick, amount: fc.integer({ min: 1, max: 2000 }), currency: fc.constantFrom('EUR', 'JPY') }),
  fc.record({ type: fc.constant('settlement.remove' as const), settlement: pick }),
  fc.record({ type: fc.constant('settlement.restore' as const), settlement: pick }),
  fc.record({ type: fc.constant('settlement.record' as const), from: pick, to: pick, amount: fc.integer({ min: 1, max: 2000 }), currency: fc.constantFrom('EUR', 'JPY') }),
  fc.record({ type: fc.constant('expense.record' as const), ...expenseEntry }),
  fc.record({ type: fc.constant('expense.edit' as const), expense: pick, ...expenseEntry }),
  fc.record({ type: fc.constant('expense.remove' as const), expense: pick }),
  fc.record({ type: fc.constant('expense.restore' as const), expense: pick }),
);

type CommandStep = typeof commandArbitrary extends fc.Arbitrary<infer T> ? T : never;

const actionArbitrary = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('submit' as const), command: commandArbitrary }), weight: 6 },
  fc.record({ kind: fc.constant('goOffline' as const) }),
  fc.record({ kind: fc.constant('goOnline' as const) }),
  fc.record({ kind: fc.constant('open' as const) }),
  fc.record({ kind: fc.constant('reload' as const) }),
  fc.record({ kind: fc.constant('listGroups' as const) }),
  fc.record({ kind: fc.constant('readActivity' as const) }),
  fc.record({ kind: fc.constant('join' as const), member: fc.option(pick), name: fc.constantFrom(...memberNames) }),
  fc.record({ kind: fc.constant('regenerateInvite' as const) }),
  fc.record({ kind: fc.constant('retryNotice' as const), notice: pick }),
  fc.record({ kind: fc.constant('dismissNotice' as const), notice: pick }),
);

/** The intent a person would submit for a generated command, if its member exists. */
function intentFor(command: CommandStep, snapshot: GroupSnapshot, history: readonly AuditEvent[]): CommandIntent | null {
  const member = (index: number) => snapshot.members[index % snapshot.members.length]?.id;

  switch (command.type) {
    case 'change.undo': {
      const event = history[command.event % Math.max(1, history.length)];

      return event ? { type: command.type, payload: { event_id: event.id } } : null;
    }

    case 'group.rename':
      return { type: command.type, payload: { name: command.name } };
    case 'member.create':
      return { type: command.type, payload: { display_name: command.name } };
    case 'member.rename': {
      const memberId = member(command.member);

      return memberId ? { type: command.type, payload: { member_id: memberId, display_name: command.name } } : null;
    }

    case 'member.remove':
    case 'member.restore':
    case 'preference.set': {
      const memberId = member(command.member);

      return memberId ? { type: command.type, payload: { member_id: memberId } } : null;
    }

    case 'group.leave':
      return { type: command.type, payload: {} };
    case 'settlement.edit':
    case 'settlement.record': {
      const from = member(command.from);
      const to = member(command.to);

      if (!from || !to) return null;
      const payload = { from_member_id: from, to_member_id: to, amount: command.amount, currency: command.currency };

      if (command.type === 'settlement.record') return { type: command.type, payload };
      const current = snapshot.settlements[command.settlement % Math.max(1, snapshot.settlements.length)];

      return current ? { type: command.type, payload: { ...payload, settlement_id: current.id } } : null;
    }

    case 'settlement.remove':
    case 'settlement.restore': {
      const current = snapshot.settlements[command.settlement % Math.max(1, snapshot.settlements.length)];

      return current ? { type: command.type, payload: { settlement_id: current.id } } : null;
    }

    case 'expense.record':
    case 'expense.edit': {
      const payer = member(command.payer);
      const participants = [...new Set(command.participants.flatMap((index) => member(index) ?? []))];
      const expenseId = snapshot.expenses[command.type === 'expense.edit' ? command.expense % Math.max(snapshot.expenses.length, 1) : -1]?.id;

      if (!payer || !participants.length || (command.type === 'expense.edit' && !expenseId)) return null;

      // The first participant may owe an exact amount; the rest share what is left.
      const [first, ...rest] = participants;
      const exact = command.exact !== null && rest.length && first ? Math.min(command.exact, command.total) : null;

      const entry = {
        description: 'Expense', currency: command.currency, total: command.total, paid_by: payer,
        parts: participants.map((memberId) =>
          memberId === first && exact !== null
            ? { kind: 'exact' as const, member_id: memberId, amount: exact }
            : { kind: 'shares' as const, member_id: memberId, shares: 1 }),
      };

      return command.type === 'expense.edit' && expenseId
        ? { type: command.type, payload: { ...entry, expense_id: expenseId } }
        : { type: 'expense.record', payload: entry };
    }

    case 'expense.remove':
    case 'expense.restore': {
      const expenseId = snapshot.expenses[command.expense % Math.max(snapshot.expenses.length, 1)]?.id;

      return expenseId ? { type: command.type, payload: { expense_id: expenseId } } : null;
    }
  }
}

const stepArbitrary = fc.record({
  device: fc.nat({ max: deviceCount - 1 }),
  tab: fc.nat({ max: tabCount - 1 }),
  group: fc.nat({ max: groupCount - 1 }),
  fault: faultArbitrary,
  storage: storageFaultArbitrary,
  // Starts while earlier concurrent steps are still running.
  concurrent: fc.oneof({ arbitrary: fc.constant(false), weight: 3 }, { arbitrary: fc.constant(true), weight: 1 }),
  action: actionArbitrary,
});

type Step = typeof stepArbitrary extends fc.Arbitrary<infer T> ? T : never;

/** A join the person started but never saw finish; they try it again. */
type UnfinishedJoin = { choice: ClientPreferredMemberChoice; invited: boolean };

type Device = {
  secret: string;
  identityId: string;
  /** One installation's storage, shared by its tabs. */
  storage: FlakyStorage;
  tabs: SplitnextSyncClient[];
  /** Every command this installation queued, from its tabs' diagnostics. */
  queued: { group_id: string; command_id: string }[];
  /** Notices this installation retried or dismissed. */
  resolved: Set<string>;
  unfinishedJoins: Map<string, UnfinishedJoin>;
};

type Simulation = {
  groupIds: string[];
  faults: Map<string, Fault>;
  open: (device: Device, tab: number) => SplitnextSyncClient;
  /** The group as the server holds it, for what a shared link's preview shows. */
  serverSnapshot: (groupId: string) => GroupSnapshot;
};

/** What a step that reports success promises about its group afterwards. */
type Promised = 'shown' | 'hidden' | null;

/**
 * One installation's storage. A chosen operation fails without saving, as
 * when the disk is full or the browser closes the database; an update still
 * runs its change first, as it does before a failed commit.
 */
class FlakyStorage implements ClientStorageAdapter {
  private readonly saved = new MemoryClientStorage();
  /** Operations that succeed before the next one fails; null when none will. */
  private remaining: number | null = null;

  failAfter(operations: number | null): void {
    this.remaining = operations;
  }

  async read(): Promise<string | null> {
    if (this.fails()) throw storageFailure();

    return this.saved.read();
  }

  async update<T>(change: (current: string | null) => ClientStorageUpdate<T>): Promise<T> {
    if (!this.fails()) return this.saved.update(change);

    change(await this.saved.read());

    throw storageFailure();
  }

  private fails(): boolean {
    if (this.remaining === null) return false;

    if (this.remaining > 0) {
      this.remaining -= 1;

      return false;
    }

    this.remaining = null;

    return true;
  }
}

function storageFailure(): Error {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

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
        activity: (groupId, context) => deliver(() => device.activity(groupId, context)),
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
      if (event.kind === 'command_queued') device.queued.push({ group_id: event.group_id, command_id: event.command_id });
    });
    device.tabs[tab] = client;

    return client;
  }

  function serverSnapshot(groupId: string): GroupSnapshot {
    const snapshot = server.repository(groupId)?.state?.snapshot;

    if (!snapshot) throw new Error('missing_server_group');

    return snapshot;
  }

  const hasAccess = (device: Device, groupId: string) =>
    serverSnapshot(groupId).access_grants.some((grant) => grant.identity_id === device.identityId);

  const devices = Array.from({ length: deviceCount }, (): Device => {
    const device: Device = {
      secret: createDeviceSecret(), identityId: '', storage: new FlakyStorage(), tabs: [],
      queued: [], resolved: new Set(), unfinishedJoins: new Map(),
    };

    for (let tab = 0; tab < tabCount; tab += 1) open(device, tab);

    return device;
  });

  const first = (device: Device | undefined) => {
    const client = device?.tabs[0];

    if (!client) throw new Error('missing_tab');

    return client;
  };

  for (const device of devices) device.identityId = (await first(device).initializeIdentity()).identity.id;

  async function createGroup(device: Device | undefined, name: string, creatorName: string): Promise<string> {
    return (await first(device).createGroup({ name, creator_member_name: creatorName })).group_id;
  }

  async function joinThroughLink(device: Device | undefined, groupId: string, name: string): Promise<void> {
    await first(device).joinGroup(groupId, { kind: 'new', display_name: name }, serverSnapshot(groupId).invite.token);
  }

  const [ana, ben, cy] = devices;
  const trip = await createGroup(ana, 'Trip', 'Ana');

  await joinThroughLink(ben, trip, 'Ben');
  await joinThroughLink(cy, trip, 'Cy');
  const ski = await createGroup(ben, 'Ski', 'Ben');

  await joinThroughLink(cy, ski, 'Dee');
  const groupIds = [trip, ski];

  for (const device of devices) {
    for (const groupId of groupIds) {
      if (hasAccess(device, groupId)) for (const tab of device.tabs) tab.watchGroup(groupId);
    }
  }

  const simulation: Simulation = { groupIds, faults, open, serverSnapshot };
  const running: Promise<void>[] = [];

  for (const step of steps) {
    const device = devices[step.device];
    const groupId = groupIds[step.group];

    if (!device || !groupId) throw new Error('missing_device_or_group');

    if (!step.concurrent) await Promise.all(running.splice(0));

    const run = perform(simulation, device, groupId, step).then(async (promised) => {
      const state = await first(device).inspect(groupId);

      if (promised) expect(state.hidden).toBe(promised === 'hidden');

      // Someone who sees the group again has no reason to repeat a lost join.
      if (state.projected_snapshot && !state.hidden) device.unfinishedJoins.delete(groupId);

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

  for (const device of devices) {
    device.storage.failAfter(null);

    for (const tab of device.tabs) tab.setOnline(true);
  }

  for (const device of devices) {
    for (const [groupId, unfinished] of device.unfinishedJoins) {
      const state = await first(device).inspect(groupId);

      // Background synchronization may already have shown the group again.
      if (state.projected_snapshot && !state.hidden) continue;

      // Someone joining for the first time asks for the current link.
      const token = unfinished.invited ? serverSnapshot(groupId).invite.token : undefined;

      await join(first(device), groupId, unfinished.choice, token, noFaults, false);
    }
  }

  for (let round = 0; round < 3; round += 1) {
    for (const device of devices) {
      for (const tab of device.tabs) {
        for (const groupId of groupIds) if (hasAccess(device, groupId)) await tab.refreshGroup(groupId);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  // Background synchronization only ever fails because of an injected fault.
  expect(backgroundErrors.filter((error) => !injectedFailure(error))).toEqual([]);

  for (const groupId of groupIds) {
    const recorded = server.repository(groupId);

    if (!recorded?.state) throw new Error('missing_server_group');
    const { revision, snapshot } = recorded.state;

    expectValidSnapshot(snapshot);

    for (const device of devices) {
      const replica = await first(device).inspect(groupId);

      // Only those the server admitted hold a copy, and theirs matches it.
      if (!hasAccess(device, groupId)) {
        expect(replica.projected_snapshot).toBeNull();
        continue;
      }

      expect(replica.outbox).toEqual([]);
      expect(replica.revision).toBe(revision);
      expect(replica.confirmed_snapshot).toEqual(snapshot);
      expect(replica.projected_snapshot).toEqual(snapshot);
    }

    // Every queued command reached the server exactly once.
    const outcomes = recorded.command_outcomes;
    const outcomeIds = outcomes.map((entry) => entry.command_id);

    const queuedIds = devices.flatMap((device) =>
      device.queued.flatMap((entry) => (entry.group_id === groupId ? [entry.command_id] : [])),
    );

    expect(new Set(outcomeIds).size).toBe(outcomeIds.length);
    expect(new Set(queuedIds).size).toBe(queuedIds.length);
    expect(new Set(outcomeIds)).toEqual(new Set(queuedIds));

    // Each revision is one applied transition with one audit event.
    expect(recorded.audit_events.map((event) => event.revision)).toEqual(
      Array.from({ length: revision }, (_, index) => index + 1),
    );

    // Every unsuccessful command stays visible until its device resolves it,
    // and a notice the device retried or dismissed never comes back.
    for (const device of devices) {
      const replica = await first(device).inspect(groupId);
      const noticed = new Map(replica.notices.map((notice) => [notice.outcome.command_id, notice.outcome]));
      const queued = device.queued.map((entry) => entry.command_id);

      for (const entry of outcomes) {
        const unsuccessful = entry.outcome.status === 'rejected' || entry.outcome.status === 'superseded';

        if (!unsuccessful || !queued.includes(entry.command_id) || device.resolved.has(entry.command_id)) continue;
        expect(noticed.get(entry.command_id)).toEqual(entry.outcome);
      }

      for (const commandId of noticed.keys()) {
        expect(queued).toContain(commandId);
        expect(device.resolved.has(commandId)).toBe(false);
      }
    }
  }

  // Each device lists exactly the groups the server lets it access, as named there.
  const byGroup = (left: { group_id: string }, right: { group_id: string }) => left.group_id.localeCompare(right.group_id);

  for (const device of devices) {
    const listed = (await first(device).listGroups()).map(({ group_id, name, status, stored_locally, pending_commands }) => (
      { group_id, name, status, stored_locally, pending_commands }
    ));

    const expected = groupIds.flatMap((groupId) => {
      const snapshot = serverSnapshot(groupId);
      const grant = snapshot.access_grants.find((entry) => entry.identity_id === device.identityId);

      return grant
        ? [{ group_id: groupId, name: snapshot.group.name, status: grant.hidden_at ? 'left' : 'active', stored_locally: true, pending_commands: 0 }]
        : [];
    });

    expect(listed.sort(byGroup)).toEqual(expected.sort(byGroup));
  }
}

/**
 * Runs one step the way the app would, skipping what the app would not offer,
 * and returns what its success promises about the group's visibility.
 */
async function perform(simulation: Simulation, device: Device, groupId: string, step: Step): Promise<Promised> {
  const { faults } = simulation;
  const { action } = step;
  // Concurrent steps could consume each other's faults, so only sequential ones inject them.
  const injected: Injected = step.concurrent ? noFaults : { network: step.fault, storage: step.storage };
  const client = device.tabs[step.tab];

  if (!client) throw new Error('missing_tab');
  const installation = await client.installationState(simulation.groupIds);
  const state = installation.replicas.find((replica) => replica.group_id === groupId);

  if (!state) throw new Error('missing_replica_state');
  const snapshot = state.projected_snapshot;
  const online = client.isOnline();
  const notice = (index: number) => state.notices[index % Math.max(state.notices.length, 1)];

  const act = async (): Promise<Promised> => {
    switch (action.kind) {
      case 'goOffline':
        for (const tab of device.tabs) tab.setOnline(false);

        return null;
      case 'goOnline':
        for (const tab of device.tabs) tab.setOnline(true);

        return null;
      case 'reload': {
        const reloaded = simulation.open(device, step.tab);

        reloaded.setOnline(online);
        await attempt(injected, () => reloaded.initializeIdentity());

        // The app watches every group it shows.
        for (const replica of installation.replicas) {
          if (replica.projected_snapshot && !replica.hidden) reloaded.watchGroup(replica.group_id);
        }

        return null;
      }

      case 'open': {
        if (!online) return null;

        // Opening synchronizes the group, fetching a left group's snapshot.
        if (snapshot) {
          await attempt(injected, () => state.hidden ? client.refreshGroup(groupId) : client.syncGroup(groupId));

          return null;
        }

        // A group only the server's list mentions is fetched when opened.
        if (installation.groups.some((group) => group.group_id === groupId) && await attempt(injected, () => client.syncGroup(groupId)))
          client.watchGroup(groupId);

        return null;
      }

      case 'readActivity': {
        if (snapshot) await attempt(injected, () => client.activity(groupId));

        return null;
      }

      case 'listGroups': {
        await attempt(injected, async () => {
          const listed = (await client.listGroups()).map((group) => group.group_id);

          expect(new Set(listed).size).toBe(listed.length);

          for (const listedId of listed) expect(simulation.groupIds).toContain(listedId);
        });

        return null;
      }

      case 'join': {
        if (!online || (snapshot && !state.hidden)) return null;

        // Someone new picks from the link's preview; someone rejoining, from their copy.
        const invited = !snapshot;
        const server = simulation.serverSnapshot(groupId);
        const choices = activeMembers(snapshot ?? server);
        const existing = action.member === null ? undefined : choices[action.member % choices.length];

        const choice: ClientPreferredMemberChoice = existing
          ? { kind: 'existing', member_id: existing.id }
          : { kind: 'new', display_name: action.name };

        const result = await join(client, groupId, choice, invited ? server.invite.token : undefined, injected, step.concurrent);

        if (result === 'unfinished') device.unfinishedJoins.set(groupId, { choice, invited });
        else device.unfinishedJoins.delete(groupId);

        if (result !== 'joined') return null;
        client.watchGroup(groupId);

        // A join that reports success shows the group.
        return step.concurrent ? null : 'shown';
      }

      case 'retryNotice': {
        const retried = notice(action.notice);

        if (!retried || state.hidden || (retried.command.type === 'group.leave' && !online)) return null;

        if (await attempt(injected, () => client.retryNotice(groupId, retried.command.command_id), step.concurrent))
          device.resolved.add(retried.command.command_id);

        return null;
      }

      case 'dismissNotice': {
        const dismissed = notice(action.notice);

        if (dismissed && await attempt(injected, () => client.dismissNotice(groupId, dismissed.command.command_id)))
          device.resolved.add(dismissed.command.command_id);

        return null;
      }

      case 'regenerateInvite':
        if (online && snapshot && !state.hidden) await attempt(injected, () => client.regenerateInvite(groupId));

        return null;
      case 'submit': {
        const intent = snapshot && intentFor(action.command, snapshot, state.activity);

        // The app offers commands only for a group it shows, and leaving only online.
        if (!intent || state.hidden || (requiresServerDecision(intent.type) && !online)) return null;
        const done = await attempt(injected, () => client.submit(groupId, intent));

        // A leave that reports success shows the group as left, even if its response was lost.
        return done && intent.type === 'group.leave' && !step.concurrent ? 'hidden' : null;
      }
    }
  };

  if (injected.network !== 'none') faults.set(device.secret, injected.network);
  device.storage.failAfter(injected.storage);

  try {
    return await act();
  } finally {
    if (injected.network !== 'none') faults.delete(device.secret);
    device.storage.failAfter(null);
  }
}

/** Failures a step injected: a lost request or response, or storage that could not save. */
function injectedFailure(error: Error): boolean {
  return error instanceof SplitnextNetworkError || (error instanceof ClientStorageError && error.code === 'storage_unavailable');
}

/**
 * Runs an operation, accepting only a failure the step injected and, when
 * tabs race, a notice another tab already resolved.
 */
async function attempt<T>(injected: Injected, operation: () => Promise<T>, racing = false): Promise<boolean> {
  try {
    await operation();

    return true;
  } catch (error) {
    if (error instanceof SplitnextNetworkError && injected.network !== 'none') return false;

    if (error instanceof ClientStorageError && error.code === 'storage_unavailable' && injected.storage !== null) return false;

    if (racing && error instanceof Error && error.message === 'notice_not_found') return false;

    throw error;
  }
}

/**
 * A join may race with the chosen member being removed meanwhile and, when
 * steps run together, with the link being replaced.
 */
async function join(
  client: SplitnextSyncClient,
  groupId: string,
  choice: ClientPreferredMemberChoice,
  token: string | undefined,
  injected: Injected,
  racing: boolean,
): Promise<'joined' | 'unfinished' | 'rejected'> {
  try {
    return (await attempt(injected, () => client.joinGroup(groupId, choice, token))) ? 'joined' : 'unfinished';
  } catch (error) {
    if (!(error instanceof SplitnextRequestError)) throw error;

    if (error.code === 'member_removed' || error.code === 'member_not_found') return 'rejected';

    if (racing && (error.code === 'invite_replaced' || error.code === 'invite_invalid')) return 'rejected';

    throw error;
  }
}

/** Rules that hold for every server snapshot and every local projection. */
function expectValidSnapshot(snapshot: GroupSnapshot): void {
  groupSnapshotSchema.parse(snapshot);
  const active = activeMembers(snapshot);

  expect(new Set(snapshot.members.map((entry) => entry.id)).size).toBe(snapshot.members.length);

  const deleted = new Set(snapshot.members.flatMap((entry) => (entry.status === 'deleted' ? [entry.id] : [])));

  for (const expense of snapshot.expenses) {
    const sum = (entries: readonly { amount: number }[]) => entries.reduce((total, entry) => total + entry.amount, 0);

    expect(sum(expense.allocations)).toBe(expense.total);
    expect(sum(expense.paid)).toBe(expense.total);
    expect(new Set(expense.extras).size).toBe(expense.extras.length);

    // A member any expense names, removed or not, is never deleted.
    for (const memberId of expenseMemberIds(expense)) expect(deleted.has(memberId)).toBe(false);
  }

  for (const settlement of snapshot.settlements) {
    expect(settlement.amount).toBeGreaterThan(0);
    expect(settlement.from_member_id).not.toBe(settlement.to_member_id);

    for (const memberId of [settlement.from_member_id, settlement.to_member_id]) {
      expect(snapshot.members.some((member) => member.id === memberId)).toBe(true);
      expect(deleted.has(memberId)).toBe(false);
    }
  }

  for (const balances of Object.values(groupBalances(snapshot)))
    expect(Object.values(balances).reduce((total, amount) => total + amount, 0)).toBe(0);

  for (const grant of snapshot.access_grants) {
    if (grant.hidden_at) expect(grant.preferred_member_id).toBeNull();

    if (grant.preferred_member_id) expect(active.map((entry) => entry.id)).toContain(grant.preferred_member_id);
  }
}

const leave = { kind: 'submit', command: { type: 'group.leave' } } as const;

const sequential = { tab: 0, group: 0, storage: null, concurrent: false } as const;

const together = { tab: 0, group: 0, storage: null, concurrent: true, fault: 'none' } as const;

/** Rare sequences worth checking on every run; each found a bug once. */
const examples: [Step[]][] = [
  // A rejoin whose response was lost must not be replayed after leaving again.
  [[
    { ...sequential, device: 1, fault: 'none', action: leave },
    { ...sequential, device: 1, fault: 'lose_response', action: { kind: 'join', member: null, name: 'Dee' } },
    { ...sequential, device: 1, fault: 'none', action: { kind: 'open' } },
    { ...sequential, device: 1, fault: 'none', action: leave },
    { ...sequential, device: 1, fault: 'none', action: { kind: 'join', member: 0, name: 'Dee' } },
  ]],
  // A leave whose request was lost reaches the server before a rejoin.
  [[
    { ...sequential, device: 0, fault: 'lose_request', action: leave },
    { ...sequential, device: 0, fault: 'none', action: { kind: 'join', member: null, name: 'Ana' } },
  ]],
  // Choosing who you are, queued alongside leaving, cannot apply after the leave.
  [[
    { ...together, device: 1, action: leave },
    { ...together, device: 1, action: { kind: 'submit', command: { type: 'preference.set', member: 0 } } },
  ]],
  // A replaced link whose follow-up sync finds the device offline still succeeds.
  [[
    { ...together, device: 1, action: { kind: 'regenerateInvite' } },
    { ...together, device: 1, action: { kind: 'goOffline' } },
  ]],
  // A retry saved to the outbox succeeds even if storage fails while delivering
  // it, and the other tab's late response does not bring back the retired notice.
  [[
    { ...sequential, device: 0, fault: 'none', action: { kind: 'submit', command: { type: 'member.rename', member: 0, name: 'Cy' } } },
    { ...sequential, device: 0, fault: 'none', storage: 1, action: { kind: 'retryNotice', notice: 0 } },
  ]],
  // A dismissal that was saved is not reported as failed.
  [[
    { ...sequential, device: 2, fault: 'none', action: { kind: 'submit', command: { type: 'member.rename', member: 0, name: 'Cy' } } },
    { ...sequential, device: 2, fault: 'none', storage: 1, action: { kind: 'dismissNotice', notice: 0 } },
  ]],
  // A join whose request was lost, retried with a fresh link after the old one was replaced.
  [[
    { ...sequential, group: 1, device: 0, fault: 'lose_request', action: { kind: 'join', member: null, name: 'Ana' } },
    { ...sequential, group: 1, device: 1, fault: 'none', action: { kind: 'regenerateInvite' } },
    { ...sequential, group: 1, device: 0, fault: 'none', action: { kind: 'join', member: null, name: 'Ana' } },
  ]],
];

describe('offline synchronization', () => {
  it('converges every device on the server state with one outcome per command', async () => {
    const steps = fc.array(stepArbitrary, { minLength: 1, maxLength: 60, size: 'max' });

    await fc.assert(fc.asyncProperty(steps, simulate), { numRuns: 100, examples });
  }, 120_000);
});
