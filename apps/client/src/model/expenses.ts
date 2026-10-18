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
export function equalParts(snapshot: Snapshot): AllocationPart[] {
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

/** How the entry form divides an expense between its participants. */
export type ExpenseSplit = 'equal' | 'shares' | 'amounts';

export const expenseSplits = ['equal', 'shares', 'amounts'] as const satisfies readonly ExpenseSplit[];

/** An expense as it is being entered, with every number still as typed. */
export type ExpenseDraft = {
  expenseId: string | null;
  expectedVersion: number | null;
  description: string;
  amount: string;
  currency: string;
  paidBy: string | null;
  split: ExpenseSplit;
  /** Members sharing the expense, in group order. */
  participants: string[];
  /** Shares or an amount per participant, by split; a blank amount shares what is left. */
  values: Record<string, string>;
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
      split: 'equal',
      participants: activeMembers(snapshot).map((member) => member.id),
      values: {},
    };
  }

  const exact = expense.parts.some((part) => part.kind === 'exact');
  const equal = expense.parts.every((part) => part.kind === 'shares' && part.shares === 1);

  return {
    expenseId: expense.id,
    expectedVersion: expense.version,
    description: expense.description,
    amount: formatAmount(expense.total, expense.currency),
    currency: expense.currency,
    paidBy: expense.paid[0]?.member_id ?? null,
    split: exact ? 'amounts' : equal ? 'equal' : 'shares',
    participants: expense.parts.map((part) => part.member_id),
    values: Object.fromEntries(
      expense.parts.map((part) => [
        part.member_id,
        part.kind === 'exact' ? formatAmount(part.amount, expense.currency) : exact ? '' : String(part.shares),
      ]),
    ),
  };
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

  if (!draft.participants.length) return fail('Choose who shares the expense.');
  const parts: AllocationPart[] = [];

  for (const memberId of draft.participants) {
    const value = (draft.values[memberId] ?? '').trim();

    if (draft.split === 'equal' || (draft.split === 'amounts' && !value)) {
      parts.push({ kind: 'shares', member_id: memberId, shares: 1 });
    } else if (draft.split === 'shares') {
      const shares = /^\d+$/.test(value || '1') ? Number(value || '1') : 0;

      if (!shares) return fail('Use whole numbers of shares, such as 2.');
      parts.push({ kind: 'shares', member_id: memberId, shares });
    } else {
      const amount = parseAmount(value, draft.currency);

      if (amount === null) return fail(`Enter each amount in ${draft.currency}.`);
      parts.push({ kind: 'exact', member_id: memberId, amount });
    }
  }

  const allocated = allocate(total, parts);

  if (!allocated.ok) {
    return fail(
      allocated.error === 'remainder_without_shares'
        ? 'The amounts must add up to the total, or leave one blank to share the rest.'
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
 */
export function previewAllocation(snapshot: Snapshot, draft: ExpenseDraft): Map<string, number> {
  const result = entryFromDraft(draft);

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
 * Each currency's balances: every active member, and a hidden one only while
 * it is not settled there. Positive is owed to the member.
 */
export function balanceRows(snapshot: Snapshot): { currency: string; rows: BalanceRow[] }[] {
  const byCurrency = snapshot ? groupBalances(snapshot) : {};

  return Object.keys(byCurrency)
    .sort()
    .map((currency) => ({
      currency,
      rows: (snapshot?.members ?? []).flatMap((member) => {
        const amount = byCurrency[currency]?.[member.id] ?? 0;

        return member.status === 'active' || (member.status === 'hidden' && amount !== 0) ? [{ member, amount }] : [];
      }),
    }));
}
