import { z } from 'zod';
import { groupAccessGrantSchema } from '../groups';
import { identifierSchema } from '../ids';
import { defineCommand, rejected, replaceAccess, unchanged, withResolvedMember, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const setPreferredMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.setPreferredMember),
  payload: z.object({ member_id: identifierSchema }),
});

export type SetPreferredMemberCommand = z.output<typeof setPreferredMemberCommandSchema>;

export const preferenceChangedAuditSchema = z.object({
  action: z.literal('preference.changed'),
  before: groupAccessGrantSchema,
  after: groupAccessGrantSchema,
});

/** Chooses which active member this identity calls "you"; a left identity has none. */
export const preferenceSet = defineCommand<SetPreferredMemberCommand, IntentOf<SetPreferredMemberCommand>>({
  requiresServerDecision: false,
  target: (snapshot, identityId) => ({ kind: 'access', id: identityId }),
  resolveAliases: withResolvedMember,
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command, member) => ({ type: command.type, payload: { member_id: member(command.payload.member_id) } }),
  apply(snapshot, identityId, command) {
    const target = { kind: 'access' as const, id: identityId };
    const access = snapshot.access_grants.find((candidate) => candidate.identity_id === identityId);

    if (!access) return rejected(snapshot, target, 'access_not_found');

    // A left identity has no "you"; rejoining chooses one again.
    if (access.hidden_at) return rejected(snapshot, target, 'group_left');
    const member = snapshot.members.find((candidate) => candidate.id === command.payload.member_id);

    if (!member) return rejected(snapshot, target, 'member_not_found');

    if (member.status === 'archived') return rejected(snapshot, target, 'member_archived');

    if (access.preferred_member_id === member.id) return unchanged(snapshot, target, { kind: 'access', access });

    const updated = { ...access, preferred_member_id: member.id };

    return {
      snapshot: replaceAccess(snapshot, updated),
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'access', access: updated },
      audit: { action: 'preference.changed', before: access, after: updated },
    };
  },
});
