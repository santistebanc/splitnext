import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hasRecords, memberBreakdown } from '../apps/client/src/model/breakdown';
import { balanceRows } from '../apps/client/src/model/expenses';
import { applyGroupCommand, type GroupCommand } from '../src/domain/commands';
import { groupBalances } from '../src/domain/expenses';
import type { GroupSnapshot } from '../src/domain/sync';

/**
 * A person's details list every expense and repayment behind their balance;
 * the rows of each currency add up exactly to that balance.
 */

const id = (label: string) => label.padEnd(22, '_');

const me = id('identity-me');

const members = ['ana', 'ben', 'cy', 'dee'].map((name) => id(`member-${name}`));

const currencies = ['EUR', 'USD'] as const;

function start(): GroupSnapshot {
  const at = '2026-01-01T00:00:00.000Z';

  return {
    group: { id: id('group'), name: 'Trip', created_at: at },
    members: members.map((memberId, index) => ({
      id: memberId, display_name: ['Ana', 'Ben', 'Cy', 'Dee'][index] ?? '', status: 'active', created_at: at, updated_at: at,
    })),
    expenses: [],
    settlements: [],
    access_grants: [{ identity_id: me, actor_handle: 'User 1', preferred_member_id: members[0]!, granted_at: at, hidden_at: null }],
    invite: { id: id('invite'), created_by_identity_id: me, created_at: at, token: 't'.repeat(43) },
  };
}

const memberArbitrary = fc.constantFrom(...members);

const stepArbitrary = fc.oneof(
  fc.record({
    kind: fc.constant('expense' as const),
    currency: fc.constantFrom(...currencies),
    total: fc.integer({ min: 1, max: 10_000 }),
    payer: memberArbitrary,
    shares: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: members.length, maxLength: members.length }),
  }),
  fc.record({
    kind: fc.constant('settlement' as const),
    currency: fc.constantFrom(...currencies),
    amount: fc.integer({ min: 1, max: 5_000 }),
    from: memberArbitrary,
    to: memberArbitrary,
  }),
  fc.record({ kind: fc.constant('removeExpense' as const), index: fc.nat() }),
);

type Step = typeof stepArbitrary extends fc.Arbitrary<infer T> ? T : never;

function command(snapshot: GroupSnapshot, step: Step, index: number): GroupCommand | null {
  const command_id = id(`command-${index}`);

  if (step.kind === 'expense') {
    const parts = members.flatMap((member_id, position) => {
      const shares = step.shares[position] ?? 0;

      return shares > 0 ? [{ kind: 'shares' as const, member_id, shares }] : [];
    });

    return parts.length
      ? { command_id, type: 'expense.record', payload: { expense_id: id(`expense-${index}`), description: `Expense ${index}`, currency: step.currency, total: step.total, paid_by: step.payer, parts } }
      : null;
  }

  if (step.kind === 'settlement')
    return step.from === step.to
      ? null
      : { command_id, type: 'settlement.record', payload: { settlement_id: id(`settlement-${index}`), from_member_id: step.from, to_member_id: step.to, currency: step.currency, amount: step.amount } };

  const active = snapshot.expenses.filter((expense) => expense.status === 'active');
  const expense = active[step.index % Math.max(active.length, 1)];

  return expense ? { command_id, type: 'expense.remove', payload: { expense_id: expense.id } } : null;
}

describe('member breakdown', () => {
  it('shows settled zeros only in currencies the person has records in', () => {
    let snapshot = start();
    const [ana, ben, cy, dee] = members;

    const commands: GroupCommand[] = [
      { command_id: id('dinner-command'), type: 'expense.record', payload: { expense_id: id('dinner'), description: 'Dinner', currency: 'EUR', total: 1000, paid_by: ana!, parts: [{ kind: 'shares', member_id: ana!, shares: 1 }, { kind: 'shares', member_id: ben!, shares: 1 }] } },
      { command_id: id('repayment-command'), type: 'settlement.record', payload: { settlement_id: id('repayment'), from_member_id: ben!, to_member_id: ana!, currency: 'EUR', amount: 500 } },
      { command_id: id('train-command'), type: 'expense.record', payload: { expense_id: id('train'), description: 'Train', currency: 'USD', total: 2000, paid_by: cy!, parts: [{ kind: 'shares', member_id: cy!, shares: 1 }] } },
    ];

    for (const entry of commands) {
      const result = applyGroupCommand(snapshot, me, entry, '2026-10-20T12:00:00.000Z');

      expect(result.status).toBe('applied');
      snapshot = result.snapshot;
    }

    expect(balanceRows(snapshot).map(({ currency, rows }) => ({ currency, balances: rows.map(({ member, amount }) => [member.id, amount]) }))).toEqual([
      { currency: 'EUR', balances: [[ana, 0], [ben, 0]] },
      { currency: 'USD', balances: [[cy, 0]] },
    ]);
    expect(hasRecords(snapshot, dee!)).toBe(false);
  });

  it('adds up to the balance in every currency', () => {
    fc.assert(
      fc.property(fc.array(stepArbitrary, { maxLength: 25 }), (steps) => {
        let snapshot = start();

        steps.forEach((step, index) => {
          const next = command(snapshot, step, index);

          if (!next) return;
          const at = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
          const transition = applyGroupCommand(snapshot, me, next, at);

          if (transition.status === 'applied') snapshot = transition.snapshot;
        });

        const balances = groupBalances(snapshot);
        const displayed = balanceRows(snapshot);

        for (const memberId of members) {
          const breakdown = memberBreakdown(snapshot, memberId, () => 'Someone');

          // Settled people have records; people in no expense or repayment yet have none.
          expect(hasRecords(snapshot, memberId)).toBe(breakdown.length > 0);
          expect(displayed.flatMap(({ currency, rows }) => rows.filter((row) => row.member.id === memberId).map((row) => [currency, row.amount])))
            .toEqual(breakdown.map(({ currency, total }) => [currency, total]));

          for (const { currency, rows, total } of breakdown) {
            expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(total);
            expect(total).toBe(balances[currency]?.[memberId] ?? 0);
            expect(rows.map((row) => row.at)).toEqual(rows.map((row) => row.at).sort().reverse());
          }

          for (const [currency, amounts] of Object.entries(balances))
            if (amounts[memberId]) expect(breakdown.some((entry) => entry.currency === currency)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
