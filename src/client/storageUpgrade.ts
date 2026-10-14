import { z } from 'zod';
import { inviteMetadataSchema, inviteTokenSchema } from '../domain/invites';
import { groupSnapshotSchema, type GroupSnapshot } from '../domain/sync';
import {
  ClientStorageError,
  clientStorageDocumentSchema,
  serializeClientDocument,
  parseClientDocument,
  type ClientStorageAdapter,
} from './storage';

const previousDocumentSchema = clientStorageDocumentSchema
  .omit({ pending_invites: true, groups: true })
  .extend({
    schema_version: z.literal(1),
    groups: z.array(
      clientStorageDocumentSchema.shape.groups.element.extend({
        snapshot: groupSnapshotSchema.extend({
          invite: inviteMetadataSchema.nullable(),
        }),
      }),
    ),
    own_invites: z.array(
      z.object({
        group_id: z.string(),
        invite_id: z.string(),
        token: inviteTokenSchema,
        confirmed: z.boolean(),
      }),
    ),
  });

type PreviousDocument = z.output<typeof previousDocumentSchema>;

type RefreshedGroup = { revision: number; snapshot: GroupSnapshot };

/** Upgrade persisted data once; the public API continues to use only the current model. */
export async function upgradeClientStorage(
  storage: ClientStorageAdapter,
  online: boolean,
  refresh: (groupId: string) => Promise<RefreshedGroup>,
): Promise<void> {
  const previous = previousDocument(await storage.read());

  if (!previous) return;

  const missing = previous.groups.filter(
    (group) => !savedToken(previous, group),
  );

  if (missing.length && !online)
    throw new ClientStorageError('upgrade_requires_connection');

  const refreshed = new Map(
    await Promise.all(
      missing.map(
        async (group) =>
          [group.group_id, await refresh(group.group_id)] as const,
      ),
    ),
  );

  await storage.update((serialized) => {
    // Reread inside the atomic write so in-flight edits or another upgrader
    // cannot lose newly queued commands, notices, or pending requests.
    const latest = previousDocument(serialized);

    if (!latest)
      return {
        serialized: serializeClientDocument(parseClientDocument(serialized)),
        result: undefined,
      };

    const groups = latest.groups.map((group) => {
      const authoritative = refreshed.get(group.group_id);
      const token = savedToken(latest, group);

      if (authoritative && authoritative.revision >= group.revision)
        return { ...group, ...authoritative };

      if (!token || !group.snapshot.invite)
        throw new ClientStorageError('upgrade_requires_connection');

      return {
        ...group,
        snapshot: {
          ...group.snapshot,
          invite: { ...group.snapshot.invite, token },
        },
      };
    });

    const upgraded = clientStorageDocumentSchema.parse({
      ...latest,
      schema_version: 2,
      groups,
      pending_invites: latest.own_invites
        .filter((invite) => !invite.confirmed)
        .map(({ confirmed: _confirmed, ...invite }) => invite),
    });

    return { serialized: serializeClientDocument(upgraded), result: undefined };
  });
}

function previousDocument(serialized: string | null): PreviousDocument | null {
  if (serialized === null) return null;

  let parsed: z.output<typeof z.json>;

  try {
    parsed = z.json().parse(JSON.parse(serialized));
  } catch {
    throw new ClientStorageError('corrupt_document');
  }

  const version = z.object({ schema_version: z.number() }).safeParse(parsed);

  if (!version.success || version.data.schema_version !== 1) return null;

  const previous = previousDocumentSchema.safeParse(parsed);

  if (!previous.success) throw new ClientStorageError('corrupt_document');

  return previous.data;
}

function savedToken(
  document: PreviousDocument,
  group: PreviousDocument['groups'][number],
): string | undefined {
  return document.own_invites.find(
    (invite) =>
      invite.confirmed &&
      invite.group_id === group.group_id &&
      invite.invite_id === group.snapshot.invite?.id,
  )?.token;
}
