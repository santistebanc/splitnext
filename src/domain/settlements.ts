import { z } from 'zod';
import { identifierSchema } from './ids';
import { currencyCodeSchema, minorAmountSchema } from './money';
import type { GroupSnapshot } from './sync';
import { groupBalances } from './expenses';

/** Money already paid outside Splitnext, independent of expense spending. */
export const settlementEntrySchema = z.object({
  from_member_id: identifierSchema,
  to_member_id: identifierSchema,
  currency: currencyCodeSchema,
  amount: minorAmountSchema.min(1),
});

export type SettlementEntry = z.output<typeof settlementEntrySchema>;

export const settlementSchema = settlementEntrySchema.extend({
  id: identifierSchema,
  status: z.enum(['active', 'removed']),
  version: z.number().int().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type Settlement = z.output<typeof settlementSchema>;

export function settlementEntry(value: SettlementEntry): SettlementEntry {
  return { from_member_id: value.from_member_id, to_member_id: value.to_member_id, currency: value.currency, amount: value.amount };
}

export function settlementProblem(snapshot: GroupSnapshot, entry: SettlementEntry) {
  if (entry.from_member_id === entry.to_member_id) return 'settlement_invalid' as const;

  if (![entry.from_member_id, entry.to_member_id].every((id) => snapshot.members.some((member) => member.id === id))) return 'member_not_found' as const;

  return null;
}

/** Active members and removed members who still have a nonzero balance. */
export function repaymentMembers(snapshot: GroupSnapshot | null | undefined) {
  if (!snapshot) return [];
  const balances = groupBalances(snapshot);

  return snapshot.members.filter((member) => member.status === 'active' || Object.values(balances).some((currency) => currency[member.id]));
}

/** Above this many unsettled members in one currency, the plan stops searching for the fewest payments. */
const exactPlanLimit = 14;

type Balance = { id: string; amount: number };

/** Greedy transfers that settle balances summing to zero, at most one fewer than there are members. */
function greedyTransfers(currency: string, entries: readonly Balance[]): SettlementEntry[] {
  const result: SettlementEntry[] = [];
  const debtors = entries.flatMap((entry) => (entry.amount < 0 ? [{ id: entry.id, amount: -entry.amount }] : []));
  const creditors = entries.flatMap((entry) => (entry.amount > 0 ? [{ ...entry }] : []));
  let index = 0;

  for (const debtor of debtors) {
    while (debtor.amount > 0) {
      const creditor = creditors[index];

      if (!creditor) break;
      const amount = Math.min(debtor.amount, creditor.amount);
      result.push({ currency, from_member_id: debtor.id, to_member_id: creditor.id, amount });
      debtor.amount -= amount;
      creditor.amount -= amount;

      if (!creditor.amount) index++;
    }
  }

  return result;
}

/**
 * Splits balances into as many separately settled sets as possible, each
 * summing to zero. A set of k members settles in k − 1 payments, so more sets
 * mean fewer payments overall.
 */
function zeroSumSets(entries: readonly Balance[]): Balance[][] {
  const count = entries.length;
  const full = (1 << count) - 1;
  const sums = Array.from({ length: full + 1 }, () => 0);
  const sets = Array.from({ length: full + 1 }, () => 0);

  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    sums[mask] = sums[mask ^ low]! + entries[31 - Math.clz32(low)]!.amount;
    let best = 0;

    for (let bit = 1; bit <= mask; bit <<= 1)
      if (mask & bit) best = Math.max(best, sets[mask ^ bit]!);
    sets[mask] = best + (sums[mask] === 0 ? 1 : 0);
  }

  // Follow one optimal chain of removals; each zero-sum mask along it closes a set.
  const closed: number[] = [];

  for (let mask = full; mask; ) {
    if (sums[mask] === 0) closed.push(mask);
    const own = sums[mask] === 0 ? 1 : 0;
    let bit = 1;

    while (!(mask & bit) || sets[mask ^ bit]! + own !== sets[mask]) bit <<= 1;
    mask ^= bit;
  }

  return closed.map((mask, index) => {
    const set = mask & ~(closed[index + 1] ?? 0);

    return entries.filter((_, position) => set & (1 << position));
  });
}

const plans = new WeakMap<GroupSnapshot, SettlementEntry[]>();

/**
 * The group-wide settle-up plan: transfers that bring every balance to zero,
 * per currency, with as few payments as possible. A payment may skip people in
 * the middle, such as Ana paying Cara directly. Deterministic for a snapshot;
 * very large groups fall back to a greedy plan.
 */
export function settlementSuggestions(snapshot: GroupSnapshot): SettlementEntry[] {
  const cached = plans.get(snapshot);

  if (cached) return cached;
  const result: SettlementEntry[] = [];
  const balances = groupBalances(snapshot);

  for (const currency of Object.keys(balances).sort()) result.push(...planTransfers(currency, balances[currency] ?? {}));

  plans.set(snapshot, result);

  return result;
}

/** Fewest transfers settling one currency's balances, which must sum to zero. */
export function planTransfers(currency: string, balances: Readonly<Record<string, number>>): SettlementEntry[] {
  const entries = Object.entries(balances)
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([id, amount]) => ({ id, amount }));

  if (entries.length > exactPlanLimit) return greedyTransfers(currency, entries);

  return zeroSumSets(entries).flatMap((set) => greedyTransfers(currency, set));
}

/** The plan's payments that a member makes or receives, which settle that member completely. */
export function memberSettlements(snapshot: GroupSnapshot, memberId: string): SettlementEntry[] {
  return settlementSuggestions(snapshot).filter((entry) => entry.from_member_id === memberId || entry.to_member_id === memberId);
}

export function settlementMemberIds(entry: SettlementEntry): string[] {
  return [entry.from_member_id, entry.to_member_id];
}
