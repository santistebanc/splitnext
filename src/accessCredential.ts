import { z } from 'zod';
import { SECRET_TOKEN_PATTERN } from './secretToken.internal';

/**
 * The vocabulary of a group capability: what one looks like, what a caller
 * presents, and who it turns out to be. Shared deliberately — the HTTP edge
 * shapes these, the member module issues and verifies them — so it lives
 * apart from the private implementation that does the verifying.
 */
export const ACCESS_TOKEN_PATTERN = SECRET_TOKEN_PATTERN;

export const accessTokenSchema = z
  .string()
  .regex(new RegExp(`^${ACCESS_TOKEN_PATTERN}$`));

export const deviceUserIdSchema = z.string().trim().min(1).max(128);

export const accessCredentialSchema = z
  .object({
    accessToken: accessTokenSchema,
    deviceUserId: deviceUserIdSchema,
  })
  .strict();

export type AccessCredential = z.infer<typeof accessCredentialSchema>;

export type MemberPrincipal = { memberId: string };
