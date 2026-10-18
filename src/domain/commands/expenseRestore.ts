import { z } from 'zod';
import { expenseMemberIds, expenseSchema, keepNamedMembers } from '../expenses';
import { identifierSchema } from '../ids';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { expenseChangeSchema } from './expenseRecord';
import { groupCommandTypes } from './outcomes';

export const restoreExpenseCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.restoreExpense),
  payload: z.object({
    expense_id: identifierSchema,
  }),
});

export type RestoreExpenseCommand = z.output<typeof restoreExpenseCommandSchema>;

export const expenseRestoredAuditSchema = z.object({
  action: z.literal('expense.restored'),
  before: expenseSchema,
  after: expenseChangeSchema,
});

/**
 * Returns a removed expense to balances exactly as it was recorded, with its
 * original allocation, even if members it names were removed since.
 */
export const expenseRestore = defineCommand<RestoreExpenseCommand, IntentOf<RestoreExpenseCommand>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'expense', id: command.payload.expense_id }),
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command) => ({ type: command.type, payload: { expense_id: command.payload.expense_id } }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'expense' as const, id: command.payload.expense_id };
    const current = snapshot.expenses.find((expense) => expense.id === command.payload.expense_id);

    if (!current) return rejected(snapshot, target, 'expense_not_found');

    if (current.status === 'active') return unchanged(snapshot, target, { kind: 'expense', expense: current });

    const expense = { ...current, status: 'active' as const, version: current.version + 1, updated_at: appliedAt };
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
      audit: { action: 'expense.restored', before: current, after: { expense, hidden_members: kept.hidden } },
    };
  },
});
