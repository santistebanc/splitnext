import { z } from 'zod';
import { identifierSchema } from './ids';

/** The subprotocol a server selects when it accepts a realtime connection. */
export const realtimeProtocol = 'splitnext.v1';

/**
 * Browsers cannot set an Authorization header on a WebSocket, so a client
 * offers its device credential as a second subprotocol. The server never
 * selects or echoes it.
 */
const realtimeCredentialPrefix = 'splitnext.auth.';

/** A server closes a connection with this code once its identity leaves. */
export const realtimeGroupHiddenCode = 4403;

/**
 * A newer group revision may exist. Clients
 * synchronize through the ordinary snapshot path and never treat it as state.
 */
export const revisionAnnouncementSchema = z.object({
  type: z.literal('revision'),
  revision: z.number().int().positive(),
});

export type RevisionAnnouncement = z.output<typeof revisionAnnouncementSchema>;

/** Ephemeral connected identities, independent of ledger revisions and history. */
export const presenceAnnouncementSchema = z.object({
  type: z.literal('presence'),
  identity_ids: z.array(identifierSchema),
});

export const realtimeAnnouncementSchema = z.discriminatedUnion('type', [
  revisionAnnouncementSchema,
  presenceAnnouncementSchema,
]);

export function realtimeProtocols(deviceSecret: string): string[] {
  return [realtimeProtocol, `${realtimeCredentialPrefix}v1.${deviceSecret}`];
}

/** Returns the offered credential in Authorization form, if one is present. */
export function credentialFromProtocols(
  header: string | null,
): string | undefined {
  const offered = (header ?? '').split(',').map((protocol) => protocol.trim());

  if (!offered.includes(realtimeProtocol)) return undefined;

  const credential = offered.find((protocol) =>
    protocol.startsWith(realtimeCredentialPrefix),
  );

  return credential
    ? `Bearer ${credential.slice(realtimeCredentialPrefix.length)}`
    : undefined;
}
