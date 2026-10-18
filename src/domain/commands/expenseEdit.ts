import { z } from 'zod';
import { allocateEntry, entryOf, expenseEntrySchema, expenseMemberIds, expenseSchema, keepNamedMembers, sameEntry } from '../expenses';
import { identifierSchema } from '../ids';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { expenseChangeSchema } from './expenseRecord';
import { groupCommandTypes } from './outcomes';

export const editExpenseCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.editExpense),
  payload: expenseEntrySchema.extend({
    expense_id: identifierSchema,
    expected_version: z.number().int().positive(),
  }),
});

export type EditExpenseCommand = z.output<typeof editExpenseCommandSchema>;

export const expenseEditedAuditSchema = z.object({
  action: z.literal('expense.edited'),
  before: expenseSchema,
  after: expenseChangeSchema,
});

/**
 * Replaces everything entered for an expense, unless someone changed it since
 * the version the person saw. The allocation is made again, without the extra
 * units this expense had absorbed.
 */
export const expenseEdit = defineCommand<EditExpenseCommand, IntentOf<EditExpenseCommand, 'expected_version'>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'expense', id: command.payload.expense_id }),
  complete(commandId, intent, snapshot) {
    const expenseId = intent.payload.expense_id;
    const expense = snapshot.expenses.find((candidate) => candidate.id === expenseId);

    if (!expense) throw new Error('expense_not_found_locally');

    return {
      command_id: commandId,
      type: intent.type,
      payload: {
        ...entryOf(intent.payload),
        expense_id: expense.id,
        expected_version: intent.payload.expected_version ?? expense.version,
      },
    };
  },
  retryIntent: (command) => ({
    type: command.type,
    payload: { ...entryOf(command.payload), expense_id: command.payload.expense_id },
  }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'expense' as const, id: command.payload.expense_id };
    const current = snapshot.expenses.find((expense) => expense.id === command.payload.expense_id);

    if (!current) return rejected(snapshot, target, 'expense_not_found');

    const serverState = { kind: 'expense' as const, expense: current };

    const outcome = (status: 'superseded' | 'rejected', reason: 'expense_changed' | 'expense_removed') => ({
      snapshot,
      status,
      reason,
      target,
      serverState,
      audit: null,
    });

    if (current.status === 'removed') return outcome('rejected', 'expense_removed');

    const entry = entryOf(command.payload);

    if (sameEntry(current, entry)) return unchanged(snapshot, target, serverState);

    if (current.version !== command.payload.expected_version) return outcome('superseded', 'expense_changed');

    const allocated = allocateEntry(snapshot, entry, current.id);

    if (!allocated.ok)
      return rejected(snapshot, target, allocated.error === 'member_not_found' ? 'member_not_found' : 'expense_invalid');

    const expense = {
      ...current,
      description: entry.description,
      currency: entry.currency,
      total: entry.total,
      ...allocated.recorded,
      version: current.version + 1,
      updated_at: appliedAt,
    };

    const kept = keepNamedMembers(snapshot, expenseMemberIds(expense), appliedAt);

    return {
      snapshot: {
        ...snapshot,
        members: kept.members,
        expenses: snapshot.expenses.map((entry) => (entry.id === expense.id ? expense : entry)),
      },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'expense', expense },
      audit: { action: 'expense.edited', before: current, after: { expense, hidden_members: kept.hidden } },
    };
  },
});
