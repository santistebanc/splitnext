import { z } from 'zod';
import { memberNameSchema } from './members';

const identifierSchema = z.uuid();

export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const preferredMemberChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), member_id: identifierSchema }),
  z.object({
    kind: z.literal('new'),
    member_id: identifierSchema,
    display_name: memberNameSchema,
  }),
]);

export const redeemGroupLinkRequestSchema = z.object({
  preferred_member: preferredMemberChoiceSchema,
});

export type RedeemGroupLinkRequest = z.output<
  typeof redeemGroupLinkRequestSchema
>;

export const rotateGroupLinkCommandSchema = z.object({
  group_id: identifierSchema,
  identity_id: identifierSchema,
  invite_id: identifierSchema,
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});

export const redeemGroupLinkCommandSchema = redeemGroupLinkRequestSchema.extend({
  group_id: identifierSchema,
  identity_id: identifierSchema,
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  joined_at: z.iso.datetime(),
});

export type RotateGroupLinkCommand = z.output<
  typeof rotateGroupLinkCommandSchema
>;

export type RedeemGroupLinkCommand = z.output<
  typeof redeemGroupLinkCommandSchema
>;
