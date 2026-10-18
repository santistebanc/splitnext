import { z } from 'zod';
import { identifierSchema } from './ids';
import type { LedgerMember } from './members';
import {
  allocate,
  balances,
  currencyCodeSchema,
  minorAmountSchema,
  type AllocationError,
  type AllocationPart,
  type CurrencyBalances,
  type CurrencyCode,
  type RoundingBurden,
} from './money';
import type { GroupSnapshot } from './sync';

/**
 * Expenses as the group records them: what was entered, the allocation the
 * money module fixed for it, and which members absorbed an extra minor unit.
 * See ADR 0019.
 */

export const expenseDescriptionSchema = z.string().trim().min(1).max(100);

export const allocationPartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), member_id: identifierSchema, amount: minorAmountSchema }),
  z.object({ kind: z.literal('shares'), member_id: identifierSchema, shares: z.number().int().positive().max(1_000_000) }),
]);

const allocationSchema = z.object({ member_id: identifierSchema, amount: minorAmountSchema });

/** What a person enters for an expense; the group allocates it. */
export const expenseEntrySchema = z.object({
  description: expenseDescriptionSchema,
  currency: currencyCodeSchema,
  total: minorAmountSchema.min(1),
  paid_by: identifierSchema,
  parts: z.array(allocationPartSchema).min(1).max(100),
});

export type ExpenseEntry = z.output<typeof expenseEntrySchema>;

/** Just the entered fields of a command payload or an intent. */
export function entryOf(payload: ExpenseEntry): ExpenseEntry {
  return {
    description: payload.description,
    currency: payload.currency,
    total: payload.total,
    paid_by: payload.paid_by,
    parts: payload.parts,
  };
}

export const expenseSchema = z.object({
  id: identifierSchema,
  description: z.string(),
  currency: currencyCodeSchema,
  total: minorAmountSchema,
  /** One payer for now; a list so several payers fit without a new model. */
  paid: z.array(allocationSchema),
  parts: z.array(allocationPartSchema),
  allocations: z.array(allocationSchema),
  /** Members who absorbed an extra minor unit, each once. */
  extras: z.array(identifierSchema),
  status: z.enum(['active', 'removed']),
  /** Increases on every change, so an edit can tell what the person saw. */
  version: z.number().int().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type Expense = z.output<typeof expenseSchema>;

/** Every member an expense names, as payer or participant. */
export function expenseMemberIds(expense: Pick<Expense, 'paid' | 'parts'> | ExpenseEntry): string[] {
  const payers = 'paid' in expense ? expense.paid.map((entry) => entry.member_id) : [expense.paid_by];

  return [...new Set([...payers, ...expense.parts.map((part) => part.member_id)])];
}

/** Whether any expense names the member, removed expenses included. */
export function memberHasRecords(snapshot: GroupSnapshot, memberId: string): boolean {
  return snapshot.expenses.some((expense) => expenseMemberIds(expense).includes(memberId));
}

/**
 * The extra minor units each member has absorbed in a currency, counted from
 * the expenses that are not removed, so removing, restoring, or editing one
 * changes it exactly. An edit leaves out the expense it replaces.
 */
export function roundingBurden(
  snapshot: GroupSnapshot,
  currency: CurrencyCode,
  exceptExpenseId?: string,
): RoundingBurden {
  const burden: RoundingBurden = {};

  for (const expense of snapshot.expenses) {
    if (expense.status === 'removed' || expense.currency !== currency || expense.id === exceptExpenseId) continue;

    for (const memberId of expense.extras) burden[memberId] = (burden[memberId] ?? 0) + 1;
  }

  return burden;
}

type RecordedAllocation = Pick<Expense, 'paid' | 'parts' | 'allocations' | 'extras'>;

export type AllocatedEntry =
  | { ok: true; recorded: RecordedAllocation }
  | { ok: false; error: AllocationError | 'member_not_found' };

/** Whether an entry restates what an expense already records. */
export function sameEntry(expense: Expense, entry: ExpenseEntry): boolean {
  const key = (parts: readonly AllocationPart[]) =>
    JSON.stringify([...parts].sort((left, right) => (left.member_id < right.member_id ? -1 : 1)));

  return (
    expense.description === entry.description &&
    expense.currency === entry.currency &&
    expense.total === entry.total &&
    expense.paid.length === 1 &&
    expense.paid[0]?.member_id === entry.paid_by &&
    key(expense.parts) === key(entry.parts)
  );
}

/** Allocates an entry against the group's current rounding burden in its currency. */
export function allocateEntry(snapshot: GroupSnapshot, entry: ExpenseEntry, exceptExpenseId?: string): AllocatedEntry {
  const known = new Set(snapshot.members.map((member) => member.id));

  if (!expenseMemberIds(entry).every((memberId) => known.has(memberId))) return { ok: false, error: 'member_not_found' };

  const burden = roundingBurden(snapshot, entry.currency, exceptExpenseId);
  const result = allocate(entry.total, entry.parts, burden);

  if (!result.ok) return result;

  return {
    ok: true,
    recorded: {
      paid: [{ member_id: entry.paid_by, amount: entry.total }],
      parts: entry.parts,
      allocations: result.allocations,
      extras: Object.keys(result.burden).filter((memberId) => result.burden[memberId] !== (burden[memberId] ?? 0)),
    },
  };
}

/** The group's members after an expense change, and those it brought back as hidden. */
export type KeptMembers = { members: LedgerMember[]; hidden: LedgerMember[] };

/**
 * Keeps every member an expense names: a deleted one becomes hidden, since it
 * now has a record. Active and hidden members stay as they are (ADR 0018).
 */
export function keepNamedMembers(snapshot: GroupSnapshot, memberIds: readonly string[], at: string): KeptMembers {
  const hidden: LedgerMember[] = [];

  const members = snapshot.members.map((member) => {
    if (member.status !== 'deleted' || !memberIds.includes(member.id)) return member;

    const kept = { ...member, status: 'hidden' as const, updated_at: at };

    hidden.push(kept);

    return kept;
  });

  return { members, hidden };
}

/** Balances per currency from the expenses that are not removed; currencies never combine. */
export function groupBalances(snapshot: GroupSnapshot): Record<CurrencyCode, CurrencyBalances> {
  return balances(snapshot.expenses.filter((expense) => expense.status === 'active'));
}
