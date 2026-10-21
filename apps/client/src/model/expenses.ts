import {
  activeMembers,
  allocate,
  currencyCodeSchema,
  expenseDescriptionSchema,
  formatAmount,
  groupBalances,
  memberLabel,
  nameOrdinals,
  parseAmount,
  preferredMember,
  roundingBurden,
  type AllocationPart,
  type ClientReplicaState,
  type Expense,
  type ExpenseEntry,
  type LedgerMember,
} from '@splitnext/client';
import { regionCurrency } from './currency';

type Snapshot = ClientReplicaState['projected_snapshot'] | undefined;

/** Expenses that count toward balances, newest recorded first. */
export function currentExpenses(snapshot: Snapshot): Expense[] {
  return (snapshot?.expenses ?? []).filter((expense) => expense.status === 'active').reverse();
}

/** An amount as people read it, such as "42.50 EUR". */
export function moneyLabel(amount: number, currency: string): string {
  return `${formatAmount(amount, currency)} ${currency}`;
}

/** An expense as people refer to it, such as "Dinner · 42.50 EUR". */
export function expenseLabel(expense: Pick<Expense, 'description' | 'total' | 'currency'>): string {
  return `${expense.description} · ${moneyLabel(expense.total, expense.currency)}`;
}

/** One share for every active member, the default split. */
export function equalParts(snapshot: Snapshot): Extract<AllocationPart, { kind: 'shares' }>[] {
  return activeMembers(snapshot).map((member) => ({ kind: 'shares', member_id: member.id, shares: 1 }));
}

/**
 * Currencies the group used recently, most used first among its last ten
 * current expenses, with ties going to the most recent.
 */
export function recentCurrencies(snapshot: Snapshot): string[] {
  const recent = currentExpenses(snapshot).slice(0, 10).map((expense) => expense.currency);
  const count = (currency: string) => recent.filter((entry) => entry === currency).length;

  return [...new Set(recent)].sort((left, right) => count(right) - count(left) || recent.indexOf(left) - recent.indexOf(right));
}

/** The currency a new expense starts with: the group's habit, then the locale's region, then EUR. */
export function suggestedCurrency(snapshot: Snapshot, region: string | null | undefined): string {
  return recentCurrencies(snapshot)[0] ?? regionCurrency(region) ?? 'EUR';
}

/** One person's split, keeping a fixed amount exactly as it is being typed. */
export type ExpenseDraftPart =
  | { kind: 'shares'; member_id: string; shares: number }
  | { kind: 'exact'; member_id: string; amount: string };

/** An expense as it is being entered, with every number still as typed. */
export type ExpenseDraft = {
  expenseId: string | null;
  expectedVersion: number | null;
  description: string;
  amount: string;
  currency: string;
  paidBy: string | null;
  parts: ExpenseDraftPart[];
};

/**
 * A draft for a new expense, paid by "you" and shared equally by every
 * active member, or for changing an existing one as it was entered.
 */
export function draftForExpense(
  snapshot: Snapshot | null,
  expense: Expense | null,
  currency: string,
  identityId?: string,
): ExpenseDraft {
  if (!expense) {
    return {
      expenseId: null,
      expectedVersion: null,
      description: '',
      amount: '',
      currency,
      paidBy: preferredMember(snapshot, identityId)?.id ?? null,
      parts: equalParts(snapshot),
    };
  }

  return {
    expenseId: expense.id,
    expectedVersion: expense.version,
    description: expense.description,
    amount: formatAmount(expense.total, expense.currency),
    currency: expense.currency,
    paidBy: expense.paid[0]?.member_id ?? null,
    parts: expense.parts.map((part) => part.kind === 'exact' ? { ...part, amount: formatAmount(part.amount, expense.currency) } : { ...part }),
  };
}

/** Reduce share counts together, leaving every fixed amount intact. */
function normalizeShares(parts: ExpenseDraftPart[]): ExpenseDraftPart[] {
  function gcd(left: number, right: number): number {
    return right ? gcd(right, left % right) : left;
  }

  const divisor = parts.reduce((common, part) => part.kind === 'shares' ? gcd(common, part.shares) : common, 0);

  return divisor > 1 ? parts.map((part) => part.kind === 'shares' ? { ...part, shares: part.shares / divisor } : part) : parts;
}

/** The nearest whole share count above a fixed person's current proportion. */
function sharesFromFixed(draft: ExpenseDraft, fixed: Extract<ExpenseDraftPart, { kind: 'exact' }>): number {
  const amount = parseAmount(fixed.amount, draft.currency) ?? 0;
  const total = parseAmount(draft.amount, draft.currency) ?? 0;
  const otherFixed = draft.parts.reduce((sum, part) => part.kind === 'exact' && part !== fixed ? sum + (parseAmount(part.amount, draft.currency) ?? 0) : sum, 0);
  const shares = draft.parts.reduce((sum, part) => part.kind === 'shares' ? sum + part.shares : sum, 0);
  const remaining = total - otherFixed - amount;

  if (!shares || remaining <= 0) return 1;
  const numerator = BigInt(amount) * BigInt(shares);
  const denominator = BigInt(remaining);

  return Math.max(1, Math.min(1_000_000, Number((numerator + denominator - 1n) / denominator)));
}

/** Increase a share, add someone excluded, or return a fixed person to shares. */
export function increaseExpenseShare(draft: ExpenseDraft, memberId: string): ExpenseDraftPart[] {
  const current = draft.parts.find((part) => part.member_id === memberId);
  const shares = current?.kind === 'exact' ? sharesFromFixed(draft, current) : (current?.shares ?? 0) + 1;
  const replacement: ExpenseDraftPart = { kind: 'shares', member_id: memberId, shares };
  const parts = current ? draft.parts.map((part) => part === current ? replacement : part) : [...draft.parts, replacement];

  return normalizeShares(parts);
}

/** Decrease a share; a fixed person or someone at one share is excluded. */
export function decreaseExpenseShare(draft: ExpenseDraft, memberId: string): ExpenseDraftPart[] {
  return normalizeShares(draft.parts.flatMap((part): ExpenseDraftPart[] => {
    if (part.member_id !== memberId) return [part];

    return part.kind === 'shares' && part.shares > 1 ? [{ ...part, shares: part.shares - 1 }] : [];
  }));
}

/** Keep a person sharing the remainder, even when everybody else has a fixed amount. */
export function canExcludeExpensePart(draft: ExpenseDraft, memberId: string): boolean {
  const others = draft.parts.filter((part) => part.member_id !== memberId);

  return others.some((part) => part.kind === 'shares') || (!draft.parts.some((part) => part.kind === 'shares') && others.length > 0);
}

/** Keep a typed fixed amount, or return that person to one share when cleared. */
export function fixExpenseAmount(draft: ExpenseDraft, memberId: string, amount: string): ExpenseDraftPart[] {
  return normalizeShares(draft.parts.map((part): ExpenseDraftPart => part.member_id !== memberId ? part : amount.trim()
    ? { kind: 'exact', member_id: memberId, amount }
    : { kind: 'shares', member_id: memberId, shares: 1 }));
}

export type DraftEntry = { ok: true; entry: ExpenseEntry } | { ok: false; problem: string };

/** The entry a draft states, or what to fix first, in the words the form shows. */
export function entryFromDraft(draft: ExpenseDraft): DraftEntry {
  const fail = (problem: string): DraftEntry => ({ ok: false, problem });
  const description = expenseDescriptionSchema.safeParse(draft.description);

  if (!description.success) return fail('Describe the expense.');

  if (!currencyCodeSchema.safeParse(draft.currency).success) return fail('Enter a three-letter currency, such as EUR.');
  const total = parseAmount(draft.amount, draft.currency);

  if (!total) return fail(`Enter an amount in ${draft.currency}, such as ${formatAmount(1250, draft.currency)}.`);

  if (!draft.paidBy) return fail('Choose who paid.');

  if (!draft.parts.length) return fail('Choose who shares the expense.');
  const parts: AllocationPart[] = [];

  for (const part of draft.parts) {
    if (part.kind === 'shares') {
      if (!Number.isInteger(part.shares) || part.shares <= 0 || part.shares > 1_000_000) return fail('Use between 1 and 1000000 whole shares.');
      parts.push(part);
    } else {
      const amount = parseAmount(part.amount, draft.currency);

      if (amount === null) return fail(`Enter each amount in ${draft.currency}.`);
      parts.push({ kind: 'exact', member_id: part.member_id, amount });
    }
  }

  const allocated = allocate(total, parts);

  if (!allocated.ok) {
    return fail(
      allocated.error === 'remainder_without_shares'
        ? 'The fixed amounts must add up to the total, or clear one to share the rest.'
        : 'The amounts add up to more than the total.',
    );
  }

  return {
    ok: true,
    entry: { description: description.data, currency: draft.currency, total, paid_by: draft.paidBy, parts },
  };
}

/**
 * What each participant would owe, allocated as the group would now. The
 * group decides when the expense arrives, so an extra unit may still move.
 * The split shows before the expense is described.
 */
export function previewAllocation(snapshot: Snapshot, draft: ExpenseDraft): Map<string, number> {
  const result = entryFromDraft({ ...draft, description: draft.description.trim() || 'Expense' });

  if (!result.ok || !snapshot) return new Map();
  const burden = roundingBurden(snapshot, result.entry.currency, draft.expenseId ?? undefined);
  const allocated = allocate(result.entry.total, result.entry.parts, burden);

  return new Map(allocated.ok ? allocated.allocations.map((entry) => [entry.member_id, entry.amount]) : []);
}

/** A member's name as people see it, with its name ordinal when it repeats. */
export function memberName(snapshot: Snapshot, memberId: string): string {
  const member = snapshot?.members.find((entry) => entry.id === memberId);

  return member ? memberLabel(member.display_name, nameOrdinals(snapshot).get(member.id)) : 'Someone';
}

export type BalanceRow = { member: LedgerMember; amount: number };

/**
 * Each currency's balances for people named in its current records, including
 * settled zeros. Hidden people stay only while not settled. Positive is owed.
 */
export function balanceRows(snapshot: Snapshot): { currency: string; rows: BalanceRow[] }[] {
  const byCurrency = snapshot ? groupBalances(snapshot) : {};

  return Object.keys(byCurrency)
    .sort()
    .map((currency) => ({
      currency,
      rows: (snapshot?.members ?? []).flatMap((member) => {
        const amount = byCurrency[currency]?.[member.id];

        return amount !== undefined && (member.status === 'active' || (member.status === 'hidden' && amount !== 0)) ? [{ member, amount }] : [];
      }),
    }));
}
