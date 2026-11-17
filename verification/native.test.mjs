import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SqliteClientStorage } from '../apps/client/src/native/storage.ts';
import { createNativeNavigation } from '../apps/client/src/native/navigation.ts';
import { nativeAmountDraft } from '../apps/client/src/native/amount.ts';
import { encodeBinary } from '../apps/client/src/native/base64.ts';
import { createIncomingLinks, normalizeSystemLink } from '../apps/client/src/native/incomingLinks.ts';

test('native system links survive route setup and repeat delivery allows a blocked action to retry', () => {
  assert.equal(normalizeSystemLink('splitnext://j#abcdefghijkl'), 'splitnext:///j#abcdefghijkl');
  assert.equal(normalizeSystemLink('/j#abcdefghijkl'), 'https://native.invalid/j#abcdefghijkl');
  assert.equal(normalizeSystemLink('https://example.test/j#abcdefghijkl'), 'https://example.test/j#abcdefghijkl');
  const links = createIncomingLinks();
  const cold = 'splitnext:///j#abcdefghijkl';
  const warm = 'splitnext:///j#mnopqrstuvwx';

  links.receive(cold);
  assert.equal(links.url(), cold);
  const received = [];
  const stop = links.subscribe((url) => received.push(url));

  links.receive(warm);
  links.receive(warm);
  assert.deepEqual(received, [warm, warm]);
  assert.equal(links.url(), warm);
  stop();
  links.receive(cold);
  assert.deepEqual(received, [warm, warm]);
});

test('native identifier encoding matches the shared byte format', () => {
  for (const size of [0, 1, 2, 3, 16, 32, 256]) {
    const binary = String.fromCharCode(...Array.from({ length: size }, (_, index) => index % 256));

    assert.equal(encodeBinary(binary), btoa(binary));
  }

  assert.throws(() => encodeBinary('\u0100'), /InvalidCharacterError/);
});

test('native HTTP transport is enabled only for an explicit HTTP test endpoint', () => {
  const require = createRequire(import.meta.url);
  const file = require.resolve('../apps/client/app.config.js');
  const original = process.env.EXPO_PUBLIC_API_URL;

  try {
    for (const url of ['', 'https://example.test', 'http://localhost:8787']) {
      process.env.EXPO_PUBLIC_API_URL = url;
      delete require.cache[file];
      const { expo } = require(file);
      const properties = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties')[1];

      assert.equal(properties.android.usesCleartextTraffic, url.startsWith('http://'));
      assert.equal(Boolean(expo.ios.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads), url.startsWith('http://'));
    }
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = original;
    delete require.cache[file];
  }
});

test('native amount entry accepts typing, decimal commas, and backspace without rounding the draft', () => {
  for (const draft of ['', '1', '12', '12.', '12.3', '12.34', '12.3', '12.', '12', '1', '']) assert.equal(nativeAmountDraft(draft), draft);
  assert.equal(nativeAmountDraft('12,34'), '12.34');
  assert.equal(nativeAmountDraft('.5'), '0.5');

  for (const invalid of ['1.234', '1.2.3', '-1', 'no amount']) assert.equal(nativeAmountDraft(invalid), null);
});

// Real SQLite checks the adapter's commit boundary. Device tests must still
// check expo-sqlite and operating-system process termination on each platform.
function connection(file) {
  const database = new DatabaseSync(file);

  const adapter = {
    execAsync: async (sql) => { database.exec(sql); },
    getFirstAsync: async (sql, ...params) => database.prepare(sql).get(...params) ?? null,
    runAsync: async (sql, ...params) => database.prepare(sql).run(...params),
    withExclusiveTransactionAsync: async (task) => {
      database.exec('BEGIN IMMEDIATE');

      try { await task(adapter); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };

  return { adapter, close: () => database.close() };
}

test('native storage retains queued work after close and reopen, without lost concurrent updates', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'splitnext-native-'));
  const file = path.join(directory, 'ledger.db');
  let database = connection(file);

  try {
    const first = new SqliteClientStorage(database.adapter, 'installation');
    const second = new SqliteClientStorage(database.adapter, 'installation');

    await Promise.all(Array.from({ length: 20 }, (_, id) => (id % 2 ? first : second).update((current) => {
      const outbox = current ? JSON.parse(current).outbox : [];

      return { serialized: JSON.stringify({ outbox: [...outbox, { id }] }), result: id };
    })));
    database.close();
    database = connection(file);
    const restored = new SqliteClientStorage(database.adapter, 'installation');

    assert.deepEqual(JSON.parse(await restored.read()).outbox.map((command) => command.id), Array.from({ length: 20 }, (_, id) => id));
    assert.equal(await new SqliteClientStorage(database.adapter, 'other-installation').read(), null);
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
});

test('native storage does not report success after a failed write, and permits retry', async () => {
  const database = connection(':memory:');
  const storage = new SqliteClientStorage(database.adapter, 'installation');

  try {
    await storage.update(() => ({ serialized: 'saved', result: null }));
    const original = database.adapter.runAsync;

    database.adapter.runAsync = async (...args) => { await original(...args); throw new Error('disk failure'); };

    await assert.rejects(storage.update(() => ({ serialized: 'lost', result: 'success' })), /disk failure/);
    assert.equal(await storage.read(), 'saved');
    database.adapter.runAsync = original;
    await assert.rejects(storage.update(() => { throw new Error('invalid change'); }), /invalid change/);
    assert.equal(await storage.update(() => ({ serialized: 'retried', result: 'committed' })), 'committed');
    assert.equal(await storage.read(), 'retried');
  } finally { database.close(); }
});

test('native Back preserves history when navigation is blocked, then returns after success', () => {
  const history = createNativeNavigation();
  const home = { splitnext: true, view: 'home', trail: [], person: null, groupId: 'group' };
  const person = { ...home, view: 'person', person: 'member' };
  const activity = { ...home, view: 'activity' };
  const requested = [];
  const stop = history.navigation.subscribe((entry) => requested.push(entry));

  history.navigation.write(home, 'replace');
  history.navigation.write(person, 'push');
  history.navigation.write(activity, 'push');
  assert.equal(history.back(), true);
  assert.deepEqual(requested.at(-1), person);
  // A blocked shared action does not publish a new entry.
  assert.equal(history.back(), true);
  assert.deepEqual(requested.at(-1), person);
  history.navigation.write(person, 'replace');
  history.back();
  assert.deepEqual(requested.at(-1), home);
  history.navigation.write(home, 'replace');
  assert.equal(history.back(), false);
  stop();
});
