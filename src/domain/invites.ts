import { z } from 'zod';
import { identifierSchema } from './ids';

/**
 * A 256-bit secret encoded as unpadded base64url. The creating client
 * generates it, so a retried creation reuses the same link; the server keeps
 * only its hash.
 */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const defaultInviteLifetimeHours = 24 * 7;

export const maximumInviteLifetimeHours = 24 * 30;

/** The current invite link as every participant sees it; never the token. */
export const groupInviteSchema = z.object({
  id: identifierSchema,
  created_by_identity_id: identifierSchema,
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});

export type GroupInvite = z.output<typeof groupInviteSchema>;

/** An invite as audit history records it, including when it stopped working. */
export const inviteRecordSchema = groupInviteSchema.extend({
  revoked_at: z.iso.datetime().nullable(),
});

export type InviteRecord = z.output<typeof inviteRecordSchema>;

export const createInviteRequestSchema = z.object({
  invite_id: identifierSchema,
  token: inviteTokenSchema,
  expires_in_hours: z
    .number()
    .int()
    .min(1)
    .max(maximumInviteLifetimeHours)
    .default(defaultInviteLifetimeHours),
});

export type CreateInviteRequest = z.input<typeof createInviteRequestSchema>;

export const createInviteCommandSchema = z.object({
  group_id: identifierSchema,
  identity_id: identifierSchema,
  invite_id: identifierSchema,
  token_hash: z.string().min(1),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});

export type CreateInviteCommand = z.output<typeof createInviteCommandSchema>;

export const inviteResultSchema = z.object({
  revision: z.number().int().positive(),
  invite: groupInviteSchema,
});

export const revokeInviteResultSchema = z.object({
  revision: z.number().int().positive(),
});

export const previewInviteRequestSchema = z.object({
  token: inviteTokenSchema,
});

/** What a link holder sees before joining, so they can choose who they are. */
export const invitePreviewSchema = z.object({
  group: z.object({
    id: identifierSchema,
    name: z.string(),
    currency_code: z.string(),
  }),
  members: z.array(
    z.object({ id: identifierSchema, display_name: z.string() }),
  ),
  expires_at: z.iso.datetime(),
});

export type InvitePreview = z.output<typeof invitePreviewSchema>;

export const inviteFailureCodes = [
  'invite_required',
  'invite_invalid',
  'invite_expired',
  'invite_revoked',
] as const;

export type InviteFailure = (typeof inviteFailureCodes)[number];

export function inviteExpiry(createdAt: string, hours: number): string {
  return new Date(Date.parse(createdAt) + hours * 3_600_000).toISOString();
}

export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );

  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** Keeps the token after `#`, so browsers never send it to any server. */
export function formatInviteLink(
  appUrl: string,
  groupId: string,
  token: string,
): string {
  return `${appUrl.replace(/\/$/, '')}/join/${groupId}#${token}`;
}

export function parseInviteLink(
  link: string,
): { group_id: string; token: string } | null {
  let url: URL;

  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }

  const groupId = identifierSchema.safeParse(
    /\/join\/([^/]+)\/?$/.exec(url.pathname)?.[1],
  );

  const token = inviteTokenSchema.safeParse(url.hash.slice(1));

  return groupId.success && token.success
    ? { group_id: groupId.data, token: token.data }
    : null;
}

export function isInviteFailure(code: string): code is InviteFailure {
  return inviteFailureCodes.some((failure) => failure === code);
}

export function createInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return inviteTokenSchema.parse(
    btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, ''),
  );
}
