import type { ClientStorageAdapter } from '@splitnext/client';

/** The SQLite operations used by the replica store; native provides expo-sqlite. */
export type SqliteConnection = {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: string[]): Promise<T | null>;
  runAsync(sql: string, ...params: string[]): Promise<{ changes: number }>;
  withExclusiveTransactionAsync(task: (transaction: SqliteConnection) => Promise<void>): Promise<void>;
};

const queues = new WeakMap<SqliteConnection, Promise<void>>();

const initializations = new WeakMap<SqliteConnection, Promise<void>>();

/** One atomic document update. Success is returned only after SQLite commits. */
export class SqliteClientStorage implements ClientStorageAdapter {
  private ready: Promise<void>;
  private database: SqliteConnection;
  private key: string;

  constructor(database: SqliteConnection, key: string) {
    this.database = database;
    this.key = key;
    this.ready = initializations.get(database) ?? database.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS replica_documents (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    initializations.set(database, this.ready);
    const ready = this.ready;

    void ready.catch(() => {
      if (initializations.get(database) === ready) initializations.delete(database);
    });
  }

  async read(): Promise<string | null> {
    await this.ready;
    await queues.get(this.database);

    return (await this.database.getFirstAsync<{ value: string }>('SELECT value FROM replica_documents WHERE key = ?', this.key))?.value ?? null;
  }

  update<T>(change: (current: string | null) => { serialized: string; result: T }): Promise<T> {
    const operation = (queues.get(this.database) ?? Promise.resolve()).then(async () => {
      await this.ready;
      let result: T | undefined;

      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const current = await transaction.getFirstAsync<{ value: string }>('SELECT value FROM replica_documents WHERE key = ?', this.key);
        const next = change(current?.value ?? null);

        await transaction.runAsync('INSERT INTO replica_documents (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', this.key, next.serialized);
        result = next.result;
      });

      // SAFETY: the callback assigns result before the transaction commits;
      // a failed callback or commit throws instead of reaching this return.
      return result as T;
    });

    // A failed write must not prevent later retries from entering the queue.
    queues.set(this.database, operation.then(() => undefined, () => undefined));

    return operation;
  }
}
