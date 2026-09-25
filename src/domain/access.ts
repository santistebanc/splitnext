import { z } from 'zod';
import { identifierSchema } from './ids';
import { inviteTokenSchema } from './invites';
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

/** Identities joining for the first time need a current invite token. */
export const joinGroupRequestSchema = z.object({
  join_id: identifierSchema,
  preferred_member: preferredMemberChoiceSchema,
  invite_token: inviteTokenSchema.optional(),
});

/** The token itself never enters a Durable Object; only its hash does. */
export const joinGroupCommandSchema = joinGroupRequestSchema
  .omit({ invite_token: true })
  .extend({
    group_id: identifierSchema,
    identity_id: identifierSchema,
    joined_at: z.iso.datetime(),
    invite_token_hash: z.string().nullable(),
  });

export type PreferredMemberChoice = z.output<
  typeof preferredMemberChoiceSchema
>;

export type JoinGroupRequest = z.output<typeof joinGroupRequestSchema>;

export type JoinGroupCommand = z.output<typeof joinGroupCommandSchema>;
