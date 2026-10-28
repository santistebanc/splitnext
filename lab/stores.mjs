import { DatabaseSync } from "node:sqlite";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";

export async function sqliteFiles(root, prefix = "") {
  const found = [];

  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  }).catch(() => [])) {
    const name = path.join(prefix, entry.name);

    if (entry.isDirectory()) found.push(...(await sqliteFiles(root, name)));
    else if (
      entry.name !== "metadata.sqlite" &&
      name.endsWith(".sqlite") &&
      /(^|[\\/])(d1|do)[\\/]/.test(name)
    )
      found.push(name);
  }

  return found;
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

const encode = (value) =>
  value instanceof Uint8Array
    ? { blob: Buffer.from(value).toString("base64") }
    : value;

const blob = z.object({ blob: z.string() });

const decode = (value) => {
  const parsed = blob.safeParse(value);

  return parsed.success ? Buffer.from(parsed.data.blob, "base64") : value;
};

/** Only called while the supervisor has stopped its own Worker. No SQL input. */
export async function stores(root, edit) {
  const deadline = Date.now() + 5000;

  while (true) {
    try {
      return await readStores(root, edit);
    } catch (error) {
      // Windows can finish process termination before releasing SQLite WAL handles.
      if (
        !["SQLITE_IOERR", "SQLITE_BUSY", "ERR_SQLITE_ERROR"].includes(
          error.code,
        ) ||
        Date.now() >= deadline
      )
        throw error;
      await delay(100);
    }
  }
}

async function readStores(root, edit) {
  const files = await sqliteFiles(root);

  if (edit && !files.includes(edit.store)) throw new Error("unknown_store");
  const result = [];

  for (const file of files) {
    const db = new DatabaseSync(path.join(root, file));

    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '__miniflare_%'",
        )
        .all()
        .map((row) => row.name);

      if (edit?.store === file) {
        if (!tables.includes(edit.table) || edit.table === "d1_migrations")
          throw new Error("unknown_or_protected_table");

        const columns = db
          .prepare(`PRAGMA table_info(${quote(edit.table)})`)
          .all()
          .map((row) => row.name);

        if (!Array.isArray(edit.rows) || edit.rows.length > 10000)
          throw new Error("invalid_rows");
        db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE");

        try {
          db.exec(`DELETE FROM ${quote(edit.table)}`);

          for (const row of edit.rows) {
            const keys = Object.keys(row);

            if (!keys.length || keys.some((key) => !columns.includes(key)))
              throw new Error("unknown_column");
            db.prepare(
              `INSERT INTO ${quote(edit.table)} (${keys.map(quote).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
            ).run(...keys.map((key) => decode(row[key])));
          }

          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }

      result.push({
        store: file,
        tables: tables.map((table) => ({
          table,
          columns: db.prepare(`PRAGMA table_info(${quote(table)})`).all(),
          rows: db
            .prepare(`SELECT * FROM ${quote(table)}`)
            .all()
            .map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([key, value]) => [key, encode(value)]),
              ),
            ),
        })),
      });
    } finally {
      db.close();
    }
  }

  return result;
}
