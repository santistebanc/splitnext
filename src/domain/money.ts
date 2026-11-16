import { z } from 'zod';

/**
 * The money rules every expense, balance, and settlement must use: plain
 * amounts with two decimals, kept as whole hundredths, allocation by exact
 * amounts and shares, deterministic rounding that spreads unavoidable extra
 * hundredths fairly over time, and one balance per member. There are no
 * currencies (ADR 0025). See ADR 0007, ADR 0014, and ADR 0017. Nothing outside
 * this module reproduces these rules.
 */

/** Decimal places of every amount. */
export const amountDigits = 2;

/** An amount in hundredths, such as 1250 for 12.50; never fractional. */
export const minorAmountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * Reads a decimal amount as entered, such as "12.5", into hundredths without
 * floating point. More than two decimals are invalid.
 */
export function parseAmount(text: string): number | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text.trim());

  if (!match) return null;
  const [, whole = '', fraction = ''] = match;

  if (fraction.length > amountDigits) return null;
  const minor = BigInt(whole) * 10n ** BigInt(amountDigits) + BigInt(fraction.padEnd(amountDigits, '0') || '0');

  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

/** Writes hundredths as a plain decimal, such as 1250 as "12.50". */
export function formatAmount(minor: number): string {
  const text = String(minor).padStart(amountDigits + 1, '0');

  return `${text.slice(0, -amountDigits)}.${text.slice(-amountDigits)}`;
}

/** How one member takes part in an expense. */
export type AllocationPart =
  | { kind: 'exact'; member_id: string; amount: number }
  | { kind: 'shares'; member_id: string; shares: number };

export type Allocation = { member_id: string; amount: number };

/** Extra hundredths each member has absorbed from rounding. */
export type RoundingBurden = Record<string, number>;

export type AllocationError =
  | 'invalid_total'
  | 'no_participants'
  | 'duplicate_member'
  | 'invalid_amount'
  | 'invalid_shares'
  | 'exact_exceeds_total'
  | 'remainder_without_shares';

export type AllocationResult =
  | { ok: true; allocations: Allocation[]; burden: RoundingBurden }
  | { ok: false; error: AllocationError };

/**
 * Splits a total in minor units: exact parts take their amounts and the
 * remainder is divided by shares. Each share part receives the floor or the
 * ceiling of its exact proportional amount. The few extra units needed to
 * reach the total go to eligible members with the lowest accumulated burden,
 * then the largest fractional remainder, then member id,
 * so equal splits rotate extras over time. The result is independent of the
 * order of parts and returns the updated burden.
 */
export function allocate(
  total: number,
  parts: readonly AllocationPart[],
  burden: RoundingBurden = {},
): AllocationResult {
  if (!minorAmountSchema.safeParse(total).success || total === 0) return { ok: false, error: 'invalid_total' };

  if (parts.length === 0) return { ok: false, error: 'no_participants' };

  if (new Set(parts.map((part) => part.member_id)).size !== parts.length) return { ok: false, error: 'duplicate_member' };

  const exact = parts.flatMap((part) => (part.kind === 'exact' ? [part] : []));
  const shared = parts.flatMap((part) => (part.kind === 'shares' ? [part] : []));

  if (exact.some((part) => !minorAmountSchema.safeParse(part.amount).success)) return { ok: false, error: 'invalid_amount' };

  if (shared.some((part) => !Number.isSafeInteger(part.shares) || part.shares <= 0)) return { ok: false, error: 'invalid_shares' };

  const exactTotal = exact.reduce((sum, part) => sum + part.amount, 0);

  if (exactTotal > total) return { ok: false, error: 'exact_exceeds_total' };
  const remainder = BigInt(total - exactTotal);

  if (remainder > 0n && shared.length === 0) return { ok: false, error: 'remainder_without_shares' };

  const totalShares = shared.reduce((sum, part) => sum + BigInt(part.shares), 0n);

  const portions = shared.map((part) => {
    const scaled = remainder * BigInt(part.shares);

    return { member_id: part.member_id, floor: scaled / totalShares, fraction: scaled % totalShares };
  });

  const extras = Number(remainder - portions.reduce((sum, portion) => sum + portion.floor, 0n));

  // Only members whose exact amount is fractional can take an extra unit and
  // stay within one unit of it; their fractions always cover the extras.
  const receivers = new Set(
    portions
      .filter((portion) => portion.fraction > 0n)
      .sort((left, right) =>
        (burden[left.member_id] ?? 0) - (burden[right.member_id] ?? 0) ||
        (left.fraction === right.fraction ? 0 : left.fraction > right.fraction ? -1 : 1) ||
        (left.member_id < right.member_id ? -1 : 1))
      .slice(0, extras)
      .map((portion) => portion.member_id),
  );

  const amounts = new Map<string, number>([
    ...exact.map((part): [string, number] => [part.member_id, part.amount]),
    ...portions.map((portion): [string, number] => [
      portion.member_id,
      Number(portion.floor) + (receivers.has(portion.member_id) ? 1 : 0),
    ]),
  ]);

  const updated = { ...burden };

  for (const memberId of receivers) updated[memberId] = (updated[memberId] ?? 0) + 1;

  return {
    ok: true,
    allocations: parts.map((part) => ({ member_id: part.member_id, amount: amounts.get(part.member_id) ?? 0 })),
    burden: updated,
  };
}

/** What one expense contributes to balances: who paid and who owes. */
export type LedgerExpense = {
  /** One payer for now; a list so several payers fit without a new model. */
  paid: Allocation[];
  allocations: Allocation[];
};

/** A recorded repayment that reduces balances. */
export type LedgerSettlement = {
  from_member_id: string;
  to_member_id: string;
  amount: number;
};

/** Net amount per member: positive is owed to them, negative they owe. */
export type Balances = Record<string, number>;

/** Each member's one balance from the expenses and repayments given. */
export function balances(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[] = [],
) {
  const result: Balances = {};

  function add(memberId: string, amount: number): void {
    result[memberId] = (result[memberId] ?? 0) + amount;
  }

  for (const expense of expenses) {
    for (const payment of expense.paid) add(payment.member_id, payment.amount);

    for (const share of expense.allocations) add(share.member_id, -share.amount);
  }

  for (const settlement of settlements) {
    add(settlement.from_member_id, settlement.amount);
    add(settlement.to_member_id, -settlement.amount);
  }

  return result;
}

/** An expense is balanced when what was paid and what is owed both equal its total. */
export function expenseBalances(expense: LedgerExpense, total: number): boolean {
  const sum = (entries: readonly Allocation[]) => entries.reduce((acc, entry) => acc + entry.amount, 0);

  return expense.paid.length > 0 && sum(expense.paid) === total && sum(expense.allocations) === total;
}
