import { z } from 'zod';
import {
  commandOutcomeSchema,
  groupCommandSchema,
} from './commands';
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

export type GroupSession = z.output<typeof groupSessionSchema>;

export type { CommandOutcome } from './commands';
