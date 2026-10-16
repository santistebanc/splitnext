import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MemoryClientStorage, SplitnextSyncClient, formatInviteLink, type JsonValue } from '../src/client';
import { createIdentifier } from '../src/domain/ids';
import { createInviteToken } from '../src/domain/invites';
import { memoryTransport } from '../src/memoryTransport';
import { AppController } from '../apps/client/src/model/controller';
import { createDispatcher, describeActions } from '../apps/client/src/model/actions';
import { buildInput, formFields, parseSchema, type FormField, type FormValues } from '../apps/client/src/devtools/form';
import { sourceOptions, type InputState } from '../apps/client/src/model/actionInputs';
import { createDeviceSecret } from './harness';

/**
 * Model-based check of the app action layer, driven the way any generic
 * caller drives it: pick an action from the catalog, fill its JSON Schema
 * inputs from app state or a small pool of values, and dispatch it against
 * the real controller, SDK, and in-memory group engine, sometimes twice
 * before the first finishes, as a double click or an impatient assistant
 * would.
 */

const appUrl = 'https://splitnext.test';

const actionNames = describeActions().map((action) => action.name);

const callArbitrary = fc.record({
  action: fc.nat(),
  // Usually an action available now, as a person or assistant would choose.
  fromAvailable: fc.nat({ max: 4 }).map((roll) => roll > 0),
  picks: fc.array(fc.nat({ max: 99 }), { minLength: 8, maxLength: 8 }),
  confirmed: fc.boolean(),
});

type Call = typeof callArbitrary extends fc.Arbitrary<infer T> ? T : never;

const stepArbitrary = fc.oneof(
  { weight: 10, arbitrary: fc.record({ kind: fc.constant('dispatch' as const), call: callArbitrary }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('together' as const),
      first: callArbitrary,
      // A double click repeats the first call; otherwise the second is chosen once the first has started.
      second: fc.option(callArbitrary),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('connection' as const), online: fc.boolean() }) },
);

type Step = typeof stepArbitrary extends fc.Arbitrary<infer T> ? T : never;

/** Field values chosen by the step's picks, preferring choices from app state. */
function valuesFor(fields: FormField[], picks: number[], state: InputState, pool: string[]): FormValues {
  let index = 0;
  const next = () => picks[index++ % picks.length] ?? 0;
  const values: FormValues = {};

  function fill(field: FormField): void {
    switch (field.kind) {
      case 'select':
        values[field.path] = field.options[next() % field.options.length] ?? '';

        return;
      case 'boolean':
        values[field.path] = next() % 2 === 0;

        return;
      case 'number':
        values[field.path] = String(next() % 3);

        return;
      case 'variant': {
        const variant = field.variants[next() % field.variants.length];

        if (!variant) return;
        values[`${field.path}.${field.discriminator}`] = variant.value;
        variant.fields.forEach(fill);

        return;
      }

      case 'text': {
        const offered = field.source ? sourceOptions(field.source, state, appUrl).map((option) => option.value) : [];
        const candidates = field.strict && offered.length ? offered : [...offered, ...pool];

        values[field.path] = candidates[next() % candidates.length] ?? '';
      }
    }
  }

  fields.forEach(fill);

  return values;
}

async function simulate(steps: readonly Step[]): Promise<void> {
  const now = new Date().toISOString();
  const session = { identity: { id: createIdentifier(), created_at: now }, device: { id: createIdentifier(), created_at: now } };
  const server = await memoryTransport(session, [], { connection: 'online', latency: 0, failure: 'none', log: () => undefined });

  // Someone else's group, so invites can be checked and joined.
  const otherSecret = createDeviceSecret();

  await server.api.createAnonymousIdentity(otherSecret);
  const remote = { groupId: createIdentifier(), token: createInviteToken() };

  await server.api.forDevice(otherSecret).createGroup({
    group_id: remote.groupId, name: 'Remote', creator_member_name: 'Zoe',
    invite: { invite_id: createIdentifier(), token: remote.token },
  });

  const pool = ['', 'Ana', 'ana', 'Ben', 'Trip', 'Lisbon', remote.groupId, remote.token,
    formatInviteLink(appUrl, remote.groupId, remote.token), `${appUrl}/join/unknown`];

  const client = new SplitnextSyncClient({ api: server.api, storage: new MemoryClientStorage(), device_secret: createDeviceSecret() });
  let lastGroup: string | null = null;
  let lastName: string | null = null;

  const app = new AppController(client, {
    lastGroup: () => lastGroup,
    rememberGroup: (groupId) => { lastGroup = groupId; },
    lastYouName: () => lastName,
    rememberYouName: (name) => { lastName = name; },
  });

  await app.start(true);

  const actions = createDispatcher(app, {
    appUrl, copyText: async () => undefined, shareLink: async () => undefined, openHomepage: () => undefined,
  });

  const described = new Map(actions.describe().map((action) => [action.name, action]));
  const trace: string[] = [];

  /** The action and input a caller would choose for a call in the current state. */
  function choose(call: Call): Chosen {
    const available = actionNames.filter((candidate) => actions.availability(candidate).available);
    const choices = call.fromAvailable && available.length ? available : actionNames;
    const name = choices[call.action % choices.length];
    const description = name && described.get(name);

    if (!name || !description) throw new Error('missing_action');
    const fields = formFields(parseSchema(description.inputSchema));

    // Like a caller trying inputs, take the first variant availability accepts.
    const variants = call.picks.map((_, shift): JsonValue =>
      buildInput(fields, valuesFor(fields, [...call.picks.slice(shift), ...call.picks.slice(0, shift)], actions.state(), pool)));

    const input = (call.fromAvailable && variants.find((candidate) => actions.availability(name, candidate).available)) || variants[0] || {};

    return { name, input, confirmed: call.confirmed };
  }

  /** Dispatches a call, remembering the availability it was dispatched under. */
  function start(chosen: Chosen) {
    const before = actions.availability(chosen.name, chosen.input);

    return { ...chosen, before, outcome: actions.dispatchJson(chosen.name, chosen.input, { confirmed: chosen.confirmed, origin: 'model' }) };
  }

  /**
   * Dispatch enforces exactly the answer availability gave when it was
   * called, and an available action fails only for what only the server can
   * decide, even while another dispatch is running.
   */
  async function expectAgrees(started: ReturnType<typeof start>, prefix = ''): Promise<void> {
    const { name, input, before } = started;
    const outcome = await started.outcome;

    trace.push(`${prefix}${name} ${JSON.stringify(input)} → ${outcome.status}${outcome.status === 'failed' ? ` ${outcome.error}` : ''}`);

    if (!before.available) expect(outcome, trace.join('\n')).toMatchObject({ status: 'failed', error: before.error });
    else if (outcome.status === 'failed') expect(serverDecides(name, outcome.error), trace.join('\n')).toBe(true);
  }

  try {
    for (const step of steps) {
      switch (step.kind) {
        case 'connection':
          trace.push(step.online ? 'online' : 'offline');
          await app.setOnline(step.online);

          continue;
        case 'dispatch':
          await expectAgrees(start(choose(step.call)));
          break;
        case 'together': {
          const first = start(choose(step.first));
          // Chosen and checked while the first call runs.
          const second = start(step.second ? choose(step.second) : first);

          await Promise.all([first.outcome, second.outcome]);
          await expectAgrees(first, '‖ ');
          await expectAgrees(second, '‖ ');
        }
      }

      expectSettled(actions.state(), trace.join('\n'));
    }
  } finally {
    app.dispose();
  }
}

type Chosen = { name: (typeof actionNames)[number]; input: JsonValue; confirmed: boolean };

/**
 * Joining someone else's group depends on members and invites only the
 * server knows until the invite is previewed.
 */
function serverDecides(name: string, error: string): boolean {
  return ['checkInvite', 'joinGroup', 'submitJoin'].includes(name) &&
    ['member_not_found', 'member_archived', 'invite_invalid', 'invite_replaced', 'invite_required', 'group_not_found'].includes(error);
}

/** After every awaited dispatch nothing is running and each view has its context. */
function expectSettled(state: ReturnType<ReturnType<typeof createDispatcher>['state']>, trace: string): void {
  const group = state.group;
  const open = Boolean(group?.projected_snapshot && !group.hidden);

  expect(state.executions, trace).toEqual([]);
  expect(['ready', 'editing', 'link', 'choosing'], trace).toContain(state.ui.phase);

  if (state.ui.view === 'settings' || state.ui.view === 'invite') expect(open, `${state.ui.view} without an open group:\n${trace}`).toBe(true);

  if (state.ui.view === 'notices') expect(group, `notices without a group:\n${trace}`).toBeTruthy();

  if (state.ui.view === 'rejoin') expect(group?.hidden, `rejoin without a left group:\n${trace}`).toBe(true);

  if (state.ui.memberEdit) {
    expect(state.ui.view, trace).toBe('home');
    expect(open, `member editor without an open group:\n${trace}`).toBe(true);
  }
}

describe('app actions under generated use', () => {
  it('dispatch agrees with availability and always settles', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArbitrary, { minLength: 1, maxLength: 60, size: 'max' }), simulate),
      { numRuns: 150 },
    );
  }, 180_000);
});
