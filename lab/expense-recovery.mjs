import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { expect as playwrightExpect } from '@playwright/test';
import { Lab } from './runtime.mjs';
import { currentBuild, git } from '../verification/provenance.mjs';

const expect = playwrightExpect.configure({ timeout: 15000 });

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.equal(process.argv[2], '--config', 'Use npm run verify -- run expense-recovery');

const config = JSON.parse(await readFile(process.argv[3], 'utf8'));

const root = path.resolve(config.root);

const runId = path.basename(path.dirname(path.resolve(process.argv[3])));

assert.match(runId, /^[a-f0-9-]{36}$/);

assert.equal(root, path.resolve('.wrangler/lab', `v-${runId}`), 'scenario_root_must_match_owned_run');

await mkdir(root, { recursive: true });

const evidence = { passed: false, fixture: 'expense-recovery-v1 / Ana / Bo / 12.50',
  commit: git('rev-parse', 'HEAD').trim(), patch: git('diff', 'HEAD', '--binary'),
  untracked: {}, node: process.version, platform: process.platform, root,
  command: 'npm run verify:expense-recovery', checkpoints: [], controls: [], unverified: [
    'physical packet loss', 'storage eviction/hardware durability', 'native clients',
    'acknowledgment write failure', 'server disk failure', 'production deployment',
  ] };

for (const file of git('ls-files', '--others', '--exclude-standard').trim().split('\n').filter(Boolean))
  evidence.untracked[file] = hash(await readFile(file));

const lab = new Lab(root, 8857, { host: 'headless' });

let closing;

const close = () => closing ??= lab.close();

const interrupt = () => { void close().finally(() => process.exit(130)); };

process.once('SIGTERM', interrupt);

process.once('SIGINT', interrupt);

const op = (name, input = {}) => lab.execute(name, input);

const action = async (device, name, input = {}) => {
  const result = await op('action', { device, name, input });
  assert.equal(result.status, 'done', JSON.stringify(result));
};

const button = (page, name) => page.getByRole('button', { name, exact: true });

const field = (page, name) => page.getByRole('textbox', { name, exact: true });

const required = config.expected;

assert.ok(Array.isArray(required) && required.length > 0, 'missing_expected_checks');

function complete(checkpoints) { assert.deepEqual(checkpoints, required, 'critical checkpoint skipped'); }

async function document(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('splitnext-app');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      const value = await new Promise((resolve, reject) => {
        const request = db.transaction('client_documents').objectStore('client_documents')
          .get(localStorage.getItem('splitnext.installation.v1'));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (!value) throw new Error('missing_client_document');

      return JSON.parse(value);
    } finally { db.close(); }
  });
}

function exactlyOne(expenses, description) {
  assert.ok(Array.isArray(expenses), 'missing expense fixture');
  const matches = expenses.filter((expense) => expense.description === description);
  assert.equal(matches.length, 1, `exactly one ${description}`);
  assert.equal(matches[0].total, 1250);
}

function verifyObservation(observation, expected) {
  complete(observation.checkpoints);
  assert.equal(observation.groupId, expected.groupId, 'wrong store');
  assert.deepEqual(observation.assets, expected.assets, 'stale build');
  assert.deepEqual(observation.unexpected, [], 'unexpected network');
  assert.equal(observation.expenses.length, 2);

  for (const description of ['Offline meal', 'Lost response meal']) exactlyOne(observation.expenses, description);
}

async function draft(page, description) {
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('12.50');
  await field(page, 'Description').fill(description);
}

async function visibleExpense(page, description) {
  await expect(page.getByRole('button', { name: new RegExp(`^Change ${description} · `) })).toHaveCount(1);
}

async function settled(pages, descriptions) {
  await expect.poll(async () => {
    const docs = await Promise.all(pages.map(document));

    return docs.every((doc) => doc.groups.length === 1 && doc.groups[0].outbox.length === 0 &&
      descriptions.every((description) => doc.groups[0].snapshot.expenses.filter((e) => e.description === description).length === 1));
  }, { timeout: 90000 }).toBe(true);

  for (const page of pages) {
    // Reload independently of the controller inspector; render only persisted state.
    await page.reload();
    await expect(button(page, 'Add expense')).toBeVisible();
    await page.getByRole('tab', { name: /^Expenses/ }).click();

    for (const description of descriptions) {
      exactlyOne((await document(page)).groups[0].snapshot.expenses, description);
      await visibleExpense(page, description);
    }

    await expect(page.getByRole('button', { name: /Connection details/ })).toHaveCount(0);
  }
}

async function files(dir) {
  const result = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);

    if (entry.isDirectory()) result.push(...await files(file));
    else result.push(file);
  }

  return result;
}

async function readStore(file) {
  const deadline = Date.now() + 10000;

  for (;;) {
    let db;

    try {
      db = new DatabaseSync(file, { readOnly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);

      if (!tables.includes('group_state')) return null;

      return {
        snapshots: db.prepare('SELECT snapshot_json FROM group_state').all().map((r) => JSON.parse(r.snapshot_json)),
        events: db.prepare('SELECT event_json FROM group_audit_events').all().map((r) => JSON.parse(r.event_json)),
        commands: db.prepare('SELECT command_json FROM group_command_outcomes').all().map((r) => JSON.parse(r.command_json)),
      };
    } catch (error) {
      if (!['ERR_SQLITE_ERROR', 'SQLITE_BUSY', 'SQLITE_IOERR'].includes(error.code) || Date.now() >= deadline) throw error;
    } finally { db?.close(); }

    await delay(100);
  }
}

function rejectControl(name, check) {
  assert.throws(check, undefined, `detector accepted ${name}`);
  evidence.controls.push(name);
}

try {
  assert.deepEqual(await currentBuild(), config.build, 'stale_build');
  evidence.build = config.build;
  evidence.assets = config.build.assets;
  evidence.currentCheck = 'fixture-setup';
  assert.ok(Object.keys(evidence.assets).some((file) => file.endsWith('.js')), 'missing built JavaScript');
  await lab.init();
  await op('addDevice', { device: 'a', kind: 'browser' });
  await op('addDevice', { device: 'b', kind: 'browser' });
  const a = lab.device('a').page;
  const b = lab.device('b').page;

  for (const page of [a, b]) page.setDefaultTimeout(15000);
  const unexpected = [];
  const delivered = [];

  for (const d of [lab.device('a'), lab.device('b')]) {
    await d.context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== lab.base) {
        unexpected.push(route.request().url());
        await route.abort();
      } else {
        if (route.request().url().endsWith('/sync')) delivered.push(route.request().postDataJSON());
        await route.fallback();
      }
    });
  }

  evidence.browser = lab.device('a').context.browser()?.version();
  await action('a', 'createGroup', { name: 'Recovery fixture', yourName: 'Ana' });
  const initial = await document(a);
  assert.equal(initial.groups.length, 1);
  const group = initial.groups[0];
  evidence.groupId = group.group_id;
  await action('b', 'joinGroup', { groupId: group.group_id, token: group.snapshot.invite.token, as: { kind: 'new', name: 'Bo' } });
  await expect.poll(async () => (await document(a)).groups[0].snapshot.members.length).toBe(2);
  assert.notEqual((await document(b)).session.identity.id, initial.session.identity.id);
  await op('deviceNetwork', { device: 'a', online: false });
  await draft(a, 'Offline meal');
  await button(a, 'Save').click();
  await visibleExpense(a, 'Offline meal');
  await expect(a.getByRole('button', { name: /Offline.*1 change saved here/ })).toBeVisible();
  const queued = (await document(a)).groups[0].outbox;
  assert.equal(queued.length, 1);
  evidence.commandId = queued[0].command.command_id;
  evidence.currentCheck = 'outbox-survives-reload';

  if (config.negativeControl === 'lost-outbox') {
    evidence.negativeControl = { id: 'lost-outbox', injected: false, expectedCheck: 'outbox-survives-reload' };
    await a.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('splitnext-app');

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('client_documents', 'readwrite');
          const store = tx.objectStore('client_documents');
          const key = localStorage.getItem('splitnext.installation.v1');
          const request = store.get(key);

          request.onsuccess = () => {
            const saved = JSON.parse(request.result);

            saved.groups[0].outbox = [];
            store.put(JSON.stringify(saved), key);
          };

          tx.oncomplete = resolve;
          tx.onabort = () => reject(new Error('negative_control_write_failed'));
        });
      } finally { db.close(); }
    });
    evidence.negativeControl.injected = true;
  } else assert.equal(config.negativeControl, null, 'unknown_negative_control');
  await op('reloadDevice', { device: 'a' });
  assert.deepEqual((await document(a)).groups[0].outbox, queued, 'expense_outbox_lost_after_reload');
  await expect(a.getByRole('button', { name: /Offline.*1 change saved here/ })).toBeVisible();
  evidence.checkpoints.push('offline-save-and-reload');
  evidence.currentCheck = 'reconnected';
  await op('deviceNetwork', { device: 'a', online: true });
  await settled([a, b], ['Offline meal']);
  evidence.checkpoints.push('reconnected');
  evidence.currentCheck = 'lost-response-reload-retry';

  // Drop exactly the response containing the second expense, after real commit.
  let dropped = 0;
  await a.route('**/sync', async (route) => {
    const body = route.request().postDataJSON();

    if (!dropped && JSON.stringify(body).includes('Lost response meal')) {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      // Explicit duplicate delivery of the identical request before losing its reply.
      const duplicate = await route.fetch();
      assert.equal(duplicate.status(), 200);
      assert.deepEqual(await duplicate.json(), await response.json());
      dropped++;
      await op('serverNetwork', { available: false });
      await route.abort('connectionfailed');
    } else await route.fallback();
  });
  await draft(a, 'Lost response meal');
  await button(a, 'Save').click();
  await visibleExpense(a, 'Lost response meal');
  assert.equal(dropped, 1);
  await expect(a.getByRole('button', { name: /1 change saved here/ })).toBeVisible();
  const lost = (await document(a)).groups[0].outbox;
  assert.equal(lost.length, 1);
  const committed = await (await fetch(`${lab.base}/debug/groups/${group.group_id}`)).json();
  exactlyOne(committed.snapshot.expenses, 'Lost response meal');
  await writeFile(path.join(root, 'lost-response-server.json'), JSON.stringify(committed, null, 2));
  await op('reloadDevice', { device: 'a' });
  assert.deepEqual((await document(a)).groups[0].outbox, lost);
  await a.getByRole('button', { name: /Connection details/ }).click();
  await button(a, 'Retry').click();
  assert.deepEqual((await document(a)).groups[0].outbox, lost);
  await op('serverNetwork', { available: true });
  await settled([a, b], ['Offline meal', 'Lost response meal']);
  evidence.clients = await Promise.all([a, b].map(async (page) => {
    const doc = await document(page);

    return { identityId: doc.session.identity.id, groupId: doc.groups[0].group_id,
      revision: doc.groups[0].revision, outbox: doc.groups[0].outbox,
      expenses: doc.groups[0].snapshot.expenses };
  }));
  evidence.checkpoints.push('lost-response-reload-retry');
  evidence.currentCheck = 'persistence-abort-no-success';

  // Abort the actual put transaction, after the adapter has prepared its write.
  await draft(a, 'Unsaved meal');
  await a.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.restoreExpensePut = () => { IDBObjectStore.prototype.put = put; };

    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);

      if (this.name === 'client_documents' && String(args[0]).includes('Unsaved meal')) this.transaction.abort();

      return request;
    };
  });
  await button(a, 'Save').click();
  await expect(a.getByText('Changes could not be saved on this device. Free some storage and try again.', { exact: true })).toBeVisible();
  await expect(field(a, 'Description')).toHaveValue('Unsaved meal');
  assert.equal((await document(a)).groups[0].outbox.length, 0);
  assert.equal((await document(a)).groups[0].snapshot.expenses.length, 2);
  await expect(a.getByText(/1 change saved here/)).toHaveCount(0);
  await a.evaluate(() => window.restoreExpensePut());
  await a.reload();
  assert.equal((await document(a)).groups[0].snapshot.expenses.length, 2);
  evidence.checkpoints.push('persistence-abort-no-success');
  evidence.currentCheck = 'independent-sqlite';

  // Stop first, then independently query files, not debug routes or lab convergence.
  await op('serverProcess', { running: false });

  const sqlite = (await files(path.join(lab.data, 'server'))).filter((file) => file.endsWith('.sqlite') &&
    path.basename(file) !== 'metadata.sqlite' && /[\\/]v3[\\/](do|d1)[\\/]/.test(file));

  const snapshots = [];
  const events = [];
  const commands = [];
  evidence.stores = [];

  for (const file of sqlite) {
    const stored = await readStore(file);

    if (!stored) continue;
    evidence.stores.push(file);
    snapshots.push(...stored.snapshots);
    events.push(...stored.events);
    commands.push(...stored.commands);
  }

  assert.equal(snapshots.length, 1, 'missing/wrong authoritative store');
  assert.equal(snapshots[0].group.id, group.group_id);
  assert.equal(snapshots[0].expenses.length, 2);

  for (const client of evidence.clients) {
    assert.equal(client.groupId, group.group_id);
    assert.deepEqual(client.expenses, snapshots[0].expenses, 'client differs from persisted server');
    assert.deepEqual(client.outbox, []);
  }

  for (const description of ['Offline meal', 'Lost response meal']) {
    exactlyOne(snapshots[0].expenses, description);
    assert.equal(commands.filter((c) => c.type === 'expense.record' && c.payload.description === description).length, 1);
    assert.equal(events.filter((e) => JSON.stringify(e).includes(description)).length, 1);
  }

  evidence.checkpoints.push('independent-sqlite');
  evidence.persisted = { expenses: snapshots[0].expenses, expenseCommands: commands.filter((c) => c.type === 'expense.record'), events };
  const actualAssets = {};

  for (const file of Object.keys(evidence.assets)) actualAssets[file] = hash(await readFile(file));

  const observation = { groupId: snapshots[0].group.id, expenses: snapshots[0].expenses,
    checkpoints: evidence.checkpoints, assets: actualAssets,
    unexpected: [...unexpected, ...(await lab.lines('timeline')).filter((entry) => entry.kind === 'network.unexpected')] };

  const expected = { groupId: group.group_id, assets: evidence.assets };
  verifyObservation(observation, expected);
  const negative = (name, changes) => rejectControl(name, () => verifyObservation({ ...structuredClone(observation), ...changes }, expected));
  negative('duplicate expense', { expenses: [...observation.expenses, observation.expenses[0]] });
  negative('lost expense', { expenses: observation.expenses.slice(1) });
  negative('missing fixture', { expenses: undefined });
  negative('zero checks', { checkpoints: [] });
  negative('skipped critical check', { checkpoints: required.slice(1) });
  negative('wrong store', { groupId: 'another-group' });
  const staleAssets = { ...actualAssets, [Object.keys(actualAssets)[0]]: hash('deliberately stale asset') };

  negative('stale build', { assets: staleAssets });
  negative('unexpected network', { unexpected: ['https://example.invalid'] });

  const attempts = delivered.flatMap((request) => request.commands ?? [])
    .filter((command) => command.command_id === lost[0].command.command_id);

  assert.ok(attempts.length >= 1, 'retry delivery missing');
  evidence.retry = { commandId: lost[0].command.command_id, observedRetryAttempts: attempts.length, droppedResponses: dropped };
  assert.deepEqual(unexpected, [], 'unexpected network');
  assert.equal(git('diff', 'HEAD', '--binary'), evidence.patch, 'sources changed during experiment');
  assert.equal(git('rev-parse', 'HEAD').trim(), evidence.commit, 'HEAD changed during experiment');

  for (const [file, digest] of Object.entries(evidence.untracked)) assert.equal(hash(await readFile(file)), digest, 'untracked source changed');

  for (const [file, digest] of Object.entries(evidence.assets)) assert.equal(hash(await readFile(file)), digest, 'build changed during experiment');
  evidence.passed = true;
  console.log(`Expense recovery passed: ${root}`);
} catch (error) {
  evidence.error = String(error.stack ?? error);
  evidence.passed = false;
  evidence.failure = { category: error.code === 'EADDRINUSE' ? 'environment' : error.code === 'ERR_ASSERTION' && evidence.currentCheck !== 'fixture-setup' ? 'product' : 'harness', check: evidence.currentCheck ?? 'fixture-setup' };

  for (const [id, device] of lab.devices) {
    if (!device.page) continue;

    await device.page.screenshot({ path: path.join(root, `failure-${id}.png`), timeout: 5000 }).catch(() => undefined);
    await device.page.content().then((html) => writeFile(path.join(root, `failure-${id}.html`), html)).catch(() => undefined);
  }

  throw error;
} finally {
  try { await close(); evidence.cleanup = 'completed'; } catch (error) {
    evidence.passed = false;
    evidence.cleanup = 'failed';
    evidence.cleanupError = String(error);
    process.exitCode = 1;
  } finally {
    await writeFile(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${path.join(root, 'evidence.json')}`);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGINT', interrupt);
  }
}
