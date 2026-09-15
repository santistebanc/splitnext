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
];

const MIGRATION_VERSION_KEY = 'splitnext_group_schema_version';

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

  provision(): void {
    this.migrationRunner.runAllSync();
  }

  upgradeIfPresent(): void {
    if (
      !this.migrationRunner.hasMigrationsToRun() ||
      !this.hasGroupTable()
    ) {
      return;
    }

    this.migrationRunner.runAllSync();
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
