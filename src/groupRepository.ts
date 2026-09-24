import type { CreatedGroup } from './domain/groups';
import type { CommandOutcome, GroupSnapshot } from './domain/sync';

export type StoredGroupCreation = {
  creator_identity_id: string;
  request: {
    group_id: string;
    name: string;
    currency_code: string;
    creator_member_name: string;
  };
  response: CreatedGroup;
};

export type StoredAuditEvent = {
  sequence: number;
  id: string;
  revision: number;
  action: string;
  command_id: string | null;
  actor_identity_id: string;
  actor_handle: string;
  actor_member_name: string | null;
  target_kind: 'access' | 'group' | 'member';
  target_id: string;
  occurred_at: string;
  before: unknown;
  after: unknown;
};

export type StoredCommandOutcome = {
  command_id: string;
  identity_id: string;
  command_json: string;
  outcome: CommandOutcome;
};

export type StoredJoinOutcome = {
  join_id: string;
  identity_id: string;
  request_json: string;
  response: {
    revision: number;
    snapshot: GroupSnapshot;
    access: GroupSnapshot['access_grants'][number];
  };
};

export type GroupDocument = {
  schema_version: 1;
  revision: number;
  next_actor_number: number;
  creation: StoredGroupCreation;
  snapshot: GroupSnapshot;
  audit_events: StoredAuditEvent[];
  command_outcomes: StoredCommandOutcome[];
  join_outcomes: StoredJoinOutcome[];
};

export type GroupTransaction<T> = {
  document: GroupDocument | null;
  result: T;
};

export interface GroupRepository {
  transaction<T>(
    operation: (document: GroupDocument | null) => GroupTransaction<T>,
  ): T;
}

export class DurableObjectGroupRepository implements GroupRepository {
  constructor(private readonly storage: DurableObjectStorage) {
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS group_document (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      document_json TEXT NOT NULL CHECK (json_valid(document_json))
    )`);
  }

  transaction<T>(
    operation: (document: GroupDocument | null) => GroupTransaction<T>,
  ): T {
    return this.storage.transactionSync(() => {
      const current = this.read();
      const transaction = operation(current);

      if (transaction.document) {
        this.storage.sql.exec(
          `INSERT INTO group_document (singleton, document_json)
           VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE
           SET document_json = excluded.document_json`,
          JSON.stringify(transaction.document),
        );
      }

      return transaction.result;
    });
  }

  private read(): GroupDocument | null {
    const row = this.storage.sql
      .exec<{ document_json: string }>(
        'SELECT document_json FROM group_document WHERE singleton = 1',
      )
      .toArray()[0];

    // SAFETY: Only this adapter writes document_json, inside the same
    // transaction, from a GroupDocument supplied by the group engine.
    return row ? (JSON.parse(row.document_json) as GroupDocument) : null;
  }
}

export class MemoryGroupRepository implements GroupRepository {
  private document: GroupDocument | null;

  constructor(initial: GroupDocument | null = null) {
    this.document = clone(initial);
  }

  transaction<T>(
    operation: (document: GroupDocument | null) => GroupTransaction<T>,
  ): T {
    const transaction = operation(clone(this.document));

    this.document = clone(transaction.document);

    return transaction.result;
  }

  inspect(): GroupDocument | null {
    return clone(this.document);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
