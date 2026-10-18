import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { createInviteToken } from '../src/domain/invites';
import { applyTestMigrations } from './harness';

const createdGroupSchema = z.object({
  group: z.object({ id: identifierSchema, revision: z.number() }),
  member: z.object({ id: identifierSchema, display_name: z.string() }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('expense sync commands', () => {
  it('records, edits, removes, and restores an expense, keeping its member from deletion', async () => {
    const fixture = await createGroupFixture('x');
    const santi = fixture.created.member.id;
    const expenseId = createIdentifier();

    const entry = {
      description: 'Dinner', currency: 'EUR', total: 1001, paid_by: santi,
      parts: [{ kind: 'shares', member_id: santi, shares: 1 }],
    };

    const recorded = await sync(fixture, 1, [
      { command_id: createIdentifier(), type: 'expense.record', payload: { expense_id: expenseId, ...entry } },
      { command_id: createIdentifier(), type: 'expense.edit', payload: { expense_id: expenseId, expected_version: 1, ...entry, total: 2000 } },
      { command_id: createIdentifier(), type: 'expense.remove', payload: { expense_id: expenseId } },
      { command_id: createIdentifier(), type: 'member.remove', payload: { member_id: santi } },
      { command_id: createIdentifier(), type: 'expense.restore', payload: { expense_id: expenseId } },
    ]);

    expect(await recorded.json()).toMatchObject({
      revision: 6,
      outcomes: [
        { command_type: 'expense.record', status: 'applied', server_state: { kind: 'expense', expense: { total: 1001, version: 1 } } },
        { command_type: 'expense.edit', status: 'applied', server_state: { expense: { total: 2000, version: 2 } } },
        { command_type: 'expense.remove', status: 'applied', server_state: { expense: { status: 'removed' } } },
        // The removed expense can come back, so it still keeps Santi.
        { command_type: 'member.remove', status: 'applied', server_state: { member: { status: 'hidden' } } },
        { command_type: 'expense.restore', status: 'applied', server_state: { expense: { status: 'active', total: 2000, version: 4 } } },
      ],
      state: {
        snapshot: {
          members: [{ id: santi, status: 'hidden' }],
          expenses: [{ id: expenseId, allocations: [{ member_id: santi, amount: 2000 }], status: 'active' }],
        },
      },
    });
  });

  it('rejects a malformed expense at the wire', async () => {
    const fixture = await createGroupFixture('y');

    const response = await sync(fixture, 1, [
      {
        command_id: createIdentifier(),
        type: 'expense.record',
        payload: {
          expense_id: createIdentifier(), description: 'Dinner', currency: 'euro', total: 10.5,
          paid_by: fixture.created.member.id, parts: [],
        },
      },
    ]);

    expect(response.status).toBe(400);
  });
});

async function createGroupFixture(seed: string) {
  const deviceSecret = seed.repeat(43);

  await exports.default.fetch('https://splitnext.test/identities/anonymous', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_secret: deviceSecret }),
  });

  const response = await exports.default.fetch('https://splitnext.test/groups', {
    method: 'POST',
    headers: requestHeaders(deviceSecret),
    body: JSON.stringify({
      group_id: createIdentifier(),
      name: 'Berlin flat',
      creator_member_name: 'Santi',
      invite: { invite_id: createIdentifier(), token: createInviteToken() },
    }),
  });

  return { deviceSecret, created: createdGroupSchema.parse(await response.json()) };
}

function sync(fixture: Awaited<ReturnType<typeof createGroupFixture>>, knownRevision: number | null, commands: unknown[]) {
  return exports.default.fetch(`https://splitnext.test/groups/${fixture.created.group.id}/sync`, {
    method: 'POST',
    headers: requestHeaders(fixture.deviceSecret),
    body: JSON.stringify({ known_revision: knownRevision, commands }),
  });
}

function requestHeaders(deviceSecret: string) {
  return {
    authorization: `Bearer v1.${deviceSecret}`,
    'content-type': 'application/json',
  };
}
