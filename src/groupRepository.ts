import {
  auditEventSchema,
  newAuditEventSchema,
  type AuditEvent,
  type AuditEventStore,
  type NewAuditEvent,
} from './domain/audit';
import type { CommandOutcome } from './domain/commands';
import type { CreatedGroup } from './domain/groups';
import type { GroupSnapshot } from './domain/sync';

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

export type StoredGroupState = {
  revision: number;
  next_actor_number: number;
  creation: StoredGroupCreation;
  snapshot: GroupSnapshot;
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

export interface GroupPersistence extends AuditEventStore {
  loadState(): StoredGroupState | null;
  saveState(state: StoredGroupState): void;
  findCommandOutcome(commandId: string): StoredCommandOutcome | null;
  recordCommandOutcome(outcome: StoredCommandOutcome): void;
  findJoinOutcome(joinId: string): StoredJoinOutcome | null;
  recordJoinOutcome(outcome: StoredJoinOutcome): void;
}

export interface GroupRepository {
  transaction<T>(operation: (persistence: GroupPersistence) => T): T;
}

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
       );`,
    );
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
      snapshot: parseJson<GroupSnapshot>(row.snapshot_json),
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
          response: parseJson<StoredJoinOutcome['response']>(
            row.response_json,
          ),
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

type MemoryGroupData = {
  state: StoredGroupState | null;
  auditEvents: AuditEvent[];
  commandOutcomes: StoredCommandOutcome[];
  joinOutcomes: StoredJoinOutcome[];
};

export type GroupRepositoryInspection = {
  state: StoredGroupState | null;
  audit_events: AuditEvent[];
  command_outcomes: StoredCommandOutcome[];
  join_outcomes: StoredJoinOutcome[];
};

export class MemoryGroupRepository implements GroupRepository {
  private data: MemoryGroupData;

  constructor(initial: GroupRepositoryInspection | null = null) {
    this.data = initial
      ? {
          state: clone(initial.state),
          auditEvents: clone(initial.audit_events),
          commandOutcomes: clone(initial.command_outcomes),
          joinOutcomes: clone(initial.join_outcomes),
        }
      : emptyMemoryData();
  }

  transaction<T>(operation: (persistence: GroupPersistence) => T): T {
    const working = new MemoryGroupPersistence(this.data);
    const result = operation(working);

    this.data = working.commit();

    return result;
  }

  inspect(): GroupRepositoryInspection {
    return {
      state: clone(this.data.state),
      audit_events: clone(this.data.auditEvents),
      command_outcomes: clone(this.data.commandOutcomes),
      join_outcomes: clone(this.data.joinOutcomes),
    };
  }
}

class MemoryGroupPersistence implements GroupPersistence {
  private readonly data: MemoryGroupData;

  constructor(current: MemoryGroupData) {
    this.data = clone(current);
  }

  loadState(): StoredGroupState | null {
    return clone(this.data.state);
  }

  saveState(state: StoredGroupState): void {
    this.data.state = clone(state);
  }

  findCommandOutcome(commandId: string): StoredCommandOutcome | null {
    return (
      clone(
        this.data.commandOutcomes.find(
          (outcome) => outcome.command_id === commandId,
        ),
      ) ?? null
    );
  }

  recordCommandOutcome(outcome: StoredCommandOutcome): void {
    this.data.commandOutcomes.push(clone(outcome));
  }

  findJoinOutcome(joinId: string): StoredJoinOutcome | null {
    return (
      clone(
        this.data.joinOutcomes.find(
          (outcome) => outcome.join_id === joinId,
        ),
      ) ?? null
    );
  }

  recordJoinOutcome(outcome: StoredJoinOutcome): void {
    this.data.joinOutcomes.push(clone(outcome));
  }

  appendAudit(event: NewAuditEvent): AuditEvent {
    const stored = auditEventSchema.parse({
      sequence: this.data.auditEvents.length + 1,
      ...newAuditEventSchema.parse(clone(event)),
    });

    this.data.auditEvents.push(stored);

    return clone(stored);
  }

  readAudit(): AuditEvent[] {
    return clone(this.data.auditEvents);
  }

  commit(): MemoryGroupData {
    return clone(this.data);
  }
}

function emptyMemoryData(): MemoryGroupData {
  return {
    state: null,
    auditEvents: [],
    commandOutcomes: [],
    joinOutcomes: [],
  };
}

function parseJson<T>(value: string): T {
  // SAFETY: Each JSON column is written only by this adapter from the matching
  // domain type inside the same transaction.
  return JSON.parse(value) as T;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
