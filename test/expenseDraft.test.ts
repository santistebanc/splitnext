import { describe, expect, it } from 'vitest';
import { allocate, type AllocationPart, type Expense } from '../src/client';
import { canExcludeExpensePart, decreaseExpenseShare, draftForExpense, entryFromDraft, fixExpenseAmount, groupDigits, increaseExpenseShare, moneyLabel, noCurrency, previewAllocation, type ExpenseDraft } from '../apps/client/src/model/expenses';
import { scenarioReplica } from '../apps/client/src/workbench/memberListFixture';

const replica = scenarioReplica({ members: ['Ana', 'Ben', 'Cy'], you: 'Ana', others: [], presence: 'realtime', othersOnline: false, connection: 'online' });

const snapshot = replica.projected_snapshot!;

const [ana, ben, cy] = snapshot.members.map((member) => member.id);

function draft(): ExpenseDraft {
  return { ...draftForExpense(snapshot, null, 'EUR', replica.session?.identity.id), description: 'Dinner', amount: '100.00' };
}

function weighted(): ExpenseDraft {
  const result = draft();

  result.parts = increaseExpenseShare(result, ana!);
  result.parts = increaseExpenseShare(result, ana!);
  result.parts = increaseExpenseShare(result, ben!);

  return result;
}

function amounts(value: ExpenseDraft): number[] {
  const preview = previewAllocation(snapshot, value);

  return snapshot.members.map((member) => preview.get(member.id) ?? 0);
}

describe('expense draft', () => {
  it('adjusts shares as in the original editor, and mixes them with a fixed amount', () => {
    const value = weighted();

    expect(amounts(value)).toEqual([5000, 3333, 1667]);
    value.parts = fixExpenseAmount(value, cy!, '20.00');
    expect(amounts(value)).toEqual([4800, 3200, 2000]);
    value.amount = '130';
    expect(amounts(value)).toEqual([6600, 4400, 2000]);
    expect(value.parts).toEqual([
      { kind: 'shares', member_id: ana, shares: 3 },
      { kind: 'shares', member_id: ben, shares: 2 },
      { kind: 'exact', member_id: cy, amount: '20.00' },
    ]);
  });

  it('reopens and saves mixed parts without losing their share weights or fixed values', () => {
    const parts: AllocationPart[] = [{ kind: 'exact', member_id: ana!, amount: 2000 }, { kind: 'shares', member_id: ben!, shares: 3 }, { kind: 'shares', member_id: cy!, shares: 2 }];

    const expense: Expense = {
      id: 'expense______________', version: 2, description: 'Dinner', currency: 'EUR', total: 10000,
      paid: [{ member_id: ana!, amount: 10000 }], parts, allocations: [], extras: [], status: 'active', created_at: '2026-10-20T12:00:00.000Z', updated_at: '2026-10-20T12:00:00.000Z',
    };

    const value = draftForExpense(snapshot, expense, 'USD');
    const entry = entryFromDraft(value);

    expect(value).toMatchObject({ expenseId: expense.id, expectedVersion: 2, currency: 'EUR' });
    expect(entry).toMatchObject({ ok: true, entry: { parts } });
    expect(amounts(value)).toEqual([2000, 4800, 3200]);
  });

  it('clears a fixed amount back to a share, and arrows can exclude and restore people', () => {
    const value = weighted();

    value.parts = fixExpenseAmount(value, cy!, '20');
    value.parts = fixExpenseAmount(value, cy!, '');
    expect(value.parts.at(-1)).toEqual({ kind: 'shares', member_id: cy, shares: 1 });
    value.parts = fixExpenseAmount(value, cy!, '20');
    value.parts = decreaseExpenseShare(value, cy!);
    expect(value.parts.some((part) => part.member_id === cy)).toBe(false);
    value.parts = increaseExpenseShare(value, cy!);
    expect(amounts(value)).toEqual([5000, 3333, 1667]);
  });

  it('converts fixed amounts to the next proportional whole share, and normalizes equal weights', () => {
    const value = draft();

    value.parts = fixExpenseAmount(value, ana!, '50');
    value.parts = increaseExpenseShare(value, ana!);
    expect(value.parts[0]).toEqual({ kind: 'shares', member_id: ana, shares: 2 });
    expect(amounts(value)).toEqual([5000, 2500, 2500]);
    value.parts = decreaseExpenseShare(value, ana!);
    expect(value.parts.every((part) => part.kind === 'shares' && part.shares === 1)).toBe(true);
    value.parts = fixExpenseAmount(value, cy!, '20');
    expect(canExcludeExpensePart(value, ana!)).toBe(true);
    value.parts = decreaseExpenseShare(value, ana!);
    expect(canExcludeExpensePart(value, ben!)).toBe(false);
  });

  it('retains invalid fixed input and prevents saving amounts above the total', () => {
    const value = weighted();

    for (const amount of ['abc', '1.001', '101']) {
      value.parts = fixExpenseAmount(value, cy!, amount);
      expect(value.parts.at(-1)).toEqual({ kind: 'exact', member_id: cy, amount });
      expect(entryFromDraft(value).ok).toBe(false);
      expect(previewAllocation(snapshot, value).size).toBe(0);
    }

    value.parts = fixExpenseAmount(value, cy!, '20');
    expect(entryFromDraft(value).ok).toBe(true);
  });

  it('uses the currency precision and allocates every minor unit exactly once', () => {
    for (const [currency, amount, fixed] of [['JPY', '100', '20'], ['KWD', '100.001', '20.001']] as const) {
      const value = { ...weighted(), currency, amount };

      value.parts = fixExpenseAmount(value, cy!, fixed);
      const entry = entryFromDraft(value);

      if (!entry.ok) throw new Error(entry.problem);
      const result = allocate(entry.entry.total, entry.entry.parts);

      expect(result.ok).toBe(true);
      expect(amounts(value).reduce((sum, portion) => sum + portion, 0)).toBe(entry.entry.total);
    }
  });
});

describe('amounts as people read them', () => {
  it('groups whole digits in threes with a space that does not break, and drafts stay plain', () => {
    const shown = (minor: number) => moneyLabel(minor, noCurrency).replaceAll('\u00a0', ' ');

    expect([1, 99_999, 100_000, 123_456_789, 4_825_000].map(shown)).toEqual(['0.01', '999.99', '1 000.00', '1 234 567.89', '48 250.00']);
    expect(groupDigits('1200')).toBe('1\u00a0200');
    expect(moneyLabel(123_456_789, noCurrency)).not.toContain(' ');

    const expense: Expense = {
      id: 'expense______________', version: 1, description: 'Yacht', currency: noCurrency, total: 123_456_789,
      paid: [{ member_id: ana!, amount: 123_456_789 }], parts: [{ kind: 'shares', member_id: ana!, shares: 1 }], allocations: [], extras: [], status: 'active', created_at: '2026-10-20T12:00:00.000Z', updated_at: '2026-10-20T12:00:00.000Z',
    };

    expect(draftForExpense(snapshot, expense, noCurrency).amount).toBe('1234567.89');
  });
});
