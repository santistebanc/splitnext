import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { stores } from './stores.mjs';
import { operations, discovery } from './operations.mjs';

test('operation contracts reject escaping names and unbounded waits', () => {
  assert.equal(operations.addDevice.safeParse({ device: '../normal' }).success, false);
  assert.equal(operations.wait.safeParse({ devices: ['a'], until: 'convergence', timeoutMs: 120001 }).success, false);
  assert.equal(operations.checkpoint.safeParse({ name: '../dev' }).success, false);
  assert.ok(discovery().replaceRows.properties.rows);
});

test('structured store edits stay in discovered D1/DO tables and roll back invalid seeds', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'splitnext-lab-'));

  try {
    await mkdir(path.join(root, 'v3', 'd1'), { recursive: true });
    const file = path.join('v3', 'd1', 'index.sqlite');
    const db = new DatabaseSync(path.join(root, file));
    db.exec("CREATE TABLE sample (id TEXT PRIMARY KEY, value BLOB); INSERT INTO sample VALUES ('original', x'0102')");
    db.close();
    const before = await stores(root);
    assert.deepEqual(before[0].tables[0].rows[0].value, { blob: 'AQI=' });
    await assert.rejects(stores(root, { store: '../normal.sqlite', table: 'sample', rows: [] }), /unknown_store/);
    await assert.rejects(stores(root, { store: file, table: 'sample; DROP TABLE sample', rows: [] }), /unknown_or_protected_table/);
    await assert.rejects(stores(root, { store: file, table: 'sample', rows: [{ id: 'changed' }, { wrong: 'column' }] }), /unknown_column/);
    assert.equal((await stores(root))[0].tables[0].rows[0].id, 'original');
    await stores(root, { store: file, table: 'sample', rows: [{ id: 'seed', value: { blob: 'AwQ=' } }] });
    assert.equal((await stores(root))[0].tables[0].rows[0].id, 'seed');
    await stores(root, { store: file, table: 'sample', rows: [] });
    assert.deepEqual((await stores(root))[0].tables[0].rows, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
