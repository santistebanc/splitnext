import { z } from 'zod';
import { allocateEntry, entryOf, expenseEntrySchema, expenseMemberIds, expenseSchema, keepNamedMembers } from '../expenses';
import { identifierSchema } from '../ids';
import { ledgerMemberSchema } from '../members';
import { defineCommand, rejected, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const recordExpenseCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.recordExpense),
  payload: expenseEntrySchema.extend({
    expense_id: identifierSchema,
  }),
});

export type RecordExpenseCommand = z.output<typeof recordExpenseCommandSchema>;

/** An expense after a change, with the deleted members it brought back as hidden. */
export const expenseChangeSchema = z.object({
  expense: expenseSchema,
  hidden_members: z.array(ledgerMemberSchema),
});

export const expenseRecordedAuditSchema = z.object({
  action: z.literal('expense.recorded'),
  before: z.null(),
  after: expenseChangeSchema,
});

/**
 * Records an expense, allocated against the group's rounding burden when it
 * arrives. It applies even if a member it names was removed meanwhile; a
 * deleted one becomes hidden, so no work or balance is lost.
 */
export const expenseRecord = defineCommand<RecordExpenseCommand, IntentOf<RecordExpenseCommand, 'expense_id'>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'expense', id: command.payload.expense_id }),
  complete: (commandId, intent, snapshot, createId) => ({
    command_id: commandId,
    type: intent.type,
    payload: { ...entryOf(intent.payload), expense_id: intent.payload.expense_id ?? createId() },
  }),
  retryIntent: (command) => ({ type: command.type, payload: entryOf(command.payload) }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'expense' as const, id: command.payload.expense_id };
    const existing = snapshot.expenses.find((expense) => expense.id === command.payload.expense_id);

    if (existing) {
      return {
        snapshot,
        status: 'rejected',
        reason: 'expense_id_exists',
        target,
        serverState: { kind: 'expense', expense: existing },
        audit: null,
      };
    }

    const entry = entryOf(command.payload);
    const allocated = allocateEntry(snapshot, entry);

    if (!allocated.ok)
      return rejected(snapshot, target, allocated.error === 'member_not_found' ? 'member_not_found' : 'expense_invalid');

    const expense = {
      id: command.payload.expense_id,
      description: entry.description,
      currency: entry.currency,
      total: entry.total,
      ...allocated.recorded,
      status: 'active' as const,
      version: 1,
      created_at: appliedAt,
      updated_at: appliedAt,
    };

    const kept = keepNamedMembers(snapshot, expenseMemberIds(expense), appliedAt);

    return {
      snapshot: { ...snapshot, members: kept.members, expenses: [...snapshot.expenses, expense] },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'expense', expense },
      audit: { action: 'expense.recorded', before: null, after: { expense, hidden_members: kept.hidden } },
    };
  },
});
