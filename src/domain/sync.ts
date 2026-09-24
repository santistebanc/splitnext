import { z } from 'zod';
import { groupCommandSchema } from './commands';
import { groupAccessGrantSchema, groupDetailsSchema } from './groups';
import { identifierSchema } from './ids';
import { ledgerMemberSchema } from './members';

export const groupSnapshotSchema = z.object({
  group: groupDetailsSchema,
  members: z.array(ledgerMemberSchema),
  access_grants: z.array(groupAccessGrantSchema),
});

export const syncGroupRequestSchema = z.object({
  known_revision: z.number().int().nonnegative().nullable(),
  commands: z.array(groupCommandSchema).max(100),
});

export const syncGroupCommandSchema = syncGroupRequestSchema.extend({
  group_id: identifierSchema,
  identity_id: identifierSchema,
});

export const commandOutcomeSchema = z.object({
  command_id: identifierSchema,
  command_type: z.enum([
    'group.rename',
    'member.create',
    'member.rename',
    'member.archive',
    'preference.set',
    'group.leave',
  ]),
  status: z.enum(['applied', 'no_effect', 'superseded', 'rejected']),
  reason: z
    .enum([
      'member_name_taken',
      'member_id_exists',
      'member_changed',
      'member_archived',
      'member_not_found',
      'group_changed',
      'access_not_found',
      'idempotency_conflict',
    ])
    .nullable(),
  audit_id: identifierSchema.nullable(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('group'), id: identifierSchema }),
    z.object({ kind: z.literal('member'), id: identifierSchema }),
    z.object({ kind: z.literal('access'), id: identifierSchema }),
  ]),
  server_state: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('group'), group: groupDetailsSchema }),
      z.object({ kind: z.literal('member'), member: ledgerMemberSchema }),
      z.object({ kind: z.literal('access'), access: groupAccessGrantSchema }),
    ])
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

export const groupSessionSchema = z.object({
  revision: z.number().int().positive(),
  snapshot: groupSnapshotSchema,
  access: groupAccessGrantSchema,
});

export type GroupSnapshot = z.output<typeof groupSnapshotSchema>;

export type SyncGroupRequest = z.output<typeof syncGroupRequestSchema>;

export type SyncGroupCommand = z.output<typeof syncGroupCommandSchema>;

export type SyncGroupResponse = z.output<typeof syncGroupResponseSchema>;

export type CommandOutcome = z.output<typeof commandOutcomeSchema>;

export type GroupSession = z.output<typeof groupSessionSchema>;
