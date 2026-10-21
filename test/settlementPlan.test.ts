import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planTransfers } from '../src/domain/settlements';

/** Balances that sum to zero: random amounts, with the last member taking the remainder. */
const balancesArbitrary = fc
  .array(fc.integer({ min: -400, max: 400 }), { minLength: 1, maxLength: 8 })
  .map((amounts) => {
    const all = [...amounts, -amounts.reduce((sum, amount) => sum + amount, 0)];

    return Object.fromEntries(all.map((amount, index) => [`m${index}`, amount]));
  });

/** The fewest payments by brute force: nonzero members minus the most zero-sum sets they split into. */
function fewestPayments(balances: Record<string, number>): number {
  const amounts = Object.values(balances).filter((amount) => amount !== 0);
  let most = 0;

  // Assign each member a set label; label i can only follow labels below it.
  function search(index: number, sets: number[]): void {
    if (index === amounts.length) {
      if (sets.every((sum) => sum === 0)) most = Math.max(most, sets.length);

      return;
    }

    for (let set = 0; set <= sets.length; set++) {
      const next = [...sets];
      next[set] = (next[set] ?? 0) + amounts[index]!;
      search(index + 1, next);
    }
  }

  search(0, []);

  return amounts.length - most;
}

function settle(balances: Record<string, number>, transfers: ReturnType<typeof planTransfers>) {
  const after = { ...balances };

  for (const transfer of transfers) {
    after[transfer.from_member_id] = (after[transfer.from_member_id] ?? 0) + transfer.amount;
    after[transfer.to_member_id] = (after[transfer.to_member_id] ?? 0) - transfer.amount;
  }

  return after;
}

describe('settle-up plan', () => {
  it('settles everyone with the fewest positive payments', () => {
    fc.assert(
      fc.property(balancesArbitrary, (balances) => {
        const transfers = planTransfers('EUR', balances);

        expect(Object.values(settle(balances, transfers)).every((amount) => amount === 0)).toBe(true);
        expect(transfers.every((transfer) => transfer.amount > 0 && transfer.from_member_id !== transfer.to_member_id)).toBe(true);
        expect(transfers).toHaveLength(fewestPayments(balances));
        expect(planTransfers('EUR', balances)).toEqual(transfers);
      }),
    );
  });

  it('pays across the middle and keeps matching debts together', () => {
    // Jonas owes 60 and Santi is owed 60, while Ana owes Carlos 50 separately.
    const transfers = planTransfers('USD', { carlos: 50, ana: -50, jonas: -60, santi: 60 });

    expect(transfers).toEqual([
      { currency: 'USD', from_member_id: 'ana', to_member_id: 'carlos', amount: 50 },
      { currency: 'USD', from_member_id: 'jonas', to_member_id: 'santi', amount: 60 },
    ]);
  });

  it('still settles groups too large to search exhaustively', () => {
    const balances = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`m${index}`, index % 2 ? 7 : -7]));

    expect(Object.values(settle(balances, planTransfers('EUR', balances))).every((amount) => amount === 0)).toBe(true);
  });
});
