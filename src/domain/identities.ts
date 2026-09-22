import { z } from 'zod';

export const identitySchema = z.object({
  id: z.uuid(),
  created_at: z.iso.datetime(),
});

export const deviceSchema = z.object({
  id: z.uuid(),
  created_at: z.iso.datetime(),
});

export const deviceSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .meta({
    description: 'A client-generated 32-byte base64url secret without padding.',
  });

export const identitySessionSchema = z.object({
  identity: identitySchema,
  device: deviceSchema,
});

export type IdentitySession = z.output<typeof identitySessionSchema>;
