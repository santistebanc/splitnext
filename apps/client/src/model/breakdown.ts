import type { ClientReplicaState, Expense } from '@splitnext/client';
import { memberName, moneyLabel } from './expenses';

type Snapshot = ClientReplicaState['projected_snapshot'];

/** One expense or repayment as it moves a member's balance; positive means they get money back. */
export type BreakdownRow =
  | { kind: 'expense'; id: string; at: string; title: string; detail: string; amount: number }
  | { kind: 'settlement'; id: string; at: string; from: string; to: string; detail: string; amount: number };

/**
 * Whether any current expense or repayment names the member. Someone with
 * records and a zero balance is settled; someone without has no expenses yet.
 */
export function hasRecords(snapshot: Snapshot, memberId: string): boolean {
  return Boolean(
    snapshot?.expenses.some((expense) => expense.status === 'active' && (expense.paid.some((entry) => entry.member_id === memberId) || expense.parts.some((part) => part.member_id === memberId))) ||
      snapshot?.settlements.some((settlement) => settlement.status === 'active' && (settlement.from_member_id === memberId || settlement.to_member_id === memberId)),
  );
}

/** A member's balance and every record it is made of, newest first. */
export type MemberBreakdown = { rows: BreakdownRow[]; total: number };

function shareText(expense: Expense, memberId: string, payer: boolean): string {
  const allocation = expense.allocations.find((entry) => entry.member_id === memberId)?.amount ?? 0;
  const part = expense.parts.find((entry) => entry.member_id === memberId);

  if (payer) return part ? `own share ${moneyLabel(allocation)}` : 'not sharing it';

  if (part?.kind === 'shares' && expense.parts.every((entry) => entry.kind === 'shares')) {
    const shares = expense.parts.reduce((sum, entry) => sum + (entry.kind === 'shares' ? entry.shares : 0), 0);

    return part.shares === 1 ? `share 1 of ${shares}` : `${part.shares} shares of ${shares}`;
  }

  return `share ${moneyLabel(allocation)}`;
}

/**
 * Everything that makes up a member's balance: what they paid minus their
 * share of each current expense, and each current repayment they made or
 * received. The rows add up exactly to the balance.
 */
export function memberBreakdown(snapshot: Snapshot, memberId: string, name: (memberId: string) => string = (id) => memberName(snapshot, id)): MemberBreakdown {
  const found: BreakdownRow[] = [];
  const add = (row: BreakdownRow) => found.push(row);

  for (const expense of snapshot?.expenses ?? []) {
    if (expense.status !== 'active') continue;
    const paid = expense.paid.find((entry) => entry.member_id === memberId)?.amount ?? 0;
    const owed = expense.allocations.find((entry) => entry.member_id === memberId)?.amount ?? 0;
    const named = paid > 0 || expense.parts.some((part) => part.member_id === memberId);

    if (!named) continue;
    const payer = expense.paid[0]?.member_id;

    add({
      kind: 'expense',
      id: expense.id,
      at: expense.created_at,
      title: expense.description,
      detail: `${payer ? name(payer) : 'Someone'} paid ${moneyLabel(expense.total)} · ${shareText(expense, memberId, payer === memberId)}`,
      amount: paid - owed,
    });
  }

  for (const settlement of snapshot?.settlements ?? []) {
    if (settlement.status !== 'active') continue;

    if (settlement.from_member_id !== memberId && settlement.to_member_id !== memberId) continue;

    add({
      kind: 'settlement',
      id: settlement.id,
      at: settlement.created_at,
      from: settlement.from_member_id,
      to: settlement.to_member_id,
      detail: 'Repayment',
      amount: settlement.from_member_id === memberId ? settlement.amount : -settlement.amount,
    });
  }

  const rows = found.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));

  return { rows, total: rows.reduce((sum, row) => sum + row.amount, 0) };
}
