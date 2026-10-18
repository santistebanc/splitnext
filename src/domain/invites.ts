import { z } from 'zod';
import { base64url, identifierSchema } from './ids';

/**
 * A 256-bit secret encoded as unpadded base64url. The creating client
 * generates it, so a retried creation reuses the same link.
 */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Attribution retained in history without copying invitation secrets. */
export const inviteMetadataSchema = z.object({
  id: identifierSchema,
  created_by_identity_id: identifierSchema,
  created_at: z.iso.datetime(),
});

/** The group's current link, shared through authenticated group snapshots. */
export const groupInviteSchema = inviteMetadataSchema.extend({
  token: inviteTokenSchema,
});

export type GroupInvite = z.output<typeof groupInviteSchema>;

/** An invite as audit history records it, including when it stopped working. */
export const inviteRecordSchema = inviteMetadataSchema.extend({
  revoked_at: z.iso.datetime().nullable(),
});

export type InviteRecord = z.output<typeof inviteRecordSchema>;

export const inviteLinkInputSchema = z.object({
  invite_id: identifierSchema,
  token: inviteTokenSchema,
});

export type InviteLinkInput = z.input<typeof inviteLinkInputSchema>;

export const regenerateInviteCommandSchema = z.object({
  group_id: identifierSchema,
  identity_id: identifierSchema,
  invite_id: identifierSchema,
  token_hash: z.string().min(1),
  token: inviteTokenSchema,
  created_at: z.iso.datetime(),
});

export type RegenerateInviteCommand = z.output<
  typeof regenerateInviteCommandSchema
>;

export const inviteResultSchema = z.object({
  revision: z.number().int().positive(),
  invite: groupInviteSchema,
});

export const previewInviteRequestSchema = z.object({
  token: inviteTokenSchema,
});

/** What a link holder sees before joining, so they can choose who they are. */
export const invitePreviewSchema = z.object({
  group: z.object({
    id: identifierSchema,
    name: z.string(),
  }),
  members: z.array(
    z.object({
      id: identifierSchema,
      display_name: z.string(),
      name_ordinal: z.number().int().positive().nullable().meta({
        description: 'Tells apart members sharing this name, as in “Ana (2)”.',
      }),
      in_use: z.boolean().meta({
        description: 'Whether a current participant uses this member name.',
      }),
    }),
  ),
});

export type InvitePreview = z.output<typeof invitePreviewSchema>;

export const inviteFailureCodes = [
  'invite_required',
  'invite_invalid',
  'invite_replaced',
] as const;

export type InviteFailure = (typeof inviteFailureCodes)[number];

export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );

  return base64url(new Uint8Array(digest));
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
  return inviteTokenSchema.parse(
    base64url(crypto.getRandomValues(new Uint8Array(32))),
  );
}
