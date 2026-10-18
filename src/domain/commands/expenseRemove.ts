import { z } from 'zod';
import { expenseSchema } from '../expenses';
import { identifierSchema } from '../ids';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const removeExpenseCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.removeExpense),
  payload: z.object({
    expense_id: identifierSchema,
  }),
});

export type RemoveExpenseCommand = z.output<typeof removeExpenseCommandSchema>;

export const expenseRemovedAuditSchema = z.object({
  action: z.literal('expense.removed'),
  before: expenseSchema,
  after: expenseSchema,
});

/**
 * Takes an expense out of balances, keeping it so it can be restored. It
 * applies whatever version the person saw, since restoring undoes it.
 */
export const expenseRemove = defineCommand<RemoveExpenseCommand, IntentOf<RemoveExpenseCommand>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'expense', id: command.payload.expense_id }),
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command) => ({ type: command.type, payload: { expense_id: command.payload.expense_id } }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'expense' as const, id: command.payload.expense_id };
    const current = snapshot.expenses.find((expense) => expense.id === command.payload.expense_id);

    if (!current) return rejected(snapshot, target, 'expense_not_found');

    if (current.status === 'removed') return unchanged(snapshot, target, { kind: 'expense', expense: current });

    const expense = { ...current, status: 'removed' as const, version: current.version + 1, updated_at: appliedAt };

    return {
      snapshot: { ...snapshot, expenses: snapshot.expenses.map((entry) => (entry.id === expense.id ? expense : entry)) },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'expense', expense },
      audit: { action: 'expense.removed', before: current, after: expense },
    };
  },
});
