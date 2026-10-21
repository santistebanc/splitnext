import { settlementSuggestions } from '../src/domain/settlements';
import { describe, expect, it } from 'vitest';
import { applyGroupCommand, type GroupCommand } from '../src/domain/commands';
import { groupBalances, roundingBurden } from '../src/domain/expenses';
import type { GroupSnapshot } from '../src/domain/sync';

/**
 * How expenses live in a group: the rounding burden comes from the expenses
 * that are not removed, removed members stay reachable, and every currency's
 * balances net to zero. See ADR 0018 and ADR 0019.
 */

const at = '2026-01-01T00:00:00.000Z';

const id = (label: string) => label.padEnd(22, '_');

const me = id('identity-me');

const [ana, ben, cy] = [id('member-ana'), id('member-ben'), id('member-cy')];

let commands = 0;

/** A fresh command id, as each submission gets. */
const commandId = () => {
  commands += 1;

  return id(`command-${commands}`);
};

function start(): GroupSnapshot {
  return {
    group: { id: id('group'), name: 'Trip', created_at: at },
    members: [ana, ben, cy].map((memberId, index) => ({
      id: memberId, display_name: ['Ana', 'Ben', 'Cy'][index] ?? '', status: 'active', created_at: at, updated_at: at,
    })),
    expenses: [],
          settlements: [],
    access_grants: [{ identity_id: me, actor_handle: 'User 1', preferred_member_id: ana, granted_at: at, hidden_at: null }],
    invite: { id: id('invite'), created_by_identity_id: me, created_at: at, token: 't'.repeat(43) },
  };
}

function run(snapshot: GroupSnapshot, command: GroupCommand): GroupSnapshot {
  const transition = applyGroupCommand(snapshot, me, command, at);

  expect(transition.status).toBe('applied');

  return transition.snapshot;
}

/** 100 cents split equally three ways leaves one extra cent for someone. */
const thirds = (expenseId: string, total = 100, currency = 'EUR') => ({
  command_id: commandId(),
  type: 'expense.record' as const,
  payload: {
    expense_id: id(expenseId), description: 'Snacks', currency, total, paid_by: ana,
    parts: [ana, ben, cy].map((memberId) => ({ kind: 'shares' as const, member_id: memberId, shares: 1 })),
  },
});

const extrasOf = (snapshot: GroupSnapshot, expenseId: string) =>
  snapshot.expenses.find((expense) => expense.id === id(expenseId))?.extras;

describe('expenses in a group', () => {
  it('gives each extra unit to someone who has absorbed fewer, in that currency only', () => {
    let group = start();

    for (const expenseId of ['one', 'two', 'three']) group = run(group, thirds(expenseId));

    group = run(group, thirds('yen', 100, 'JPY'));

    const eur = ['one', 'two', 'three'].flatMap((expenseId) => extrasOf(group, expenseId) ?? []);

    expect(new Set(eur).size).toBe(3);
    expect(roundingBurden(group, 'EUR')).toEqual({ [ana]: 1, [ben]: 1, [cy]: 1 });
    expect(roundingBurden(group, 'JPY')).toEqual({ [ana]: 1 });
  });

  it('frees a removed expense’s extra unit and charges it again on restore', () => {
    let group = run(start(), thirds('one'));
    const [first] = extrasOf(group, 'one') ?? [];

    group = run(group, { command_id: commandId(), type: 'expense.remove', payload: { expense_id: id('one') } });
    expect(roundingBurden(group, 'EUR')).toEqual({});

    group = run(group, { command_id: commandId(), type: 'expense.restore', payload: { expense_id: id('one') } });
    expect(roundingBurden(group, 'EUR')).toEqual({ [first ?? '']: 1 });
    expect(group.expenses[0]?.allocations.map((entry) => entry.amount).sort()).toEqual([33, 33, 34]);
  });

  it('reallocates an edit without counting the expense’s own extra unit', () => {
    let group = run(start(), thirds('one'));
    const before = extrasOf(group, 'one');

    group = run(group, {
      command_id: commandId(),
      type: 'expense.edit',
      payload: { ...thirds('one').payload, description: 'Snacks and drinks', expected_version: 1 },
    });

    // Nobody else has absorbed anything, so the same member takes it again.
    expect(extrasOf(group, 'one')).toEqual(before);
    expect(roundingBurden(group, 'EUR')).toEqual({ [before?.[0] ?? '']: 1 });
  });

  it('keeps a deleted member an expense names, hidden, and hides rather than deletes a member with records', () => {
    let group = run(start(), { command_id: commandId(), type: 'member.remove', payload: { member_id: cy } });

    expect(group.members.find((member) => member.id === cy)?.status).toBe('deleted');

    const late = applyGroupCommand(group, me, thirds('late'), at);

    expect(late.status).toBe('applied');
    expect(late.snapshot.members.find((member) => member.id === cy)?.status).toBe('hidden');
    expect(late.audit).toMatchObject({ action: 'expense.recorded', after: { hidden_members: [{ id: cy, status: 'hidden' }] } });

    group = run(late.snapshot, { command_id: commandId(), type: 'member.restore', payload: { member_id: cy } });
    group = run(group, { command_id: commandId(), type: 'expense.remove', payload: { expense_id: id('late') } });
    group = run(group, { command_id: commandId(), type: 'member.remove', payload: { member_id: cy } });

    // A removed expense can be restored, so it still counts as a record.
    expect(group.members.find((member) => member.id === cy)?.status).toBe('hidden');
  });

  it('nets every currency to zero and leaves removed expenses out', () => {
    let group = run(start(), thirds('one'));

    group = run(group, thirds('yen', 999, 'JPY'));
    group = run(group, thirds('gone', 500));
    group = run(group, { command_id: commandId(), type: 'expense.remove', payload: { expense_id: id('gone') } });

    const balances = groupBalances(group);
    const sum = (currency: string) => Object.values(balances[currency] ?? {}).reduce((total, amount) => total + amount, 0);

    expect(Object.keys(balances).sort()).toEqual(['EUR', 'JPY']);
    expect(sum('EUR')).toBe(0);
    expect(sum('JPY')).toBe(0);
    expect(balances.EUR?.[ana]).toBe(100 - 33 - (extrasOf(group, 'one')?.includes(ana) ? 1 : 0));
  });
});


describe('repayments', () => {
  it('simplifies a debt chain without changing spending, rounding or another currency', () => {
    let group = start();

    for (const [payer, consumer] of [[ana, ben], [ben, cy]] as const) {
      group = run(group, { command_id: commandId(), type: 'expense.record', payload: { expense_id: commandId(), description: 'Loaned cost', currency: 'EUR', total: 1000, paid_by: payer, parts: [{ kind: 'shares', member_id: consumer, shares: 1 }] } });
    }

    group = run(group, thirds('yen', 99, 'JPY'));
    const before = group;
    const suggestion = settlementSuggestions(group).find((entry) => entry.currency === 'EUR');

    expect(suggestion).toEqual({ from_member_id: cy, to_member_id: ana, amount: 1000, currency: 'EUR' });
    expect(group.expenses).toHaveLength(3);

    if (!suggestion) throw new Error('missing suggestion');

    for (const amount of [300, 900]) group = run(group, { command_id: commandId(), type: 'settlement.record', payload: { ...suggestion, settlement_id: commandId(), amount } });

    expect(groupBalances(group).EUR).toEqual({ [ana]: -200, [ben]: 0, [cy]: 200 });
    expect(groupBalances(group).JPY).toEqual(groupBalances(before).JPY);
    expect(group.expenses).toEqual(before.expenses);
    expect(roundingBurden(group, 'EUR')).toEqual(roundingBurden(before, 'EUR'));
  });
});
