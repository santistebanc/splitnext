import { z } from 'zod';
import { identifierSchema } from './ids';
import {
  inviteLinkInputSchema,
  groupInviteSchema,
  inviteTokenSchema,
} from './invites';

export const groupNameSchema = z.string().trim().min(1).max(100);

export const groupDetailsSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  created_at: z.iso.datetime(),
});

export type GroupDetails = z.output<typeof groupDetailsSchema>;

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
  creator_member_name: groupNameSchema,
  invite: inviteLinkInputSchema,
});

export type CreateGroupRequest = z.output<typeof createGroupRequestSchema>;

export const initializeGroupCommandSchema = createGroupRequestSchema
  .omit({ invite: true })
  .extend({
    invite_id: identifierSchema,
    invite_token_hash: z.string().min(1),
    invite_token: inviteTokenSchema,
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
  invite: groupInviteSchema,
});

export type CreatedGroup = z.output<typeof createdGroupSchema>;

export type InitialGroupState = {
  view: CreatedGroup;
  invite_token_hash: string;
};

export function initializeGroup(
  command: InitializeGroupCommand,
): InitialGroupState {
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
    invite_token_hash: command.invite_token_hash,
    view: {
      group: {
        id: command.group_id,
        name: command.name,
        created_at: command.created_at,
        revision,
      },
      member,
      invite: {
        id: command.invite_id,
        token: command.invite_token,
        created_by_identity_id: command.creator_identity_id,
        created_at: command.created_at,
      },
      access: {
        identity_id: command.creator_identity_id,
        actor_handle: actorHandle,
        preferred_member_id: member.id,
        granted_at: command.created_at,
        hidden_at: null,
      },
    },
  };
}

/** One entry in the list of groups an identity can access. */
export const accessibleGroupSchema = z.object({
  group_id: identifierSchema,
  name: z.string(),
  status: z.enum(['active', 'left']),
  granted_at: z.iso.datetime(),
  left_at: z.iso.datetime().nullable(),
});

export type AccessibleGroup = z.output<typeof accessibleGroupSchema>;

export const accessibleGroupsSchema = z.object({
  groups: z.array(accessibleGroupSchema),
});
