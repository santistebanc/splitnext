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
 * offline, flaky, or reloading, once everyone reconnects they converge on the
 * server's state, and every command receives exactly one outcome. A failure
 * prints the shrunk list of steps that breaks it; pass the printed seed and
 * path to `fc.assert` to replay it.
 *
 * To cover a new command, add a generator for it to `commandArbitrary`.
 */

const deviceCount = 3;

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
  fault: faultArbitrary,
  action: actionArbitrary,
});

type Step = typeof stepArbitrary extends fc.Arbitrary<infer T> ? T : never;

type Device = {
  secret: string;
  storage: MemoryClientStorage;
  client: SplitnextSyncClient;
  /** Every command this installation queued, from its diagnostics. */
  queued: string[];
  /** Notices this installation retried or dismissed. */
  resolved: Set<string>;
  /** A rejoin the person started but never saw finish; they try it again. */
  unfinishedJoin: ClientPreferredMemberChoice | null;
};

type Simulation = {
  groupId: string;
  faults: Map<string, Fault>;
  connect: (device: Device) => void;
};

/** Loses one request or its response, as a flaky network would. */
function flakyTransport(api: SyncTransport, faults: Map<string, Fault>): SyncTransport {
  return {
    createAnonymousIdentity: (secret) => api.createAnonymousIdentity(secret),
    forDevice: (secret): SyncDeviceTransport => {
      const device = api.forDevice(secret);

      async function deliver<T>(request: () => Promise<T>): Promise<T> {
        const fault = faults.get(secret) ?? 'none';

        faults.delete(secret);

        if (fault === 'lose_request') throw new SplitnextNetworkError(new TypeError('request_lost'));
        const result = await request();

        if (fault === 'lose_response') throw new SplitnextNetworkError(new TypeError('response_lost'));

        return result;
      }

      return {
        currentIdentity: () => deliver(() => device.currentIdentity()),
        createGroup: (input, context) => deliver(() => device.createGroup(input, context)),
        joinGroup: (groupId, input, context) => deliver(() => device.joinGroup(groupId, input, context)),
        syncGroup: (groupId, input, context) => deliver(() => device.syncGroup(groupId, input, context)),
        regenerateInvite: (groupId, input, context) => deliver(() => device.regenerateInvite(groupId, input, context)),
        previewInvite: (groupId, token, context) => deliver(() => device.previewInvite(groupId, token, context)),
        listGroups: (context) => deliver(() => device.listGroups(context)),
        openRealtime: (groupId, handlers) => device.openRealtime(groupId, handlers),
      };
    },
  };
}

async function simulate(steps: readonly Step[]): Promise<void> {
  const now = new Date().toISOString();
  const session = { identity: { id: createIdentifier(), created_at: now }, device: { id: createIdentifier(), created_at: now } };
  const server = await memoryTransport(session, [], { connection: 'online', latency: 0, failure: 'none', log: () => undefined });
  const faults = new Map<string, Fault>();
  const api = flakyTransport(server.api, faults);

  function connect(device: Device): void {
    device.client = new SplitnextSyncClient({ api, storage: device.storage, device_secret: device.secret });
    device.client.observeDiagnostics((event) => {
      if (event.kind === 'command_queued') device.queued.push(event.command_id);
    });
  }

  const devices = Array.from({ length: deviceCount }, (): Device => {
    const storage = new MemoryClientStorage();
    const secret = randomDeviceSecret();

    const device: Device = {
      secret, storage, client: new SplitnextSyncClient({ api, storage, device_secret: secret }),
      queued: [], resolved: new Set(), unfinishedJoin: null,
    };

    connect(device);

    return device;
  });

  const [creator, ...joiners] = devices;

  if (!creator) throw new Error('missing_creator');
  await creator.client.initializeIdentity();
  const created = await creator.client.createGroup({ name: 'Trip', creator_member_name: 'Ana' });
  const groupId = created.group_id;
  const token = created.projected_snapshot?.invite.token;

  if (!token) throw new Error('missing_invite');

  for (const [index, device] of joiners.entries()) {
    await device.client.initializeIdentity();
    await device.client.joinGroup(groupId, { kind: 'new', display_name: memberNames[index + 2] ?? 'Dee' }, token);
  }

  const simulation: Simulation = { groupId, faults, connect };

  for (const step of steps) {
    const device = devices[step.device];

    if (!device) throw new Error('missing_device');
    await perform(simulation, device, step);
    const state = await device.client.inspect(groupId);

    // Someone who sees the group again has no reason to repeat a lost rejoin.
    if (!state.hidden) device.unfinishedJoin = null;

    if (state.projected_snapshot) expectValidSnapshot(state.projected_snapshot);
  }

  // Everyone reconnects, finishes what they started, and synchronizes twice:
  // the first round delivers every outbox, the second observes the result.
  faults.clear();

  for (const device of devices) device.client.setOnline(true);

  for (const device of devices) {
    if (device.unfinishedJoin) await rejoin(device.client, groupId, device.unfinishedJoin, 'none');
  }

  for (let round = 0; round < 2; round += 1) {
    for (const device of devices) await device.client.refreshGroup(groupId);
  }

  const recorded = server.repository(groupId);

  if (!recorded?.state) throw new Error('missing_server_group');
  const { revision, snapshot } = recorded.state;

  expectValidSnapshot(snapshot);

  for (const device of devices) {
    const replica = await device.client.inspect(groupId);

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
    const replica = await device.client.inspect(groupId);
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
  const { action, fault } = step;
  const client = device.client;
  const state = await client.inspect(groupId);
  const snapshot = state.projected_snapshot;
  const online = client.isOnline();

  if (!snapshot) throw new Error('missing_replica');
  const notice =(index: number) => state.notices[index % Math.max(state.notices.length, 1)];

  faults.set(device.secret, fault);

  try {
    switch (action.kind) {
      case 'goOffline':
        client.setOnline(false);

        return;
      case 'goOnline':
        client.setOnline(true);

        return;
      case 'reload':
        simulation.connect(device);
        device.client.setOnline(online);
        await attempt(fault, () => device.client.initializeIdentity());

        return;
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
        if (result === 'joined') expect((await client.inspect(groupId)).hidden).toBe(false);

        return;
      }

      case 'retryNotice': {
        const retried = notice(action.notice);

        if (!retried || state.hidden || (retried.command.type === 'group.leave' && !online)) return;
        await attempt(fault, () => client.retryNotice(groupId, retried.command.command_id));
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
        await attempt(fault, () => client.submit(groupId, intent));

        return;
      }
    }
  } finally {
    faults.delete(device.secret);
  }
}

/** Runs an operation, accepting only a network failure the step injected. */
async function attempt<T>(fault: Fault, operation: () => Promise<T>): Promise<boolean> {
  try {
    await operation();

    return true;
  } catch (error) {
    if (error instanceof SplitnextNetworkError && fault !== 'none') return false;

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

/** Rare sequences worth checking on every run; each found a bug once. */
const examples: [Step[]][] = [
  // A rejoin whose response was lost must not be replayed after leaving again.
  [[
    { device: 1, fault: 'none', action: leave },
    { device: 1, fault: 'lose_response', action: { kind: 'rejoin', member: null, name: 'Dee' } },
    { device: 1, fault: 'none', action: { kind: 'open' } },
    { device: 1, fault: 'none', action: leave },
    { device: 1, fault: 'none', action: { kind: 'rejoin', member: 0, name: 'Dee' } },
  ]],
  // A leave whose request was lost reaches the server before a rejoin.
  [[
    { device: 0, fault: 'lose_request', action: leave },
    { device: 0, fault: 'none', action: { kind: 'rejoin', member: null, name: 'Ana' } },
  ]],
];

describe('offline synchronization', () => {
  it('converges every device on the server state with one outcome per command', async () => {
    const steps = fc.array(stepArbitrary, { minLength: 1, maxLength: 60, size: 'max' });

    await fc.assert(fc.asyncProperty(steps, simulate), { numRuns: 200, examples });
  }, 120_000);
});
