import { z } from 'zod';
import { expenseSchema } from '../expenses';
import { groupAccessGrantSchema, groupDetailsSchema } from '../groups';
import { identifierSchema } from '../ids';
import { ledgerMemberSchema } from '../members';

/**
 * Each command's name, used for its app action and SDK intent, and the wire
 * type it is stored and synchronized as.
 */
export const groupCommandTypes = {
  renameGroup: 'group.rename',
  createMember: 'member.create',
  renameMember: 'member.rename',
  removeMember: 'member.remove',
  restoreMember: 'member.restore',
  recordExpense: 'expense.record',
  editExpense: 'expense.edit',
  removeExpense: 'expense.remove',
  restoreExpense: 'expense.restore',
  setPreferredMember: 'preference.set',
  leaveGroup: 'group.leave',
} as const;

export const groupCommandTypeSchema = z.enum(groupCommandTypes);

export const commandReasons = {
  accessNotFound: 'access_not_found',
  expenseChanged: 'expense_changed',
  expenseIdExists: 'expense_id_exists',
  expenseInvalid: 'expense_invalid',
  expenseNotFound: 'expense_not_found',
  expenseRemoved: 'expense_removed',
  groupChanged: 'group_changed',
  groupLeft: 'group_left',
  idempotencyConflict: 'idempotency_conflict',
  memberChanged: 'member_changed',
  memberIdExists: 'member_id_exists',
  memberNotFound: 'member_not_found',
  memberRemoved: 'member_removed',
} as const;

export const commandReasonSchema = z.enum(commandReasons);

export type CommandReason = z.output<typeof commandReasonSchema>;

export const commandTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), id: identifierSchema }),
  z.object({ kind: z.literal('member'), id: identifierSchema }),
  z.object({ kind: z.literal('expense'), id: identifierSchema }),
  z.object({ kind: z.literal('access'), id: identifierSchema }),
  z.object({ kind: z.literal('invite'), id: identifierSchema }),
]);

export type CommandTarget = z.output<typeof commandTargetSchema>;

export const commandServerStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), group: groupDetailsSchema }),
  z.object({ kind: z.literal('member'), member: ledgerMemberSchema }),
  z.object({ kind: z.literal('expense'), expense: expenseSchema }),
  z.object({ kind: z.literal('access'), access: groupAccessGrantSchema }),
]);

export type CommandServerState = z.output<typeof commandServerStateSchema>;

export const commandOutcomeSchema = z.object({
  command_id: identifierSchema,
  command_type: groupCommandTypeSchema,
  status: z.enum(['applied', 'no_effect', 'superseded', 'rejected']),
  reason: commandReasonSchema.nullable(),
  audit_id: identifierSchema.nullable(),
  target: commandTargetSchema,
  server_state: commandServerStateSchema.nullable(),
});

export type CommandOutcome = z.output<typeof commandOutcomeSchema>;
