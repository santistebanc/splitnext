import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stores } from "./stores.mjs";
import { operations, discovery } from "./operations.mjs";
import { Lab } from "./runtime.mjs";
import { loseCommittedResponse } from './acceptance-response.mjs';

test('lost-response acceptance waits for the committed mutation, not background reads', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'splitnext-response-'));
  const lab = new Lab(root, 0);
  let committed = false;
  const perform = lab.perform.bind(lab);
  const gated = Promise.withResolvers();
  let pending;

  lab.inspectServer = async () => ({ groups: [{ snapshot: { group: { id: 'group', name: committed ? 'Changed' : 'Original' } } }] });
  lab.perform = async (operation, input) => {
    if (operation === 'serverNetwork' && !input.available) assert.equal(committed, true, 'gate_before_commit');
    const result = await perform(operation, input);

    if (operation === 'serverNetwork') gated.resolve();

    return result;
  };

  try {
    await loseCommittedResponse(lab, {
      device: 'a', groupId: 'group', name: 'Changed', timeoutMs: 1000,
      action: () => (pending = (async () => {
        await lab.event('response.received', { device: 'a', method: 'GET', path: '/identity/groups' });
        await lab.event('response.received', { device: 'a', method: 'POST', path: '/groups/group/sync' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        committed = true;
        await lab.event('response.received', { device: 'a', method: 'POST', path: '/groups/group/sync' });
        await gated.promise;
        assert.equal(lab.available, false, 'response_was_not_interrupted');
        await lab.event('response.lost', { device: 'a', method: 'POST', path: '/groups/group/sync' });
      })()),
    });
    assert.equal(lab.available, false);
  } finally {
    gated.resolve();
    await pending?.catch(() => {});
    await lab.eventTail;
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed action is reported before the observation timeout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'splitnext-response-'));
  const lab = new Lab(root, 0);
  const failure = new Error('action_failed_before_response');
  const action = Promise.reject(failure);

  // The assertion concerns the primary error, not the test runner's own
  // unhandled-rejection reporting while exercising the old implementation.
  void action.catch(() => {});

  try {
    await assert.rejects(loseCommittedResponse(lab, { device: 'a', action: () => action, timeoutMs: 30 }), (error) => error === failure);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a host report is acknowledged before awaiting a gate result on the same channel', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'splitnext-response-channel-'));
  const lab = new Lab(root, 0);
  const acknowledged = Promise.withResolvers();
  const gated = Promise.withResolvers();
  const perform = lab.perform.bind(lab);
  let pending;

  lab.inspectServer = async () => ({ groups: [{ snapshot: { group: { id: 'group', name: 'Changed' } } }] });
  lab.perform = async (operation, input) => {
    if (operation === 'serverNetwork') await acknowledged.promise;
    const result = await perform(operation, input);

    if (operation === 'serverNetwork') gated.resolve();

    return result;
  };

  try {
    await loseCommittedResponse(lab, {
      device: 'a', groupId: 'group', name: 'Changed', timeoutMs: 150,
      action: () => (pending = (async () => {
        await lab.event('response.received', { device: 'a', method: 'POST', path: '/groups/group/sync' });
        acknowledged.resolve();
        await gated.promise;
        await lab.event('response.lost', { device: 'a', method: 'POST', path: '/groups/group/sync' });
      })()),
    });
  } finally {
    acknowledged.resolve();
    await pending?.catch(() => {});
    await lab.eventTail;
    await rm(root, { recursive: true, force: true });
  }
});

test('lost-response acceptance fails when the response is not actually lost', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'splitnext-response-'));
  const lab = new Lab(root, 0);
  const perform = lab.perform.bind(lab);

  lab.inspectServer = async () => ({ groups: [{ snapshot: { group: { id: 'group', name: 'Changed' } } }] });
  // Deliberately broken fault injection: claiming to close the gate must not
  // count as proof that an acknowledgment was lost.
  lab.perform = (operation, input) => operation === 'serverNetwork' ? { available: false } : perform(operation, input);

  try {
    await assert.rejects(loseCommittedResponse(lab, {
      device: 'a', groupId: 'group', name: 'Changed', timeoutMs: 1000, lossTimeoutMs: 30,
      action: () => lab.event('response.received', { device: 'a', method: 'POST', path: '/groups/group/sync' }),
    }), /response_not_lost/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an observation timeout retains its error when cleanup rejects the pending action', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'splitnext-response-'));
  const lab = new Lab(root, 0);
  const originalEvent = lab.event;
  const action = Promise.withResolvers();

  try {
    await assert.rejects(loseCommittedResponse(lab, { device: 'a', action: () => action.promise, timeoutMs: 30 }), /inflight_request_timeout/);
    action.reject(new Error('host_disconnected_during_cleanup'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lab.event, originalEvent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

/** A lab page standing in for the supervisor's SSE connection. */
function fakePage(lab, handlers = {}) {
  const calls = [];
  const closers = [];

  const res = {
    ended: false,
    written: [],
    write(chunk) {
      this.written.push(chunk);
      const call = /^event: call\ndata: (.*)\n\n$/s.exec(chunk);

      if (!call) return;
      const { id, command } = JSON.parse(call[1]);

      calls.push(command);
      queueMicrotask(() => {
        const handler = handlers[command.type === "device" ? command.command.method : command.type];

        lab.hostResult({ id, ok: true, value: handler ? handler(command) : {} });
      });
    },
    on: (event, listener) => event === "close" && closers.push(listener),
    end() {
      this.ended = true;
      closers.forEach((close) => close());
    },
  };

  return { res, calls };
}

test("operation contracts name the device kind and default to a real browser", () => {
  assert.equal(operations.addDevice.parse({ device: "a" }).kind, "browser");
  assert.equal(operations.addDevice.parse({ device: "a", kind: "inpage" }).kind, "inpage");
  assert.equal(operations.addDevice.safeParse({ device: "a", kind: "iframe" }).success, false);
  assert.ok(discovery().deviceCapabilities.properties.clipboardText);
});

test("the first suitable page hosts in-page devices and later pages only view", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "splitnext-lab-host-"));

  try {
    const lab = new Lab(root, 0, { host: "auto" });
    const first = fakePage(lab);
    const second = fakePage(lab);

    lab.registerHost(first.res, false);
    lab.registerHost(second.res, false);
    assert.match(first.res.written.join(""), /"role":"host"/);
    assert.match(second.res.written.join(""), /"role":"viewer"/);

    const headless = new Lab(root, 0, { host: "headless" });
    const tab = fakePage(headless);

    headless.registerHost(tab.res, false);
    assert.match(tab.res.written.join(""), /"role":"viewer"/);
    assert.equal(headless.host, null);

    const tabOnly = new Lab(root, 0, { host: "tab" });
    const background = fakePage(tabOnly);

    tabOnly.registerHost(background.res, true);
    assert.match(background.res.written.join(""), /"role":"viewer"/);
    first.res.end();
    tab.res.end();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("in-page devices are driven through their host and namespaced by environment, name and generation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "splitnext-lab-host-"));

  try {
    const lab = new Lab(root, 0, { host: "tab" });
    await mkdir(path.join(root, "current"), { recursive: true });
    const page = fakePage(lab, { ready: () => ({ ready: true }), network: (command) => ({ online: command.command.online, latencyMs: command.command.latencyMs }) });

    lab.registerHost(page.res, false);
    await lab.hostReady();

    await lab.execute("addDevice", { device: "a", kind: "inpage" });
    await lab.execute("addDevice", { device: "b", kind: "inpage" });

    const sync = page.calls.filter((call) => call.type === "sync").at(-1);
    const namespaces = sync.devices.map((device) => device.namespace);

    assert.equal(new Set(namespaces).size, 2);
    assert.ok(namespaces.every((name) => name.startsWith(`${path.basename(root)}-`)));
    assert.deepEqual((await lab.execute("status", {})).deviceKinds, { a: "inpage", b: "inpage" });

    await lab.execute("deviceNetwork", { device: "b", online: false, latencyMs: 40 });
    assert.deepEqual(page.calls.at(-1).command, { method: "network", online: false, latencyMs: 40 });
    assert.equal((await lab.manifest()).devices.find((device) => device.id === "b").online, false);

    assert.deepEqual(sync.devices[0].screen, { width: 390, height: 780 });
    assert.deepEqual(await lab.execute("deviceScreen", { device: "a", width: 412, height: 915 }), { screen: { width: 412, height: 915 } });
    assert.deepEqual(page.calls.at(-1).command, { method: "resize", width: 412, height: 915 });
    assert.deepEqual((await lab.manifest()).devices.find((device) => device.id === "a").screen, { width: 412, height: 915 });
    assert.equal(operations.deviceScreen.safeParse({ device: "a", width: 100, height: 915 }).success, false);

    await lab.execute("deviceForeground", { device: "a" });
    assert.equal(page.calls.at(-1).command.method, "foreground");
    await assert.rejects(lab.execute("input", { device: "a", kind: "click" }), /input_needs_headless_host/);
    await assert.rejects(lab.execute("checkpoint", { name: "tab" }), /checkpoint_needs_headless_host/);

    assert.equal((await lab.execute("removeDevice", { device: "b" })).storage, "deleted");
    assert.deepEqual(page.calls.filter((call) => call.type === "device").at(-1), { type: "device", device: "b", command: { method: "remove" } });
    assert.deepEqual((await lab.execute("status", {})).devices, ["a"]);
    assert.deepEqual((await lab.manifest()).devices.map((device) => device.id), ["a"]);
    await assert.rejects(lab.execute("inspectDevice", { device: "b" }), /unknown_device/);

    await lab.execute("serverNetwork", { available: false });
    assert.deepEqual(page.calls.at(-1), { type: "gate", open: false, epoch: lab.epoch });
    page.res.end();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a lost host fails pending calls and a replacement host takes over", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "splitnext-lab-host-"));

  try {
    const lab = new Lab(root, 0, { host: "tab" });
    await mkdir(path.join(root, "current"), { recursive: true });
    const silent = fakePage(lab);
    silent.res.write = function write() {};

    lab.registerHost(silent.res, false);
    lab.host.ready = true;
    const pending = lab.rawHostCall(lab.host, { type: "gate", open: true, epoch: 0 });

    silent.res.end();
    await assert.rejects(pending, /host_disconnected/);
    assert.equal(lab.host, null);

    const next = fakePage(lab);

    lab.registerHost(next.res, false);
    assert.equal(lab.host.res, next.res);
    next.res.end();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
