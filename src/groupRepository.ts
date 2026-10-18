import {
  auditEventSchema,
  newAuditEventSchema,
  type AuditEvent,
  type NewAuditEvent,
} from './domain/audit';
import type { CommandOutcome } from './domain/commands';
import { groupSnapshotSchema, type GroupSnapshot } from './domain/sync';

import type { GroupPersistence, GroupRepository, StoredGroupCreation, StoredGroupState, StoredCommandOutcome, StoredJoinOutcome, StoredInvite } from './groupPersistence';

type StateRow = {
  revision: number;
  next_actor_number: number;
  creation_json: string;
  snapshot_json: string;
};

type CommandOutcomeRow = {
  command_id: string;
  identity_id: string;
  command_json: string;
  outcome_json: string;
};

type JoinOutcomeRow = {
  join_id: string;
  identity_id: string;
  request_json: string;
  response_json: string;
};

type AuditEventRow = {
  sequence: number;
  event_json: string;
};

export class DurableObjectGroupRepository implements GroupRepository {
  constructor(private readonly storage: DurableObjectStorage) {
    this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS group_metadata (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       );
       INSERT OR IGNORE INTO group_metadata (key, value)
       VALUES ('schema_version', '1');

       CREATE TABLE IF NOT EXISTS group_state (
         singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
         revision INTEGER NOT NULL,
         next_actor_number INTEGER NOT NULL,
         creation_json TEXT NOT NULL CHECK (json_valid(creation_json)),
         snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
       );

       CREATE TABLE IF NOT EXISTS group_audit_events (
         sequence INTEGER PRIMARY KEY,
         event_id TEXT NOT NULL UNIQUE,
         event_json TEXT NOT NULL CHECK (json_valid(event_json))
       );

       CREATE TABLE IF NOT EXISTS group_command_outcomes (
         command_id TEXT PRIMARY KEY,
         identity_id TEXT NOT NULL,
         command_json TEXT NOT NULL CHECK (json_valid(command_json)),
         outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json))
       );

       CREATE TABLE IF NOT EXISTS group_join_outcomes (
         join_id TEXT PRIMARY KEY,
         identity_id TEXT NOT NULL,
         request_json TEXT NOT NULL CHECK (json_valid(request_json)),
         response_json TEXT NOT NULL CHECK (json_valid(response_json))
       );

       CREATE TABLE IF NOT EXISTS group_invites (
         id TEXT PRIMARY KEY,
         token_hash TEXT NOT NULL UNIQUE,
         created_by_identity_id TEXT NOT NULL,
         created_at TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         revoked_at TEXT
       );`,
    );

    // The version 1 SQL above is the initial migration. Upgrade existing
    // databases transactionally, retaining every invite and its revoked state.
    this.storage.transactionSync(() => {
      const version = this.storage.sql
        .exec<{
          value: string;
        }>("SELECT value FROM group_metadata WHERE key = 'schema_version'")
        .toArray()[0];

      if (!version) throw new Error('group_schema_version_missing');

      if (!['1', '2', '3'].includes(version.value))
        throw new Error('unsupported_group_schema_version');

      if (version.value === '1') {
        this.storage.sql.exec(
          `ALTER TABLE group_invites DROP COLUMN expires_at;
           UPDATE group_metadata SET value = '2' WHERE key = 'schema_version';`,
        );
      }

      // Members no longer merge by name, so nothing reads their aliases.
      if (version.value !== '3') {
        this.storage.sql.exec(
          `DROP TABLE IF EXISTS group_member_aliases;
           UPDATE group_metadata SET value = '3' WHERE key = 'schema_version';`,
        );
      }
    });
  }

  transaction<T>(operation: (persistence: GroupPersistence) => T): T {
    return this.storage.transactionSync(() =>
      operation(new SQLiteGroupPersistence(this.storage.sql)),
    );
  }
}

class SQLiteGroupPersistence implements GroupPersistence {
  constructor(private readonly sql: SqlStorage) {}

  loadState(): StoredGroupState | null {
    const row = this.sql
      .exec<StateRow>(
        `SELECT revision, next_actor_number, creation_json, snapshot_json
         FROM group_state
         WHERE singleton = 1`,
      )
      .toArray()[0];

    if (!row) return null;

    return {
      revision: row.revision,
      next_actor_number: row.next_actor_number,
      creation: parseJson<StoredGroupCreation>(row.creation_json),
      snapshot: groupSnapshotSchema.parse(
        parseJson<GroupSnapshot>(row.snapshot_json),
      ),
    };
  }

  saveState(state: StoredGroupState): void {
    this.sql.exec(
      `INSERT INTO group_state (
         singleton,
         revision,
         next_actor_number,
         creation_json,
         snapshot_json
       )
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET
         revision = excluded.revision,
         next_actor_number = excluded.next_actor_number,
         creation_json = excluded.creation_json,
         snapshot_json = excluded.snapshot_json`,
      state.revision,
      state.next_actor_number,
      JSON.stringify(state.creation),
      JSON.stringify(state.snapshot),
    );
  }

  findCommandOutcome(commandId: string): StoredCommandOutcome | null {
    const row = this.sql
      .exec<CommandOutcomeRow>(
        `SELECT command_id, identity_id, command_json, outcome_json
         FROM group_command_outcomes
         WHERE command_id = ?`,
        commandId,
      )
      .toArray()[0];

    return row
      ? {
          command_id: row.command_id,
          identity_id: row.identity_id,
          command_json: row.command_json,
          outcome: parseJson<CommandOutcome>(row.outcome_json),
        }
      : null;
  }

  recordCommandOutcome(outcome: StoredCommandOutcome): void {
    this.sql.exec(
      `INSERT INTO group_command_outcomes (
         command_id,
         identity_id,
         command_json,
         outcome_json
       )
       VALUES (?, ?, ?, ?)`,
      outcome.command_id,
      outcome.identity_id,
      outcome.command_json,
      JSON.stringify(outcome.outcome),
    );
  }

  findJoinOutcome(joinId: string): StoredJoinOutcome | null {
    const row = this.sql
      .exec<JoinOutcomeRow>(
        `SELECT join_id, identity_id, request_json, response_json
         FROM group_join_outcomes
         WHERE join_id = ?`,
        joinId,
      )
      .toArray()[0];

    return row
      ? {
          join_id: row.join_id,
          identity_id: row.identity_id,
          request_json: row.request_json,
          response: parseJson<StoredJoinOutcome['response']>(row.response_json),
        }
      : null;
  }

  recordJoinOutcome(outcome: StoredJoinOutcome): void {
    this.sql.exec(
      `INSERT INTO group_join_outcomes (
         join_id,
         identity_id,
         request_json,
         response_json
       )
       VALUES (?, ?, ?, ?)`,
      outcome.join_id,
      outcome.identity_id,
      outcome.request_json,
      JSON.stringify(outcome.response),
    );
  }

  findInvite(inviteId: string): StoredInvite | null {
    return this.selectInvite('id', inviteId);
  }

  findInviteByTokenHash(tokenHash: string): StoredInvite | null {
    return this.selectInvite('token_hash', tokenHash);
  }

  recordInvite(invite: StoredInvite): void {
    this.sql.exec(
      `INSERT INTO group_invites (
         id,
         token_hash,
         created_by_identity_id,
         created_at,
         revoked_at
       )
       VALUES (?, ?, ?, ?, ?)`,
      invite.id,
      invite.token_hash,
      invite.created_by_identity_id,
      invite.created_at,
      invite.revoked_at,
    );
  }

  retireInvite(inviteId: string, revokedAt: string): void {
    this.sql.exec(
      `UPDATE group_invites SET revoked_at = ?
       WHERE id = ? AND revoked_at IS NULL`,
      revokedAt,
      inviteId,
    );
  }

  private selectInvite(
    column: 'id' | 'token_hash',
    value: string,
  ): StoredInvite | null {
    return (
      this.sql
        .exec<StoredInvite>(
          `SELECT id, token_hash, created_by_identity_id, created_at,
                  revoked_at
           FROM group_invites
           WHERE ${column} = ?`,
          value,
        )
        .toArray()[0] ?? null
    );
  }

  appendAudit(event: NewAuditEvent): AuditEvent {
    const validated = newAuditEventSchema.parse(event);

    const row = this.sql
      .exec<{ sequence: number }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
         FROM group_audit_events`,
      )
      .toArray()[0];

    if (!row) throw new Error('audit_sequence_unavailable');

    this.sql.exec(
      `INSERT INTO group_audit_events (sequence, event_id, event_json)
       VALUES (?, ?, ?)`,
      row.sequence,
      validated.id,
      JSON.stringify(validated),
    );

    return auditEventSchema.parse({ sequence: row.sequence, ...validated });
  }

  readAudit(): AuditEvent[] {
    return this.sql
      .exec<AuditEventRow>(
        `SELECT sequence, event_json
         FROM group_audit_events
         ORDER BY sequence`,
      )
      .toArray()
      .map((row) =>
        auditEventSchema.parse({
          sequence: row.sequence,
          ...newAuditEventSchema.parse(parseJson(row.event_json)),
        }),
      );
  }
}

function parseJson<T>(value: string): T {
  // SAFETY: Each JSON column is written only by this adapter from the matching
  // domain type inside the same transaction.
  return JSON.parse(value) as T;
}
