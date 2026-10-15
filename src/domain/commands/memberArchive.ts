import { z } from 'zod';
import { identifierSchema } from '../ids';
import { ledgerMemberSchema } from '../members';
import { defineCommand, withResolvedMember, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const archiveMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.archiveMember),
  payload: z.object({
    member_id: identifierSchema,
  }),
});

export type ArchiveMemberCommand = z.output<typeof archiveMemberCommandSchema>;

const archivedMemberStateSchema = z.object({
  member: ledgerMemberSchema,
  preferred_by: z.array(identifierSchema),
});

export const memberArchivedAuditSchema = z.object({
  action: z.literal('member.archived'),
  before: archivedMemberStateSchema,
  after: archivedMemberStateSchema,
});

/**
 * Archives a member, keeping them for history, and clears every identity's
 * choice of that member as "you".
 */
export const memberArchive = defineCommand<ArchiveMemberCommand, IntentOf<ArchiveMemberCommand>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'member', id: command.payload.member_id }),
  resolveAliases: withResolvedMember,
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command, member) => ({ type: command.type, payload: { member_id: member(command.payload.member_id) } }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'member' as const, id: command.payload.member_id };
    const current = snapshot.members.find((member) => member.id === command.payload.member_id);

    if (!current) {
      return { snapshot, status: 'rejected', reason: 'member_not_found', target, serverState: null, audit: null };
    }

    if (current.status === 'archived') {
      return { snapshot, status: 'no_effect', reason: null, target, serverState: { kind: 'member', member: current }, audit: null };
    }

    const member = { ...current, status: 'archived' as const, updated_at: appliedAt };

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
        action: 'member.archived',
        before: { member: current, preferred_by: orphaned },
        after: { member, preferred_by: [] },
      },
    };
  },
});
