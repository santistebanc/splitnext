import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stores } from "./stores.mjs";
import { operations, discovery } from "./operations.mjs";
import { Lab } from "./runtime.mjs";

test("failed startup cleanup preserves the existing environment manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "splitnext-lab-start-"));
  const lab = new Lab(root, 0);
  const manifest = JSON.stringify({ devices: [{ id: "saved" }] });
  await mkdir(path.join(root, "current"));
  await writeFile(path.join(root, "current", "manifest.json"), manifest);

  try {
    await lab.close();
    assert.equal(
      await readFile(path.join(root, "current", "manifest.json"), "utf8"),
      manifest,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "a wait deadline also bounds an unresponsive device inspector",
  { timeout: 500 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "splitnext-lab-wait-"));
    const lab = new Lab(root, 0);
    lab.inspectDevice = () => new Promise(() => {});

    try {
      await assert.rejects(
        lab.wait({ until: "recovery", devices: ["stalled"], timeoutMs: 20 }),
        /wait_timeout/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("operation contracts reject escaping names and unbounded waits", () => {
  assert.equal(
    operations.addDevice.safeParse({ device: "../normal" }).success,
    false,
  );
  assert.equal(
    operations.wait.safeParse({
      devices: ["a"],
      until: "convergence",
      timeoutMs: 120001,
    }).success,
    false,
  );
  assert.equal(
    operations.checkpoint.safeParse({ name: "../dev" }).success,
    false,
  );
  assert.ok(discovery().replaceRows.properties.rows);
});

test("structured store edits stay in discovered D1/DO tables and roll back invalid seeds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "splitnext-lab-"));

  try {
    await mkdir(path.join(root, "v3", "d1"), { recursive: true });
    const file = path.join("v3", "d1", "index.sqlite");
    const db = new DatabaseSync(path.join(root, file));
    db.exec(
      "CREATE TABLE sample (id TEXT PRIMARY KEY, value BLOB); INSERT INTO sample VALUES ('original', x'0102')",
    );
    db.close();
    const before = await stores(root);
    assert.deepEqual(before[0].tables[0].rows[0].value, { blob: "AQI=" });
    await assert.rejects(
      stores(root, { store: "../normal.sqlite", table: "sample", rows: [] }),
      /unknown_store/,
    );
    await assert.rejects(
      stores(root, {
        store: file,
        table: "sample; DROP TABLE sample",
        rows: [],
      }),
      /unknown_or_protected_table/,
    );
    await assert.rejects(
      stores(root, {
        store: file,
        table: "sample",
        rows: [{ id: "changed" }, { wrong: "column" }],
      }),
      /unknown_column/,
    );
    assert.equal((await stores(root))[0].tables[0].rows[0].id, "original");
    await stores(root, {
      store: file,
      table: "sample",
      rows: [{ id: "seed", value: { blob: "AwQ=" } }],
    });
    assert.equal((await stores(root))[0].tables[0].rows[0].id, "seed");
    await stores(root, { store: file, table: "sample", rows: [] });
    assert.deepEqual((await stores(root))[0].tables[0].rows, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
