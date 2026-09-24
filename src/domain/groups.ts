import { z } from 'zod';
import { identifierSchema } from './ids';

export const groupNameSchema = z.string().trim().min(1).max(100);

const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());

export const groupDetailsSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  currency_code: z.string(),
  created_at: z.iso.datetime(),
});

export const groupProjectionSchema = groupDetailsSchema.extend({
  revision: z.number().int().positive(),
});

export const groupAccessGrantSchema = z.object({
  identity_id: identifierSchema,
  actor_handle: z.string(),
  preferred_member_id: identifierSchema.nullable(),
  granted_at: z.iso.datetime(),
  hidden_at: z.iso.datetime().nullable(),
});

export type GroupAccessGrant = z.output<typeof groupAccessGrantSchema>;

export const createGroupRequestSchema = z.object({
  group_id: identifierSchema,
  name: groupNameSchema,
  currency_code: currencyCodeSchema,
  creator_member_name: groupNameSchema,
});

export type CreateGroupRequest = z.output<typeof createGroupRequestSchema>;

export const initializeGroupCommandSchema = createGroupRequestSchema.extend({
  creator_identity_id: identifierSchema,
  member_id: identifierSchema,
  created_at: z.iso.datetime(),
});

export type InitializeGroupCommand = z.output<
  typeof initializeGroupCommandSchema
>;

export const createdGroupSchema = z.object({
  group: groupProjectionSchema,
  member: z.object({
    id: identifierSchema,
    display_name: z.string(),
    status: z.literal('active'),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
  access: groupAccessGrantSchema,
});

export type CreatedGroup = z.output<typeof createdGroupSchema>;

export type InitialGroupState = {
  view: CreatedGroup;
  audit: {
    sequence: number;
    revision: number;
    action: 'group.created';
    actor_identity_id: string;
    actor_number: number;
    actor_member_name: string;
    occurred_at: string;
    target_id: string;
  };
};

export function initializeGroup(command: InitializeGroupCommand): InitialGroupState {
  const revision = 1;
  const actorNumber = 1;
  const actorHandle = `User ${actorNumber}`;

  const member = {
    id: command.member_id,
    display_name: command.creator_member_name,
    status: 'active' as const,
    created_at: command.created_at,
    updated_at: command.created_at,
  };

  return {
    view: {
      group: {
        id: command.group_id,
        name: command.name,
        currency_code: command.currency_code,
        created_at: command.created_at,
        revision,
      },
      member,
      access: {
        identity_id: command.creator_identity_id,
        actor_handle: actorHandle,
        preferred_member_id: member.id,
        granted_at: command.created_at,
        hidden_at: null,
      },
    },
    audit: {
      sequence: 1,
      revision,
      action: 'group.created',
      actor_identity_id: command.creator_identity_id,
      actor_number: actorNumber,
      actor_member_name: member.display_name,
      occurred_at: command.created_at,
      target_id: command.group_id,
    },
  };
}
