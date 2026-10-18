import { z } from 'zod';
import { groupAccessGrantSchema } from '../groups';
import { identifierSchema } from '../ids';
import { defineCommand, rejected, replaceAccess, unchanged, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const leaveGroupCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.leaveGroup),
  payload: z.object({}),
});

export type LeaveGroupCommand = z.output<typeof leaveGroupCommandSchema>;

export const groupLeftAuditSchema = z.object({
  action: z.literal('group.left'),
  before: groupAccessGrantSchema,
  after: groupAccessGrantSchema,
});

/**
 * Hides the group for this identity and clears its "you" without revoking
 * its permanent access. Leaving deliberately stops authority, so it can only
 * start online; once queued it completes like any other command.
 */
export const groupLeave = defineCommand<LeaveGroupCommand, IntentOf<LeaveGroupCommand>>({
  requiresServerDecision: true,
  target: (snapshot, identityId) => ({ kind: 'access', id: identityId }),
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command) => ({ type: command.type, payload: {} }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'access' as const, id: identityId };
    const access = snapshot.access_grants.find((candidate) => candidate.identity_id === identityId);

    if (!access) return rejected(snapshot, target, 'access_not_found');

    if (access.hidden_at !== null && access.preferred_member_id === null)
      return unchanged(snapshot, target, { kind: 'access', access });

    const updated = { ...access, preferred_member_id: null, hidden_at: appliedAt };

    return {
      snapshot: replaceAccess(snapshot, updated),
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'access', access: updated },
      audit: { action: 'group.left', before: access, after: updated },
    };
  },
});
