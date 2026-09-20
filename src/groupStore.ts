import {
  createdGroupSchema,
  type CreatedGroup,
  type InitialGroupState,
} from './domain/groups';

type StoredCreation = {
  group_id: string;
  creator_identity_id: string;
  request_name: string;
  currency_code: string;
  creator_member_name: string;
  outcome_json: string;
};

export type CreateStoredGroupResult =
  | { ok: true; created: CreatedGroup }
  | { ok: false; error: 'group_exists' | 'idempotency_conflict' };

export class GroupStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  create(initial: InitialGroupState): CreateStoredGroupResult {
    this.ensureSchema();

    return this.storage.transactionSync(() => {
      const existing = this.readCreation();

      if (existing) return this.resolveRetry(existing, initial.view);

      this.insert(initial);

      return { ok: true, created: initial.view };
    });
  }

  private ensureSchema(): void {
    const { sql } = this.storage;

    sql.exec('PRAGMA foreign_keys = ON');
    sql.exec(`CREATE TABLE IF NOT EXISTS group_creation (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      group_id TEXT NOT NULL UNIQUE,
      creator_identity_id TEXT NOT NULL,
      request_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      creator_member_name TEXT NOT NULL,
      outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json))
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS group_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      created_at TEXT NOT NULL,
      current_cursor INTEGER NOT NULL,
      creator_identity_id TEXT NOT NULL,
      initial_member_id TEXT NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS active_member_names
      ON members (display_name COLLATE NOCASE)
      WHERE status = 'active'`);
    sql.exec(`CREATE TABLE IF NOT EXISTS group_access_grants (
      identity_id TEXT PRIMARY KEY,
      actor_number INTEGER NOT NULL UNIQUE,
      preferred_member_id TEXT REFERENCES members(id),
      granted_at TEXT NOT NULL,
      left_at TEXT
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS group_events (
      cursor INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      actor_identity_id TEXT NOT NULL,
      actor_number INTEGER NOT NULL,
      actor_member_name TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
    )`);
  }

  private insert(initial: InitialGroupState): void {
    const { group, member, access } = initial.view;
    const { event } = initial;
    const { sql } = this.storage;

    sql.exec(
      `INSERT INTO group_state
        (singleton, id, name, currency_code, created_at, current_cursor,
         creator_identity_id, initial_member_id)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      group.id,
      group.name,
      group.currency_code,
      group.created_at,
      group.cursor,
      access.identity_id,
      member.id,
    );
    sql.exec(
      `INSERT INTO members
        (id, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      member.id,
      member.display_name,
      member.status,
      member.created_at,
      member.updated_at,
    );
    sql.exec(
      `INSERT INTO group_access_grants
        (identity_id, actor_number, preferred_member_id, granted_at, left_at)
       VALUES (?, ?, ?, ?, NULL)`,
      access.identity_id,
      event.actor_number,
      access.preferred_member_id,
      access.granted_at,
    );
    sql.exec(
      `INSERT INTO group_events
        (cursor, id, type, actor_identity_id, actor_number, actor_member_name,
         occurred_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      event.cursor,
      event.id,
      event.type,
      event.actor_identity_id,
      event.actor_number,
      event.actor_member_name,
      event.occurred_at,
      JSON.stringify(event.payload),
    );
    sql.exec(
      `INSERT INTO group_creation
        (singleton, group_id, creator_identity_id, request_name, currency_code,
         creator_member_name, outcome_json)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      group.id,
      access.identity_id,
      group.name,
      group.currency_code,
      member.display_name,
      JSON.stringify(initial.view),
    );
  }

  private readCreation(): StoredCreation | null {
    return (
      this.storage.sql
        .exec<StoredCreation>(
          `SELECT
             group_id,
             creator_identity_id,
             request_name,
             currency_code,
             creator_member_name,
             outcome_json
           FROM group_creation
           WHERE singleton = 1`,
        )
        .toArray()[0] ?? null
    );
  }

  private resolveRetry(
    stored: StoredCreation,
    requested: CreatedGroup,
  ): CreateStoredGroupResult {
    if (stored.creator_identity_id !== requested.access.identity_id) {
      return { ok: false, error: 'group_exists' };
    }

    const sameInput =
      stored.group_id === requested.group.id &&
      stored.request_name === requested.group.name &&
      stored.currency_code === requested.group.currency_code &&
      stored.creator_member_name === requested.member.display_name;

    if (!sameInput) return { ok: false, error: 'idempotency_conflict' };

    return {
      ok: true,
      created: createdGroupSchema.parse(JSON.parse(stored.outcome_json)),
    };
  }
}
