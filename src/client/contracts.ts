import { z } from 'zod';
import {
  createdGroupSchema,
} from '../domain/groups';
import { identitySessionSchema } from '../domain/identities';
import {
  groupSessionSchema,
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

export {
  createdGroupSchema,
  groupSessionSchema,
  identitySessionSchema,
  syncGroupResponseSchema,
};
