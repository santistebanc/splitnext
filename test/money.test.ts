import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocate,
  balances,
  expenseBalances,
  formatAmount,
  minorDigits,
  parseAmount,
  type AllocationPart,
  type LedgerExpense,
  type LedgerSettlement,
  type RoundingBurden,
} from '../src/domain/money';

/**
 * Properties of the money module: every split sums exactly to its total in
 * whole minor units, each share stays within one unit of its exact amount,
 * rounding extras rotate fairly, and balances net to zero per currency.
 */

const members = ['ana', 'ben', 'cy', 'dee', 'eli', 'fay'];

const partsArbitrary = fc
  .subarray(members, { minLength: 1 })
  .chain((ids) =>
    fc.tuple(...ids.map((memberId) =>
      fc.oneof(
        fc.record({ kind: fc.constant('shares' as const), member_id: fc.constant(memberId), shares: fc.integer({ min: 1, max: 7 }) }),
        fc.record({ kind: fc.constant('exact' as const), member_id: fc.constant(memberId), amount: fc.integer({ min: 0, max: 5_000 }) }),
      ))),
  )
  .filter((parts) => parts.some((part) => part.kind === 'shares'));

const burdenArbitrary = fc.dictionary(fc.constantFrom(...members), fc.nat({ max: 20 }));

function exactTotal(parts: readonly AllocationPart[]): number {
  return parts.reduce((sum, part) => sum + (part.kind === 'exact' ? part.amount : 0), 0);
}

describe('money allocation', () => {
  it('sums exactly to the total and keeps each share within one unit of its exact amount', () => {
    fc.assert(
      fc.property(partsArbitrary, fc.integer({ min: 1, max: 10_000_000 }), burdenArbitrary, (parts, extra, burden) => {
        const total = exactTotal(parts) + extra;
        const result = allocate(total, parts, burden);

        if (!result.ok) throw new Error(result.error);
        const amounts = new Map(result.allocations.map((entry) => [entry.member_id, entry.amount]));
        const shares = parts.reduce((sum, part) => sum + (part.kind === 'shares' ? part.shares : 0), 0);

        expect(result.allocations.reduce((sum, entry) => sum + entry.amount, 0)).toBe(total);
        expect(result.allocations.map((entry) => entry.member_id)).toEqual(parts.map((part) => part.member_id));

        for (const part of parts) {
          const amount = amounts.get(part.member_id) ?? -1;

          expect(Number.isSafeInteger(amount) && amount >= 0).toBe(true);

          if (part.kind === 'exact') expect(amount).toBe(part.amount);
          else {
            const exact = (extra * part.shares) / shares;

            expect(amount).toBeGreaterThanOrEqual(Math.floor(exact));
            expect(amount).toBeLessThanOrEqual(Math.ceil(exact));
          }
        }

        // Extras are recorded as burden, one unit each.
        const added = Object.entries(result.burden).reduce((sum, [memberId, value]) => sum + value - (burden[memberId] ?? 0), 0);
        const floors = parts.reduce((sum, part) => sum + (part.kind === 'shares' ? Math.floor((extra * part.shares) / shares) : 0), 0);

        expect(added).toBe(extra - floors);
      }),
    );
  });

  it('gives the same split whatever the order of participants', () => {
    fc.assert(
      fc.property(partsArbitrary, fc.integer({ min: 1, max: 100_000 }), burdenArbitrary, (parts, extra, burden) => {
        const total = exactTotal(parts) + extra;
        const forward = allocate(total, parts, burden);
        const backward = allocate(total, [...parts].reverse(), burden);

        if (!forward.ok || !backward.ok) throw new Error('allocation_failed');
        const byMember = (entries: { member_id: string; amount: number }[]) => Object.fromEntries(entries.map((entry) => [entry.member_id, entry.amount]));

        expect(byMember(backward.allocations)).toEqual(byMember(forward.allocations));
        expect(backward.burden).toEqual(forward.burden);
      }),
    );
  });

  it('rotates rounding extras so equal splits stay fair over time', () => {
    fc.assert(
      fc.property(fc.subarray(members, { minLength: 2 }), fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 60 }), (ids, totals) => {
        let burden: RoundingBurden = {};

        for (const total of totals) {
          const result = allocate(total, ids.map((memberId) => ({ kind: 'shares', member_id: memberId, shares: 1 })), burden);

          if (!result.ok) throw new Error(result.error);
          const amounts = result.allocations.map((entry) => entry.amount);

          expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
          burden = result.burden;
        }

        const absorbed = ids.map((memberId) => burden[memberId] ?? 0);

        expect(Math.max(...absorbed) - Math.min(...absorbed)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('rejects inputs that cannot be split exactly', () => {
    const shares = (memberId: string): AllocationPart => ({ kind: 'shares', member_id: memberId, shares: 1 });

    expect(allocate(0, [shares('ana')])).toEqual({ ok: false, error: 'invalid_total' });
    expect(allocate(10.5, [shares('ana')])).toEqual({ ok: false, error: 'invalid_total' });
    expect(allocate(100, [])).toEqual({ ok: false, error: 'no_participants' });
    expect(allocate(100, [shares('ana'), shares('ana')])).toEqual({ ok: false, error: 'duplicate_member' });
    expect(allocate(100, [{ kind: 'exact', member_id: 'ana', amount: 1.5 }, shares('ben')])).toEqual({ ok: false, error: 'invalid_amount' });
    expect(allocate(100, [{ kind: 'shares', member_id: 'ana', shares: 0 }])).toEqual({ ok: false, error: 'invalid_shares' });
    expect(allocate(100, [{ kind: 'exact', member_id: 'ana', amount: 101 }, shares('ben')])).toEqual({ ok: false, error: 'exact_exceeds_total' });
    expect(allocate(100, [{ kind: 'exact', member_id: 'ana', amount: 60 }])).toEqual({ ok: false, error: 'remainder_without_shares' });
    expect(allocate(100, [{ kind: 'exact', member_id: 'ana', amount: 100 }])).toMatchObject({ ok: true, allocations: [{ member_id: 'ana', amount: 100 }] });
  });

  it('splits 10.00 three ways with the extra cent to the least burdened member', () => {
    const parts: AllocationPart[] = ['ana', 'ben', 'cy'].map((memberId) => ({ kind: 'shares', member_id: memberId, shares: 1 }));

    expect(allocate(1000, parts, { ana: 1, ben: 0, cy: 1 })).toEqual({
      ok: true,
      allocations: [
        { member_id: 'ana', amount: 333 },
        { member_id: 'ben', amount: 334 },
        { member_id: 'cy', amount: 333 },
      ],
      burden: { ana: 1, ben: 1, cy: 1 },
    });
  });
});

describe('money amounts', () => {
  it('uses each currency’s minor unit', () => {
    expect([minorDigits('EUR'), minorDigits('JPY'), minorDigits('KWD')]).toEqual([2, 0, 3]);
    expect(parseAmount('12.5', 'EUR')).toBe(1250);
    expect(parseAmount('12.505', 'EUR')).toBeNull();
    expect(parseAmount('1200', 'JPY')).toBe(1200);
    expect(parseAmount('12.5', 'JPY')).toBeNull();
    expect(parseAmount('1.234', 'KWD')).toBe(1234);
    expect(parseAmount('-1', 'EUR')).toBeNull();
    expect(parseAmount('1e3', 'EUR')).toBeNull();
    expect(parseAmount('0.1', 'EUR')).toBe(10);
    expect(formatAmount(5, 'EUR')).toBe('0.05');
    expect(formatAmount(1200, 'JPY')).toBe('1200');
  });

  it('formats and parses back to the same minor units', () => {
    fc.assert(
      fc.property(fc.nat({ max: 1e12 }), fc.constantFrom('EUR', 'JPY', 'KWD', 'USD'), (minor, currency) => {
        expect(parseAmount(formatAmount(minor, currency), currency)).toBe(minor);
      }),
    );
  });
});

describe('balances', () => {
  const currencyArbitrary = fc.constantFrom('EUR', 'USD', 'JPY');

  const expenseArbitrary = fc
    .record({ currency: currencyArbitrary, payer: fc.constantFrom(...members), parts: partsArbitrary, extra: fc.integer({ min: 1, max: 100_000 }) })
    .map(({ currency, payer, parts, extra }) => {
      const total = exactTotal(parts) + extra;
      const result = allocate(total, parts);

      if (!result.ok) throw new Error(result.error);

      const expense = { currency, paid: [{ member_id: payer, amount: total }], allocations: result.allocations } satisfies LedgerExpense;

      return { expense, total };
    });

  const settlementArbitrary = fc.record({
    currency: currencyArbitrary,
    from_member_id: fc.constantFrom(...members),
    to_member_id: fc.constantFrom(...members),
    amount: fc.integer({ min: 1, max: 10_000 }),
  });

  it('net to zero in every currency and never mix currencies', () => {
    fc.assert(
      fc.property(fc.array(expenseArbitrary, { maxLength: 20 }), fc.array(settlementArbitrary, { maxLength: 10 }), (entries, settlements: LedgerSettlement[]) => {
        for (const { expense, total } of entries) expect(expenseBalances(expense, total)).toBe(true);

        const result = balances(entries.map((entry) => entry.expense), settlements);

        for (const [currency, perMember] of Object.entries(result)) {
          expect(Object.values(perMember).reduce((sum, amount) => sum + amount, 0), currency).toBe(0);

          // Each currency's balances come only from its own expenses and settlements.
          const own = balances(
            entries.flatMap((entry) => (entry.expense.currency === currency ? [entry.expense] : [])),
            settlements.filter((settlement) => settlement.currency === currency),
          );

          expect(own[currency] ?? {}).toEqual(perMember);
        }
      }),
    );
  });

  it('keeps balances separate per currency, as in the product spec example', () => {
    const result = balances(
      [
        { currency: 'EUR', paid: [{ member_id: 'santi', amount: 6000 }], allocations: [{ member_id: 'santi', amount: 3000 }, { member_id: 'robin', amount: 3000 }] },
        { currency: 'USD', paid: [{ member_id: 'robin', amount: 4000 }], allocations: [{ member_id: 'santi', amount: 2000 }, { member_id: 'robin', amount: 2000 }] },
      ],
      [{ currency: 'EUR', from_member_id: 'robin', to_member_id: 'santi', amount: 1000 }],
    );

    expect(result).toEqual({ EUR: { santi: 2000, robin: -2000 }, USD: { robin: 2000, santi: -2000 } });
  });
});
