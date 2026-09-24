import { z } from 'zod';
import { identifierSchema } from './ids';
import { memberNameSchema } from './members';

export const preferredMemberChoiceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    member_id: identifierSchema,
  }),
  z.object({
    kind: z.literal('new'),
    member_id: identifierSchema,
    display_name: memberNameSchema,
  }),
]);

export const joinGroupRequestSchema = z.object({
  join_id: identifierSchema,
  preferred_member: preferredMemberChoiceSchema,
});

export const joinGroupCommandSchema = joinGroupRequestSchema.extend({
  group_id: identifierSchema,
  identity_id: identifierSchema,
  joined_at: z.iso.datetime(),
});

export type PreferredMemberChoice = z.output<
  typeof preferredMemberChoiceSchema
>;

export type JoinGroupRequest = z.output<typeof joinGroupRequestSchema>;

export type JoinGroupCommand = z.output<typeof joinGroupCommandSchema>;
