import { z } from 'zod';
import { identifierSchema } from '../ids';
import { ledgerMemberSchema, memberNameSchema } from '../members';
import { defineCommand, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const createMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.createMember),
  payload: z.object({
    member_id: identifierSchema,
    display_name: memberNameSchema,
  }),
});

export type CreateMemberCommand = z.output<typeof createMemberCommandSchema>;

export const memberCreatedAuditSchema = z.object({
  action: z.literal('member.created'),
  before: z.null(),
  after: ledgerMemberSchema,
});

/**
 * Adds a member. Names may repeat: each creation is its own member, told
 * apart from same-named ones by a name ordinal.
 */
export const memberCreate = defineCommand<CreateMemberCommand, IntentOf<CreateMemberCommand, 'member_id'>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'member', id: command.payload.member_id }),
  complete: (commandId, intent, snapshot, createId) => ({
    command_id: commandId,
    type: intent.type,
    payload: {
      member_id: intent.payload.member_id ?? createId(),
      display_name: intent.payload.display_name,
    },
  }),
  retryIntent: (command) => ({ type: command.type, payload: { display_name: command.payload.display_name } }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'member' as const, id: command.payload.member_id };
    const withId = snapshot.members.find((member) => member.id === command.payload.member_id);

    if (withId) {
      return {
        snapshot,
        status: 'rejected',
        reason: 'member_id_exists',
        target,
        serverState: { kind: 'member', member: withId },
        audit: null,
      };
    }

    const member = {
      id: command.payload.member_id,
      display_name: command.payload.display_name,
      status: 'active' as const,
      created_at: appliedAt,
      updated_at: appliedAt,
    };

    return {
      snapshot: { ...snapshot, members: [...snapshot.members, member] },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'member', member },
      audit: { action: 'member.created', before: null, after: member },
    };
  },
});
