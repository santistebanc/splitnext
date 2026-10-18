import { z } from 'zod';
import { identifierSchema } from '../ids';
import { ledgerMemberSchema, memberNameSchema } from '../members';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const renameMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.renameMember),
  payload: z.object({
    member_id: identifierSchema,
    expected_display_name: memberNameSchema,
    display_name: memberNameSchema,
  }),
});

export type RenameMemberCommand = z.output<typeof renameMemberCommandSchema>;

export const memberRenamedAuditSchema = z.object({
  action: z.literal('member.renamed'),
  before: ledgerMemberSchema,
  after: ledgerMemberSchema,
});

/**
 * Renames an active member unless the name the person saw changed meanwhile.
 * Another member may already use the new name.
 */
export const memberRename = defineCommand<RenameMemberCommand, IntentOf<RenameMemberCommand, 'expected_display_name'>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'member', id: command.payload.member_id }),
  complete(commandId, intent, snapshot) {
    const memberId = intent.payload.member_id;
    const member = snapshot.members.find((candidate) => candidate.id === memberId);

    if (!member) throw new Error('member_not_found_locally');

    return {
      command_id: commandId,
      type: intent.type,
      payload: {
        member_id: member.id,
        display_name: intent.payload.display_name,
        expected_display_name: intent.payload.expected_display_name ?? member.display_name,
      },
    };
  },
  retryIntent: (command) => ({
    type: command.type,
    payload: { member_id: command.payload.member_id, display_name: command.payload.display_name },
  }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'member' as const, id: command.payload.member_id };
    const current = snapshot.members.find((member) => member.id === command.payload.member_id);

    if (!current) return rejected(snapshot, target, 'member_not_found');

    const serverState = { kind: 'member' as const, member: current };

    const outcome = (status: 'superseded' | 'rejected', reason: 'member_changed' | 'member_removed') => ({
      snapshot,
      status,
      reason,
      target,
      serverState,
      audit: null,
    });

    if (current.status !== 'active') return outcome('rejected', 'member_removed');

    if (current.display_name === command.payload.display_name) return unchanged(snapshot, target, serverState);

    if (current.display_name !== command.payload.expected_display_name) return outcome('superseded', 'member_changed');

    const member = { ...current, display_name: command.payload.display_name, updated_at: appliedAt };

    return {
      snapshot: { ...snapshot, members: snapshot.members.map((entry) => (entry.id === member.id ? member : entry)) },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'member', member },
      audit: { action: 'member.renamed', before: current, after: member },
    };
  },
});
