import { z } from 'zod';
import { identifierSchema } from '../ids';
import { ledgerMemberSchema } from '../members';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const restoreMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.restoreMember),
  payload: z.object({
    member_id: identifierSchema,
  }),
});

export type RestoreMemberCommand = z.output<typeof restoreMemberCommandSchema>;

export const memberRestoredAuditSchema = z.object({
  action: z.literal('member.restored'),
  before: ledgerMemberSchema,
  after: ledgerMemberSchema,
});

/**
 * Makes a hidden or deleted member active again. Nobody's choice of it as
 * "you" returns; each identity chooses again.
 */
export const memberRestore = defineCommand<RestoreMemberCommand, IntentOf<RestoreMemberCommand>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'member', id: command.payload.member_id }),
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command) => ({ type: command.type, payload: { member_id: command.payload.member_id } }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'member' as const, id: command.payload.member_id };
    const current = snapshot.members.find((member) => member.id === command.payload.member_id);

    if (!current) return rejected(snapshot, target, 'member_not_found');

    if (current.status === 'active') return unchanged(snapshot, target, { kind: 'member', member: current });

    const member = { ...current, status: 'active' as const, updated_at: appliedAt };

    return {
      snapshot: { ...snapshot, members: snapshot.members.map((entry) => (entry.id === member.id ? member : entry)) },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'member', member },
      audit: { action: 'member.restored', before: current, after: member },
    };
  },
});
