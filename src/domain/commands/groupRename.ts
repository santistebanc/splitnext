import { z } from 'zod';
import { groupDetailsSchema, groupNameSchema } from '../groups';
import { identifierSchema } from '../ids';
import { defineCommand, unchanged, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const renameGroupCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.renameGroup),
  payload: z.object({
    expected_name: groupNameSchema,
    name: groupNameSchema,
  }),
});

export type RenameGroupCommand = z.output<typeof renameGroupCommandSchema>;

export const groupRenamedAuditSchema = z.object({
  action: z.literal('group.renamed'),
  before: groupDetailsSchema,
  after: groupDetailsSchema,
});

/**
 * Renames the group unless another rename got there first: the expected name
 * is the one the person saw, so a concurrent rename supersedes this one.
 */
export const groupRename = defineCommand<RenameGroupCommand, IntentOf<RenameGroupCommand, 'expected_name'>>({
  requiresServerDecision: false,
  target: (snapshot) => ({ kind: 'group', id: snapshot.group.id }),
  complete: (commandId, intent, snapshot) => ({
    command_id: commandId,
    type: intent.type,
    payload: {
      name: intent.payload.name,
      expected_name: intent.payload.expected_name ?? snapshot.group.name,
    },
  }),
  retryIntent: (command) => ({ type: command.type, payload: { name: command.payload.name } }),
  apply(snapshot, identityId, command) {
    const target = { kind: 'group' as const, id: snapshot.group.id };

    if (snapshot.group.name === command.payload.name)
      return unchanged(snapshot, target, { kind: 'group', group: snapshot.group });

    if (snapshot.group.name !== command.payload.expected_name) {
      return {
        snapshot,
        status: 'superseded',
        reason: 'group_changed',
        target,
        serverState: { kind: 'group', group: snapshot.group },
        audit: null,
      };
    }

    const group = { ...snapshot.group, name: command.payload.name };

    return {
      snapshot: { ...snapshot, group },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'group', group },
      audit: { action: 'group.renamed', before: snapshot.group, after: group },
    };
  },
});
