import { z } from 'zod';
import type { GroupSnapshot } from './sync';
import type { CommandDefinition, CommandTransition } from './commands/define';
import type { CommandTarget } from './commands/outcomes';
import { editExpenseCommandSchema, expenseEdit } from './commands/expenseEdit';
import { expenseRecord, recordExpenseCommandSchema } from './commands/expenseRecord';
import { expenseRemove, removeExpenseCommandSchema } from './commands/expenseRemove';
import { expenseRestore, restoreExpenseCommandSchema } from './commands/expenseRestore';
import { groupLeave, leaveGroupCommandSchema } from './commands/groupLeave';
import { groupRename, renameGroupCommandSchema } from './commands/groupRename';
import { createMemberCommandSchema, memberCreate } from './commands/memberCreate';
import { memberRemove, removeMemberCommandSchema } from './commands/memberRemove';
import { memberRename, renameMemberCommandSchema } from './commands/memberRename';
import { memberRestore, restoreMemberCommandSchema } from './commands/memberRestore';
import { preferenceSet, setPreferredMemberCommandSchema } from './commands/preferenceSet';

/**
 * Every group command, one file each in ./commands/: its schema, the rule the
 * server and every client projection apply, its target, how a person's
 * intent completes into it, how a rejected one is retried, and its audit
 * change. To add a command, add its file and list it
 * in `groupCommandSchema` and `registered`; the types reject a missing or
 * mismatched entry.
 */

export * from './commands/outcomes';

export type { CommandTransition } from './commands/define';

export { applyGroupJoin, type JoinTransition } from './join';

export type { CreateMemberCommand } from './commands/memberCreate';

export type { RenameMemberCommand } from './commands/memberRename';

export type { RemoveMemberCommand } from './commands/memberRemove';

export type { RestoreMemberCommand } from './commands/memberRestore';

export type { RecordExpenseCommand } from './commands/expenseRecord';

export type { EditExpenseCommand } from './commands/expenseEdit';

export const groupCommandSchema = z.discriminatedUnion('type', [
  renameGroupCommandSchema,
  createMemberCommandSchema,
  renameMemberCommandSchema,
  removeMemberCommandSchema,
  restoreMemberCommandSchema,
  recordExpenseCommandSchema,
  editExpenseCommandSchema,
  removeExpenseCommandSchema,
  restoreExpenseCommandSchema,
  setPreferredMemberCommandSchema,
  leaveGroupCommandSchema,
]);

export type GroupCommand = z.output<typeof groupCommandSchema>;

const registered = {
  'group.rename': groupRename,
  'member.create': memberCreate,
  'member.rename': memberRename,
  'member.remove': memberRemove,
  'member.restore': memberRestore,
  'expense.record': expenseRecord,
  'expense.edit': expenseEdit,
  'expense.remove': expenseRemove,
  'expense.restore': expenseRestore,
  'preference.set': preferenceSet,
  'group.leave': groupLeave,
};

type CommandMap = { [C in GroupCommand as C['type']]: C };

type IntentMap = { [T in keyof typeof registered]: Parameters<(typeof registered)[T]['complete']>[1] };

/** Each wire type's definition, typed so a missing or mismatched entry fails to compile. */
type CommandRegistry = { [T in keyof CommandMap]: CommandDefinition<CommandMap[T], IntentMap[T]> };

const definitions: CommandRegistry = registered;

/**
 * A command as a person states it. The client assigns its identifiers and
 * fills an omitted precondition from the state the person saw.
 */
export type CommandIntent = IntentMap[keyof IntentMap];

export function applyGroupCommand(
  snapshot: GroupSnapshot,
  identityId: string,
  command: GroupCommand,
  appliedAt: string,
): CommandTransition {
  return apply(command.type, command, snapshot, identityId, appliedAt);
}

function apply<T extends keyof CommandMap>(
  type: T,
  command: CommandMap[T],
  snapshot: GroupSnapshot,
  identityId: string,
  appliedAt: string,
): CommandTransition {
  return definitions[type].apply(snapshot, identityId, command, appliedAt);
}

export function commandTarget(
  snapshot: GroupSnapshot,
  identityId: string,
  command: GroupCommand,
): CommandTarget {
  return target(command.type, command, snapshot, identityId);
}

function target<T extends keyof CommandMap>(
  type: T,
  command: CommandMap[T],
  snapshot: GroupSnapshot,
  identityId: string,
): CommandTarget {
  return definitions[type].target(snapshot, identityId, command);
}

/** Completes an intent against the projection the person saw. */
export function commandFromIntent(
  intent: CommandIntent,
  snapshot: GroupSnapshot,
  createId: () => string,
): GroupCommand {
  return complete(intent.type, intent, snapshot, createId);
}

function complete<T extends keyof CommandMap>(
  type: T,
  intent: IntentMap[T],
  snapshot: GroupSnapshot,
  createId: () => string,
): GroupCommand {
  return definitions[type].complete(createId(), intent, snapshot, createId);
}

/** The intent behind a rejected or superseded command, without its stale preconditions. */
export function intentForRetry(command: GroupCommand): CommandIntent {
  return retry(command.type, command);
}

function retry<T extends keyof CommandMap>(type: T, command: CommandMap[T]): CommandIntent {
  return definitions[type].retryIntent(command);
}

/** Commands that deliberately stop authority, such as leaving, must start online. */
export function requiresServerDecision(type: GroupCommand['type']): boolean {
  return definitions[type].requiresServerDecision;
}
