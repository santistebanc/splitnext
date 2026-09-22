import { z } from 'zod';
import { groupAccessGrantSchema, groupDetailsSchema } from './groups';
import {
  ledgerMemberSchema,
  memberCommandSchema,
} from './members';

const identifierSchema = z.uuid();

export const groupSnapshotSchema = z.object({
  group: groupDetailsSchema,
  members: z.array(ledgerMemberSchema),
  access_grants: z.array(groupAccessGrantSchema),
});

export const syncGroupRequestSchema = z.object({
  known_revision: z.number().int().nonnegative().nullable(),
  commands: z.array(memberCommandSchema).max(100),
});

export const syncGroupCommandSchema = syncGroupRequestSchema.extend({
  group_id: identifierSchema,
  identity_id: identifierSchema,
});

export const commandOutcomeSchema = z.object({
  command_id: identifierSchema,
  command_type: z.enum([
    'member.create',
    'member.rename',
    'member.archive',
  ]),
  status: z.enum(['applied', 'no_effect', 'superseded', 'rejected']),
  reason: z
    .enum([
      'member_name_taken',
      'member_id_exists',
      'member_changed',
      'member_archived',
      'member_not_found',
      'idempotency_conflict',
    ])
    .nullable(),
  audit_id: identifierSchema.nullable(),
  target: z.object({
    kind: z.literal('member'),
    id: identifierSchema,
  }),
  server_state: z
    .object({
      kind: z.literal('member'),
      member: ledgerMemberSchema,
    })
    .nullable(),
});

export const syncGroupResponseSchema = z.object({
  revision: z.number().int().positive(),
  outcomes: z.array(commandOutcomeSchema),
  state: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('snapshot'),
      snapshot: groupSnapshotSchema,
    }),
    z.object({ kind: z.literal('unchanged') }),
  ]),
});

export type GroupSnapshot = z.output<typeof groupSnapshotSchema>;

export type SyncGroupRequest = z.output<typeof syncGroupRequestSchema>;

export type SyncGroupCommand = z.output<typeof syncGroupCommandSchema>;

export type SyncGroupResponse = z.output<typeof syncGroupResponseSchema>;

export type CommandOutcome = z.output<typeof commandOutcomeSchema>;
