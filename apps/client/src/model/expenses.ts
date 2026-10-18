import { activeMembers, formatAmount, type AllocationPart, type ClientReplicaState, type Expense } from '@splitnext/client';

type Snapshot = ClientReplicaState['projected_snapshot'] | undefined;

/** Expenses that count toward balances, newest recorded first. */
export function currentExpenses(snapshot: Snapshot): Expense[] {
  return (snapshot?.expenses ?? []).filter((expense) => expense.status === 'active').reverse();
}

/** An expense as people refer to it, such as "Dinner · 42.50 EUR". */
export function expenseLabel(expense: Pick<Expense, 'description' | 'total' | 'currency'>): string {
  return `${expense.description} · ${formatAmount(expense.total, expense.currency)} ${expense.currency}`;
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
