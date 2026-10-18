import { z } from 'zod';
import { identifierSchema } from '../ids';
import { ledgerMemberSchema } from '../members';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const removeMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.removeMember),
  payload: z.object({
    member_id: identifierSchema,
  }),
});

export type RemoveMemberCommand = z.output<typeof removeMemberCommandSchema>;

const removedMemberStateSchema = z.object({
  member: ledgerMemberSchema,
  preferred_by: z.array(identifierSchema),
});

export const memberRemovedAuditSchema = z.object({
  action: z.literal('member.removed'),
  before: removedMemberStateSchema,
  after: removedMemberStateSchema,
});

/**
 * Removes a member and clears every identity's choice of it as "you". The
 * member is deleted, and kept only so a late command can still reach it.
 */
export const memberRemove = defineCommand<RemoveMemberCommand, IntentOf<RemoveMemberCommand>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'member', id: command.payload.member_id }),
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command) => ({ type: command.type, payload: { member_id: command.payload.member_id } }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'member' as const, id: command.payload.member_id };
    const current = snapshot.members.find((member) => member.id === command.payload.member_id);

    if (!current) return rejected(snapshot, target, 'member_not_found');

    if (current.status !== 'active') return unchanged(snapshot, target, { kind: 'member', member: current });

    const member = { ...current, status: 'deleted' as const, updated_at: appliedAt };

    const orphaned = snapshot.access_grants.flatMap((grant) =>
      grant.preferred_member_id === current.id ? [grant.identity_id] : [],
    );

    return {
      snapshot: {
        ...snapshot,
        members: snapshot.members.map((entry) => (entry.id === member.id ? member : entry)),
        access_grants: snapshot.access_grants.map((grant) =>
          grant.preferred_member_id === member.id ? { ...grant, preferred_member_id: null } : grant,
        ),
      },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'member', member },
      audit: {
        action: 'member.removed',
        before: { member: current, preferred_by: orphaned },
        after: { member, preferred_by: [] },
      },
    };
  },
});
