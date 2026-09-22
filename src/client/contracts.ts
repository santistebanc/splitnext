import { z } from 'zod';
import {
  createdGroupSchema,
  groupAccessGrantSchema,
} from '../domain/groups';
import { identitySessionSchema } from '../domain/identities';
import { inviteTokenSchema } from '../domain/invites';
import {
  groupSnapshotSchema,
  syncGroupResponseSchema,
} from '../domain/sync';

export const jsonSchema = z.json();

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  revision: z.string(),
});

export const readinessResponseSchema = z.object({
  ok: z.literal(true),
  checks: z.object({
    d1: z.literal(true),
    durable_object: z.literal(true),
  }),
});

export const groupLinkSchema = z.object({
  revision: z.number().int().positive(),
  snapshot: groupSnapshotSchema,
  invite: z.object({
    id: z.uuid(),
    token: inviteTokenSchema,
    join_url: z.string(),
    created_at: z.iso.datetime(),
    expires_at: z.iso.datetime(),
  }),
});

export const redeemedGroupLinkSchema = z.object({
  revision: z.number().int().positive(),
  snapshot: groupSnapshotSchema,
  access: groupAccessGrantSchema,
});

export {
  createdGroupSchema,
  identitySessionSchema,
  syncGroupResponseSchema,
};
