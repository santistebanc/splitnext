import { z } from 'zod';

const identifierSchema = z.uuid();

const nameSchema = z.string().trim().min(1).max(100);

const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());

export const createGroupRequestSchema = z.object({
  group_id: identifierSchema,
  name: nameSchema,
  currency_code: currencyCodeSchema,
  creator_member_name: nameSchema,
});

export const initializeGroupCommandSchema = createGroupRequestSchema.extend({
  creator_identity_id: identifierSchema,
  member_id: identifierSchema,
  event_id: identifierSchema,
  created_at: z.iso.datetime(),
});

export type InitializeGroupCommand = z.output<
  typeof initializeGroupCommandSchema
>;

export const createdGroupSchema = z.object({
  group: z.object({
    id: identifierSchema,
    name: z.string(),
    currency_code: z.string(),
    created_at: z.iso.datetime(),
    cursor: z.number().int().positive(),
  }),
  member: z.object({
    id: identifierSchema,
    display_name: z.string(),
    status: z.literal('active'),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
  access: z.object({
    identity_id: identifierSchema,
    actor_handle: z.string(),
    preferred_member_id: identifierSchema,
    granted_at: z.iso.datetime(),
  }),
});

export type CreatedGroup = z.output<typeof createdGroupSchema>;

export type InitialGroupState = {
  view: CreatedGroup;
  event: {
    id: string;
    cursor: number;
    type: 'group.created.v1';
    actor_identity_id: string;
    actor_number: number;
    actor_member_name: string;
    occurred_at: string;
    payload: {
      name: string;
      currency_code: string;
      initial_member: { id: string; display_name: string };
    };
  };
};

export function initializeGroup(command: InitializeGroupCommand): InitialGroupState {
  const cursor = 1;
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
        cursor,
      },
      member,
      access: {
        identity_id: command.creator_identity_id,
        actor_handle: actorHandle,
        preferred_member_id: member.id,
        granted_at: command.created_at,
      },
    },
    event: {
      id: command.event_id,
      cursor,
      type: 'group.created.v1',
      actor_identity_id: command.creator_identity_id,
      actor_number: actorNumber,
      actor_member_name: member.display_name,
      occurred_at: command.created_at,
      payload: {
        name: command.name,
        currency_code: command.currency_code,
        initial_member: { id: member.id, display_name: member.display_name },
      },
    },
  };
}
