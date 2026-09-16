import {
  SQLSchemaMigrations,
  type SQLSchemaMigration,
} from 'durable-utils/sql-migrations';

const migrations: SQLSchemaMigration[] = [
  {
    idMonotonicInc: 1,
    description: 'Create group, member, and member access storage',
    sql: `
      CREATE TABLE IF NOT EXISTS group_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        id TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        name TEXT NOT NULL,
        currency_label TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        display_name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS member_access (
        token_hash TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        device_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (member_id) REFERENCES members(id)
      );

      CREATE INDEX IF NOT EXISTS member_access_member_id
        ON member_access(member_id);
    `,
  },
  {
    idMonotonicInc: 2,
    description: 'Create temporary invitation storage',
    sql: `
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS invites_expires_at
        ON invites(expires_at);
    `,
  },
];

export const MIGRATION_VERSION_KEY = 'splitnext_group_schema_version';

/** Owns schema creation and upgrades for every individual group database. */
export class GroupDatabase {
  private readonly migrationRunner: SQLSchemaMigrations;

  constructor(private readonly storage: DurableObjectStorage) {
    this.migrationRunner = new SQLSchemaMigrations({
      doStorage: storage,
      migrations,
      keyNameTrackingLastMigrationID: MIGRATION_VERSION_KEY,
    });
  }

  /** For a group being created: makes the database and brings it to schema. */
  createForNewGroup(): void {
    this.migrationRunner.runAllSync();
  }

  /**
   * For a group being visited: upgrades the database when there is one, and
   * reports whether this group has storage at all. A group that was never
   * created is left alone, so merely addressing an id provisions nothing.
   */
  prepareExistingGroup(): boolean {
    if (!this.hasGroupTable()) return false;

    if (this.migrationRunner.hasMigrationsToRun()) {
      this.migrationRunner.runAllSync();
    }

    return true;
  }

  private hasGroupTable(): boolean {
    const table = this.storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'group_state'",
      )
      .toArray()[0];

    return table !== undefined;
  }
}
