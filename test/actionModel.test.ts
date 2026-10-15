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
import { randomDeviceSecret } from './harness';

/**
 * Model-based check of the app action layer, driven the way any generic
 * caller drives it: pick an action from the catalog, fill its JSON Schema
 * inputs from app state or a small pool of values, and dispatch it against
 * the real controller, SDK, and in-memory group engine.
 */

const appUrl = 'https://splitnext.test';

const actionNames = describeActions().map((action) => action.name);

const stepArbitrary = fc.oneof(
  {
    weight: 12,
    arbitrary: fc.record({
      kind: fc.constant('dispatch' as const),
      action: fc.nat(),
      // Usually an action available now, as a person or assistant would choose.
      fromAvailable: fc.nat({ max: 4 }).map((roll) => roll > 0),
      picks: fc.array(fc.nat({ max: 99 }), { minLength: 8, maxLength: 8 }),
      confirmed: fc.boolean(),
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
  const otherSecret = randomDeviceSecret();

  await server.api.createAnonymousIdentity(otherSecret);
  const remote = { groupId: createIdentifier(), token: createInviteToken() };

  await server.api.forDevice(otherSecret).createGroup({
    group_id: remote.groupId, name: 'Remote', creator_member_name: 'Zoe',
    invite: { invite_id: createIdentifier(), token: remote.token },
  });

  const pool = ['', 'Ana', 'ana', 'Ben', 'Trip', 'Lisbon', remote.groupId, remote.token,
    formatInviteLink(appUrl, remote.groupId, remote.token), `${appUrl}/join/unknown`];

  const client = new SplitnextSyncClient({ api: server.api, storage: new MemoryClientStorage(), device_secret: randomDeviceSecret() });
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
    appUrl, copyLink: async () => undefined, shareLink: async () => undefined, openHomepage: () => undefined,
  });

  const described = new Map(actions.describe().map((action) => [action.name, action]));
  const trace: string[] = [];

  try {
    for (const step of steps) {
      if (step.kind === 'connection') {
        trace.push(step.online ? 'online' : 'offline');
        await app.setOnline(step.online);
        continue;
      }

      const available = actionNames.filter((candidate) => actions.availability(candidate).available);
      const choices = step.fromAvailable && available.length ? available : actionNames;
      const name = choices[step.action % choices.length];
      const description = name && described.get(name);

      if (!name || !description) throw new Error('missing_action');
      const fields = formFields(parseSchema(description.inputSchema));

      // Like a caller trying inputs, take the first variant availability accepts.
      const variants = step.picks.map((_, shift): JsonValue =>
        buildInput(fields, valuesFor(fields, [...step.picks.slice(shift), ...step.picks.slice(0, shift)], actions.state(), pool)));

      const input = (step.fromAvailable && variants.find((candidate) => actions.availability(name, candidate).available)) || variants[0] || {};
      const before = actions.availability(name, input);
      const outcome = await actions.dispatchJson(name, input, { confirmed: step.confirmed, origin: 'model' });

      trace.push(`${name} ${JSON.stringify(input)} → ${outcome.status}${outcome.status === 'failed' ? ` ${outcome.error}` : ''}`);

      // Dispatch enforces exactly the answer availability gave, and an
      // available action fails only for what only the server can decide.
      if (!before.available) expect(outcome, trace.join('\n')).toMatchObject({ status: 'failed', error: before.error });
      else if (outcome.status === 'failed') expect(serverDecides(name, outcome.error), trace.join('\n')).toBe(true);

      expectSettled(actions.state(), trace.join('\n'));
    }
  } finally {
    app.dispose();
  }
}

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
