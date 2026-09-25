import { z } from 'zod';
import { joinGroupRequestSchema } from '../domain/access';
import {
  commandOutcomeSchema,
  groupCommandSchema,
} from '../domain/commands';
import {
  accessibleGroupSchema,
  createGroupRequestSchema,
} from '../domain/groups';
import { identifierSchema } from '../domain/ids';
import { identitySessionSchema } from '../domain/identities';
import { inviteTokenSchema } from '../domain/invites';
import { groupSnapshotSchema } from '../domain/sync';

const pendingCommandSchema = z.object({
  command: groupCommandSchema,
  queued_at: z.iso.datetime(),
});

const clientNoticeSchema = z.object({
  command: groupCommandSchema,
  outcome: commandOutcomeSchema,
  recorded_at: z.iso.datetime(),
});

const clientGroupReplicaSchema = z.object({
  group_id: identifierSchema,
  revision: z.number().int().positive(),
  snapshot: groupSnapshotSchema,
  outbox: z.array(pendingCommandSchema),
  notices: z.array(clientNoticeSchema),
  last_synced_at: z.iso.datetime().nullable(),
});

const pendingJoinSchema = z.object({
  group_id: identifierSchema,
  request: joinGroupRequestSchema,
});

const pendingGroupCreationSchema = z.object({
  request: createGroupRequestSchema,
});

/**
 * The plaintext of the last invite link this device created for a group. The
 * server keeps only a hash, so this is the only place the link can be shown
 * again. An unconfirmed entry is retried with the same token.
 */
const ownInviteSchema = z.object({
  group_id: identifierSchema,
  invite_id: identifierSchema,
  token: inviteTokenSchema,
  expires_in_hours: z.number().int().positive(),
  confirmed: z.boolean(),
});

export const clientStorageDocumentSchema = z.object({
  schema_version: z.literal(1),
  session: identitySessionSchema.nullable(),
  groups: z.array(clientGroupReplicaSchema),
  pending_group_creations: z.array(pendingGroupCreationSchema),
  pending_joins: z.array(pendingJoinSchema),
  own_invites: z.array(ownInviteSchema),
  // The server's last list of accessible groups, kept for offline display.
  group_directory: z.array(accessibleGroupSchema),
});

export type PendingCommand = z.output<typeof pendingCommandSchema>;

export type ClientNotice = z.output<typeof clientNoticeSchema>;

export type ClientGroupReplica = z.output<typeof clientGroupReplicaSchema>;

export type PendingJoin = z.output<typeof pendingJoinSchema>;

export type PendingGroupCreation = z.output<typeof pendingGroupCreationSchema>;

export type OwnInvite = z.output<typeof ownInviteSchema>;

export type ClientStorageDocument = z.output<
  typeof clientStorageDocumentSchema
>;

export type ClientStorageUpdate<T> = {
  serialized: string;
  result: T;
};

/** Stores one opaque client document and serializes every update to it. */
export interface ClientStorageAdapter {
  read(): Promise<string | null>;
  update<T>(
    change: (current: string | null) => ClientStorageUpdate<T>,
  ): Promise<T>;
}

export class ClientStorageError extends Error {
  constructor(
    readonly code: 'corrupt_document' | 'unsupported_schema_version',
  ) {
    super(code);
    this.name = 'ClientStorageError';
  }
}

export class MemoryClientStorage implements ClientStorageAdapter {
  private tail: Promise<void> = Promise.resolve();

  constructor(private serialized: string | null = null) {}

  read(): Promise<string | null> {
    return this.exclusive(() => this.serialized);
  }

  update<T>(
    change: (current: string | null) => ClientStorageUpdate<T>,
  ): Promise<T> {
    return this.exclusive(() => {
      const updated = change(this.serialized);

      this.serialized = updated.serialized;

      return updated.result;
    });
  }

  private async exclusive<T>(operation: () => T): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => undefined;

    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return operation();
    } finally {
      release();
    }
  }
}

export type IndexedDbClientStorageOptions = {
  database_name: string;
  document_key: string;
};

/** Atomic browser adapter intended for the future PWA, not the test lab. */
export class IndexedDbClientStorage implements ClientStorageAdapter {
  private readonly database: Promise<IDBDatabase>;
  private readonly documentKey: string;

  constructor(options: IndexedDbClientStorageOptions) {
    this.documentKey = options.document_key;
    this.database = openDatabase(options.database_name);
  }

  async read(): Promise<string | null> {
    const database = await this.database;

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(documentStore, 'readonly');
      const request = transaction.objectStore(documentStore).get(this.documentKey);

      request.onsuccess = () => {
        const value = z.string().optional().safeParse(request.result);

        if (value.success) {
          resolve(value.data ?? null);
        } else {
          reject(new ClientStorageError('corrupt_document'));
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async update<T>(
    change: (current: string | null) => ClientStorageUpdate<T>,
  ): Promise<T> {
    const database = await this.database;

    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(documentStore, 'readwrite');
      const store = transaction.objectStore(documentStore);
      const request = store.get(this.documentKey);
      let operationError: Error | null = null;
      let result: T;
      let hasResult = false;

      request.onsuccess = () => {
        try {
          const current = z.string().optional().parse(request.result) ?? null;
          const updated = change(current);

          result = updated.result;
          hasResult = true;
          store.put(updated.serialized, this.documentKey);
        } catch (cause) {
          operationError = cause instanceof Error
            ? cause
            : new ClientStorageError('corrupt_document');
          transaction.abort();
        }
      };

      transaction.oncomplete = () => {
        if (!hasResult) {
          reject(new ClientStorageError('corrupt_document'));

          return;
        }

        resolve(result);
      };

      transaction.onerror = () => reject(operationError ?? transaction.error);
      transaction.onabort = () => reject(operationError ?? transaction.error);
    });
  }
}

export function emptyClientDocument(): ClientStorageDocument {
  return {
    schema_version: 1,
    session: null,
    groups: [],
    pending_group_creations: [],
    pending_joins: [],
    own_invites: [],
    group_directory: [],
  };
}

export function parseClientDocument(
  serialized: string | null,
): ClientStorageDocument {
  if (serialized === null) return emptyClientDocument();

  let parsed: z.output<typeof z.json>;

  try {
    parsed = z.json().parse(JSON.parse(serialized));
  } catch {
    throw new ClientStorageError('corrupt_document');
  }

  const document = clientStorageDocumentSchema.safeParse(parsed);

  if (document.success) return document.data;

  const version = z.object({ schema_version: z.number() }).safeParse(parsed);

  throw new ClientStorageError(
    version.success && version.data.schema_version !== 1
      ? 'unsupported_schema_version'
      : 'corrupt_document',
  );
}

export function serializeClientDocument(
  document: ClientStorageDocument,
): string {
  return JSON.stringify(clientStorageDocumentSchema.parse(document));
}

const documentStore = 'client_documents';

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(documentStore)) {
        request.result.createObjectStore(documentStore);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('indexeddb_upgrade_blocked'));
  });
}
