import { z } from 'zod';

/**
 * The money rules every expense, balance, and settlement must use: integer
 * amounts in a currency's minor unit, allocation by exact amounts and shares,
 * deterministic rounding that spreads unavoidable extra units fairly over
 * time, and balances kept separately per currency. See ADR 0007, ADR 0014,
 * and ADR 0017. Nothing outside this module reproduces these rules.
 */

/** An ISO 4217 currency code, such as EUR. */
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export type CurrencyCode = z.output<typeof currencyCodeSchema>;

/** ISO 4217 currencies whose minor unit is not two decimal places. */
const minorDigitExceptions = new Map([
  ...['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']
    .map((code): [string, number] => [code, 0]),
  ...['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'].map((code): [string, number] => [code, 3]),
]);

/** Decimal places of a currency's minor unit: 2 for EUR, 0 for JPY, 3 for KWD. */
export function minorDigits(currency: CurrencyCode): number {
  return minorDigitExceptions.get(currency) ?? 2;
}

/** An amount in a currency's minor unit, such as cents; never fractional. */
export const minorAmountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * Reads a decimal amount as entered, such as "12.5" EUR, into minor units
 * without floating point. More decimals than the currency has are invalid.
 */
export function parseAmount(text: string, currency: CurrencyCode): number | null {
  const digits = minorDigits(currency);
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text.trim());

  if (!match) return null;
  const [, whole = '', fraction = ''] = match;

  if (fraction.length > digits) return null;
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');

  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

/** Writes minor units as a plain decimal, such as 1250 EUR as "12.50". */
export function formatAmount(minor: number, currency: CurrencyCode): string {
  const digits = minorDigits(currency);
  const text = String(minor).padStart(digits + 1, '0');

  return digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
}

/** How one member takes part in an expense. */
export type AllocationPart =
  | { kind: 'exact'; member_id: string; amount: number }
  | { kind: 'shares'; member_id: string; shares: number };

export type Allocation = { member_id: string; amount: number };

/** Extra minor units each member has absorbed from rounding, in one currency. */
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
 * reach the total go to eligible members with the lowest accumulated burden
 * in this currency, then the largest fractional remainder, then member id,
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

/** What one expense contributes to balances: who paid and who owes, in one currency. */
export type LedgerExpense = {
  currency: CurrencyCode;
  /** One payer for now; a list so several payers fit without a new model. */
  paid: Allocation[];
  allocations: Allocation[];
};

/** A recorded repayment that reduces balances in its own currency only. */
export type LedgerSettlement = {
  currency: CurrencyCode;
  from_member_id: string;
  to_member_id: string;
  amount: number;
};

/** Net amount per member in one currency: positive is owed to them, negative they owe. */
export type CurrencyBalances = Record<string, number>;

/** Balances per currency; amounts in different currencies are never combined. */
export function balances(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[] = [],
): Record<CurrencyCode, CurrencyBalances> {
  const byCurrency: Record<CurrencyCode, CurrencyBalances> = {};

  function add(currency: CurrencyCode, memberId: string, amount: number): void {
    const currencyBalances = byCurrency[currency] ?? {};

    currencyBalances[memberId] = (currencyBalances[memberId] ?? 0) + amount;
    byCurrency[currency] = currencyBalances;
  }

  for (const expense of expenses) {
    for (const payment of expense.paid) add(expense.currency, payment.member_id, payment.amount);

    for (const share of expense.allocations) add(expense.currency, share.member_id, -share.amount);
  }

  for (const settlement of settlements) {
    add(settlement.currency, settlement.from_member_id, settlement.amount);
    add(settlement.currency, settlement.to_member_id, -settlement.amount);
  }

  return byCurrency;
}

/** An expense is balanced when what was paid and what is owed both equal its total. */
export function expenseBalances(expense: LedgerExpense, total: number): boolean {
  const sum = (entries: readonly Allocation[]) => entries.reduce((acc, entry) => acc + entry.amount, 0);

  return expense.paid.length > 0 && sum(expense.paid) === total && sum(expense.allocations) === total;
}
