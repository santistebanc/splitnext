import { z } from 'zod';
import { base64url, identifierSchema } from './ids';

export const identitySchema = z.object({
  id: identifierSchema,
  created_at: z.iso.datetime(),
});

export const deviceSchema = z.object({
  id: identifierSchema,
  created_at: z.iso.datetime(),
});

export const deviceSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .meta({
    description: 'A client-generated 32-byte base64url secret without padding.',
  });

/** A new installation's device credential, generated on the device. */
export function createDeviceSecret(): string {
  return deviceSecretSchema.parse(
    base64url(crypto.getRandomValues(new Uint8Array(32))),
  );
}

export const identitySessionSchema = z.object({
  identity: identitySchema,
  device: deviceSchema,
});

export type IdentitySession = z.output<typeof identitySessionSchema>;
