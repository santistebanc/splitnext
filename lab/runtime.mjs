import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  cp,
  rm,
  readdir,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { operations, discovery } from "./operations.mjs";
import { stores } from "./stores.mjs";

/** A phone screen in CSS pixels; each device can be given another. */
const defaultScreen = { width: 390, height: 780 };

export class Lab {
  devices = new Map();
  worker = null;
  available = true;
  epoch = 0;
  sequence = 0;
  initialized = false;
  maintaining = false;
  requests = new Set();
  tail = Promise.resolve();
  eventTail = Promise.resolve();
  saveTail = Promise.resolve();
  host = null;
  hosting = null;
  headless = null;
  stopping = false;
  hostWaiters = [];
  labOrigin = null;
  constructor(root, port, options = {}) {
    this.root = root;
    this.port = port;
    this.hostMode = options.host ?? "auto";
    this.base = `http://127.0.0.1:${port}`;
    this.data = path.join(root, "current");
  }
  async init() {
    this.initialized = false;
    await mkdir(this.data, { recursive: true });
    const manifest = await this.manifest();
    this.available = manifest.available ?? true;

    if (manifest.port && manifest.port !== this.port)
      throw new Error("environment_port_changed");

    const timeline = await readFile(
      path.join(this.root, "timeline.jsonl"),
      "utf8",
    ).catch(() => "");

    this.sequence = timeline.trim().split("\n").filter(Boolean).length;
    await this.start();

    for (const item of manifest.devices ?? []) await this.addDevice(item, true);
    await this.save();
    this.initialized = true;
  }
  manifest() {
    return readFile(path.join(this.data, "manifest.json"), "utf8")
      .then(JSON.parse)
      .catch(() => ({}));
  }
  async save() {
    const serialized = JSON.stringify(
      {
        port: this.port,
        available: this.available,
        devices: [...this.devices.values()].map(
          ({ id, kind, online, latencyMs, generation, clipboard, share, screen }) => ({
            id,
            kind,
            online,
            latencyMs,
            generation,
            clipboard,
            share,
            screen,
          }),
        ),
      },
      null,
      2,
    );

    const write = this.saveTail.then(async () => {
      await mkdir(this.data, { recursive: true });
      const temporary = path.join(this.data, "manifest.tmp");
      await writeFile(temporary, serialized);
      await rename(temporary, path.join(this.data, "manifest.json"));
    });

    this.saveTail = write.catch(() => {});
    await write;
  }
  async event(kind, detail) {
    // Reserve the sequence before awaiting I/O; append calls retain invocation order.
    const entry = {
      sequence: ++this.sequence,
      at: new Date().toISOString(),
      kind,
      detail,
    };

    const write = this.eventTail.then(() =>
      appendFile(
        path.join(this.root, "timeline.jsonl"),
        JSON.stringify(entry) + "\n",
      ),
    );

    this.eventTail = write.catch(() => {});
    await write;

    return entry;
  }
  async runWrangler(args) {
    const child = spawn(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...args],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    const output = createWriteStream(path.join(this.root, "worker.log"), {
      flags: "a",
    });

    child.stdout.pipe(output);
    child.stderr.pipe(output);
    child.once("exit", () => output.end());

    return child;
  }
  async start() {
    if (this.worker) return;
    // Refuse any occupied port: never attach to or terminate someone else's Worker.
    const { createServer } = await import("node:net");
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(this.port, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
    const persist = path.join(this.data, "server");

    const migration = await this.runWrangler([
      "d1",
      "migrations",
      "apply",
      "INDEX",
      "--local",
      "--persist-to",
      persist,
    ]);

    const [code] = await once(migration, "exit");

    if (code !== 0) throw new Error("migration_failed_see_worker_log");
    this.worker = await this.runWrangler([
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(this.port),
      "--inspector-port",
      "0",
      "--persist-to",
      persist,
      "--var",
      "ENABLE_DEBUG_INSPECTION:true",
    ]);
    const child = this.worker;
    child.once("exit", () => {
      if (this.worker === child) this.worker = null;
    });
    const deadline = Date.now() + 60000;

    while (Date.now() < deadline && this.worker) {
      if (
        await fetch(`${this.base}/ready`)
          .then((r) => r.ok)
          .catch(() => false)
      ) {
        await this.event("server.started", { port: this.port, persist });
        await this.pushGate();

        return;
      }

      await delay(200);
    }

    await this.stop();
    throw new Error("worker_start_timeout_see_worker_log");
  }
  async stop() {
    this.epoch++;
    this.stopping = true;
    await this.closeSockets();
    await this.pushGate();
    const child = this.worker;

    if (!child) {
      this.stopping = false;

      return;
    }

    if (process.platform === "win32") {
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );

      await once(killer, "exit");
    } else child.kill("SIGTERM");

    if (child.exitCode === null) await once(child, "exit");
    this.worker = null;
    this.stopping = false;
    await this.pushGate();
    await this.event("server.stopped", {});
  }
  gateOpen() {
    return (
      this.available && Boolean(this.worker) && !this.maintaining && !this.stopping
    );
  }
  blocked(device) {
    return !device.online || !this.gateOpen();
  }
  async closeSockets(device) {
    for (const d of device ? [device] : this.devices.values()) {
      if (d.kind === "inpage") continue;
      d.epoch++;

      for (const socket of d.sockets)
        await socket.close({ code: 1011, reason: "lab_network_changed" });
      d.sockets.clear();
    }
  }
  async addDevice(item, restoring = false) {
    const { id, kind = "browser", online = true, latencyMs = 0, screen = defaultScreen } = item;

    if (this.devices.has(id)) throw new Error("device_exists");

    if (kind === "inpage") return this.addInPageDevice(item, restoring);

    const context = await chromium.launchPersistentContext(
      path.join(this.data, "devices", id),
      {
        headless: true,
        viewport: screen,
        reducedMotion: "reduce",
        serviceWorkers: "block",
      },
    );

    const d = {
      id,
      kind: "browser",
      online,
      latencyMs,
      screen,
      context,
      epoch: 0,
      sockets: new Set(),
      page: null,
    };

    this.devices.set(id, d);
    await context.exposeFunction("splitnextLabEvent", (event) =>
      this.event("app", { device: id, ...JSON.parse(event) }),
    );
    await context.addInitScript(() => {
      window.splitnextLabEnabled = true;
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());

      if (!/^\/(identities|identity|groups|invites)(\/|$)/.test(url.pathname))
        return route.continue();
      const epoch = d.epoch;
      const serverEpoch = this.epoch;

      const request = {
        device: id,
        method: route.request().method(),
        path: url.pathname,
      };

      await this.event("request", request);

      try {
        if (d.latencyMs) await delay(d.latencyMs);

        if (this.blocked(d) || epoch !== d.epoch || serverEpoch !== this.epoch)
          return await route.abort("internetdisconnected");
        const fetching = route.fetch({ timeout: 10000 });
        this.requests.add(fetching);
        let response;

        try {
          response = await fetching;
        } finally {
          this.requests.delete(fetching);
        }

        await this.event("response.received", request);

        if (d.latencyMs) await delay(d.latencyMs);

        if (
          this.blocked(d) ||
          epoch !== d.epoch ||
          serverEpoch !== this.epoch
        ) {
          await this.event("response.lost", request);

          return await route.abort("internetdisconnected");
        }

        await this.event("response", { ...request, status: response.status() });
        await route.fulfill({ response });
      } catch (error) {
        await this.event("request.failed", {
          ...request,
          error: String(error),
        });
        await route.abort().catch(() => {});
      }
    });
    await context.routeWebSocket("**/*", (socket) => {
      if (this.blocked(d)) {
        void socket.close({ code: 1011, reason: "lab_unavailable" });

        return;
      }

      const upstream = socket.connectToServer();
      d.sockets.add(socket);
      upstream.onMessage(async (message) => {
        const epoch = d.epoch;

        if (d.latencyMs) await delay(d.latencyMs);

        if (!this.blocked(d) && epoch === d.epoch) {
          socket.send(message);
          await this.event("realtime.message", {
            device: id,
            data: String(message),
          });
        }
      });
      socket.onClose(() => {
        d.sockets.delete(socket);
        void upstream.close();
      });
      upstream.onClose(() => {
        d.sockets.delete(socket);
        void socket.close();
      });
    });
    d.page = context.pages()[0] ?? (await context.newPage());
    d.page.on("pageerror", (error) => {
      void this.event("page.error", { device: id, error: String(error) });
    });
    await d.page.goto(`${this.base}/app`);
    await this.waitForScreen(d.page);

    if (!online) await d.page.evaluate(() => window.splitnextLab?.online(false));
    await d.context.setOffline(!online);

    if (this.initialized) await this.save();
    await this.event("device.added", { device: id });

    return { device: id };
  }
  device(id) {
    const d = this.devices.get(id);

    if (!d) throw new Error("unknown_device");

    return d;
  }
  sendHost(host, event, data) {
    host.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  /** A page offers to show in-page devices; the first suitable one hosts them. */
  registerHost(res, headless) {
    const suitable =
      this.hostMode === "auto" ||
      (this.hostMode === "headless" ? headless : !headless);

    const replaces = Boolean(this.host && headless && this.host.headless);

    if (!suitable || (this.host && !replaces)) {
      res.write(`event: init\ndata: ${JSON.stringify({ role: "viewer" })}\n\n`);

      return;
    }

    if (replaces) this.host.res.end();
    const host = { res, headless, ready: false, seq: 0, pending: new Map() };
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);

    this.host = host;
    res.on("close", () => {
      clearInterval(ping);

      for (const call of host.pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error("host_disconnected"));
      }

      if (this.host === host) {
        this.host = null;
        void this.event("host.lost", { headless });
      }
    });
    this.sendHost(host, "init", {
      role: "host",
      headless,
      workerOrigin: this.base,
    });
  }
  async hostReady() {
    const host = this.host;

    if (!host) return;
    await this.event("host.registered", { headless: host.headless });

    try {
      await this.rawHostCall(host, { type: "sync", devices: this.deviceConfigs() });

      await this.rawHostCall(host, {
        type: "gate",
        open: this.gateOpen(),
        epoch: this.epoch,
      });
      // Usable only once it has this environment's devices and server gate.
      host.ready = true;
      await this.event("host.ready", { headless: host.headless });
    } catch (error) {
      await this.event("host.sync.failed", { error: String(error) });
    }
  }
  hostResult({ id, ok, value, error }) {
    const call = this.host?.pending.get(id);

    if (!call) return;
    this.host.pending.delete(id);
    clearTimeout(call.timer);

    if (ok) call.resolve(value);
    else call.reject(new Error(error));
  }
  async hostReport({ name, detail }) {
    await this.event(name, detail);
  }
  rawHostCall(host, command) {
    return new Promise((resolve, reject) => {
      const id = ++host.seq;

      const timer = setTimeout(() => {
        host.pending.delete(id);
        reject(new Error("host_timeout"));
      }, 30000);

      host.pending.set(id, { resolve, reject, timer });
      this.sendHost(host, "call", { id, command });
    });
  }
  async hostCall(command) {
    return this.rawHostCall(await this.ensureHost(), command);
  }
  hostDevice(device, command) {
    return this.hostCall({ type: "device", device, command });
  }
  async syncHost() {
    if (this.host?.ready)
      await this.rawHostCall(this.host, { type: "sync", devices: this.deviceConfigs() });
  }
  async pushGate() {
    if (!this.host?.ready) return;

    await this.rawHostCall(this.host, {
      type: "gate",
      open: this.gateOpen(),
      epoch: this.epoch,
    }).catch(() => {});
  }
  ensureHost() {
    if (this.host?.ready) return Promise.resolve(this.host);
    this.hosting ??= this.acquireHost().finally(() => {
      this.hosting = null;
    });

    return this.hosting;
  }
  async acquireHost() {
    if (!this.host && this.hostMode !== "tab") await this.startHeadlessHost();

    const deadline = Date.now() + (this.host ? 30000 : 10000);

    while (Date.now() < deadline) {
      if (this.host?.ready) {
        // Restored devices start with their host: let their screens come up.
        for (const d of this.devices.values())
          if (d.kind === "inpage") await this.waitForInPageScreen(d.id);

        return this.host;
      }

      await delay(50);
    }

    throw new Error(
      this.hostMode === "tab"
        ? `host_unavailable: open the lab page at ${this.labOrigin} to host in-page devices`
        : "host_unavailable: the in-page device host did not start",
    );
  }
  async startHeadlessHost() {
    if (this.headless) return;

    if (!this.labOrigin) throw new Error("host_unavailable: no lab page surface");

    const context = await chromium.launchPersistentContext(
      path.join(this.data, "host"),
      {
        headless: true,
        viewport: { width: 1700, height: 1000 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
      },
    );

    const page = context.pages()[0] ?? (await context.newPage());

    page.on("pageerror", (error) => {
      void this.event("page.error", { host: true, error: String(error) });
    });
    this.headless = { context, page };
    await page.goto(new URL("/?host=headless", this.labOrigin).href);
  }
  async stopHeadlessHost() {
    const headless = this.headless;

    if (!headless) return;
    this.headless = null;
    await headless.context.close();
  }
  async reloadHost() {
    const before = await this.ensureHost();

    this.sendHost(before, "reload", {});

    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
      if (this.host && this.host !== before && this.host.ready) break;
      await delay(50);
    }

    if (!this.host?.ready) throw new Error("host_reload_timeout");

    for (const d of this.devices.values())
      if (d.kind === "inpage") await this.waitForInPageScreen(d.id);
  }
  async screenshot(id) {
    const d = this.device(id);

    if (d.kind === "browser") return d.page.screenshot();

    if (!this.headless) throw new Error("screen_is_live_in_the_hosting_lab_page");

    return this.headless.page.locator(`[data-lab-device="${id}"]`).screenshot();
  }
  async inPageInput(id, input) {
    if (!this.headless) throw new Error("input_needs_headless_host: use the hosting lab page directly");

    const page = this.headless.page;
    const frame = page.locator(`[data-lab-device="${id}"]`);

    await frame.scrollIntoViewIfNeeded();
    const box = await frame.boundingBox();

    if (!box) throw new Error("device_not_visible");

    if (input.kind === "click")
      await page.mouse.click(box.x + (input.x ?? 0), box.y + (input.y ?? 0));

    if (input.kind === "type") await page.keyboard.insertText(input.text ?? "");

    if (input.kind === "key") await page.keyboard.press(input.text ?? "Enter");

    if (input.kind === "wheel") {
      await page.mouse.move(box.x + (input.pointerX ?? 195), box.y + (input.pointerY ?? 390));
      await page.mouse.wheel(input.x ?? 0, input.y ?? 0);
    }
  }
  browserDevice(id) {
    const d = this.device(id);

    if (d.kind !== "browser") throw new Error("browser_device_required");

    return d;
  }
  async addInPageDevice(
    { id, online = true, latencyMs = 0, generation, clipboard = true, share = true, screen = defaultScreen },
    restoring,
  ) {
    const d = {
      id,
      kind: "inpage",
      online,
      latencyMs,
      generation: generation ?? randomUUID().slice(0, 8),
      clipboard,
      share,
      screen,
    };

    this.devices.set(id, d);

    // A restored device waits for a host to appear; a new one needs it now.
    if (!restoring) {
      try {
        await this.syncHost();
        await this.waitForInPageScreen(id);
      } catch (error) {
        this.devices.delete(id);
        await this.syncHost().catch(() => {});
        throw error;
      }

      await this.save();
      await this.event("device.added", { device: id, kind: "inpage" });
    }

    return { device: id, kind: "inpage" };
  }
  /**
   * Closes a device and deletes what it persisted. A browser device's profile
   * goes with it. An in-page device's data is deleted by its host; without a
   * connected host it stays behind in that profile under a namespace no new
   * device reuses.
   */
  async removeDevice(id) {
    const d = this.device(id);
    let storage = "deleted";

    if (d.kind === "browser") {
      await this.closeSockets(d);
      await d.page.goto("about:blank").catch(() => {});
      await d.context.close();
      this.devices.delete(id);
      await rm(path.join(this.data, "devices", id), { recursive: true, force: true });
    } else {
      if (this.host?.ready) await this.rawHostCall(this.host, { type: "device", device: id, command: { method: "remove" } });
      else storage = "left_in_host_profile";
      this.devices.delete(id);
      await this.syncHost().catch(() => {});
    }

    await this.save();
    await this.event("device.removed", { device: id, kind: d.kind, storage });

    return { device: id, removed: true, storage };
  }
  deviceConfigs() {
    const environment = path.basename(this.root);

    return this.devices
      .values()
      .filter((d) => d.kind === "inpage")
      .map((d) => ({
        id: d.id,
        namespace: `${environment}-${d.id}-${d.generation}`,
        online: d.online,
        latencyMs: d.latencyMs,
        clipboard: d.clipboard,
        share: d.share,
        screen: d.screen,
      }))
      .toArray();
  }
  async waitForInPageScreen(id) {
    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
      if ((await this.hostDevice(id, { method: "ready" })).ready) return;
      await delay(100);
    }

    throw new Error("device_screen_timeout");
  }
  async waitForScreen(page) {
    await page.waitForFunction(() => window.splitnextLab || [...document.querySelectorAll('button,[role="button"]')].some((button) => button.textContent.trim() === 'Try again'));
  }
  async inspectDevice(id) {
    const d = this.device(id);

    if (d.kind === "inpage") {
      const app = await this.hostDevice(id, { method: "inspect" });

      return { ...app, online: d.online, latencyMs: d.latencyMs, screen: d.screen };
    }

    const app = await d.page.evaluate(() => window.splitnextLab?.inspect() ?? {
      state: null, actions: [], inputOptions: {}, diagnostics: null,
      startup: { reason: 'app_not_ready', screen: document.body.innerText },
    });

    const storage = await d.context.storageState({ indexedDB: true });

    return {
      device: id,
      kind: "browser",
      online: d.online,
      latencyMs: d.latencyMs,
      screen: d.screen,
      ...app,
      storage,
    };
  }
  async inspectServer() {
    if (!this.worker) return { running: false };

    const get = (endpoint) =>
      fetch(this.base + endpoint, { signal: AbortSignal.timeout(5000) }).then(
        (r) => {
          if (!r.ok) throw new Error(`inspection_http_${r.status}`);

          return r.json();
        },
      );

    const list = await get("/debug/groups");

    return {
      running: true,
      available: this.available,
      identities: await get("/debug/identity-directory"),
      groups: await Promise.all(
        list.groups.map((g) => get(`/debug/groups/${g.group_id}`)),
      ),
    };
  }
  async maintenance(run) {
    const running = Boolean(this.worker);
    this.maintaining = true;
    await this.pushGate();
    await Promise.allSettled(this.requests);
    await this.stop();

    try {
      return await run();
    } finally {
      this.maintaining = false;

      if (running) await this.start();
      else await this.pushGate();
    }
  }
  async closeDevices() {
    if (this.initialized) await this.save();

    for (const d of this.devices.values()) {
      if (d.kind !== "browser") continue;
      await d.page.goto("about:blank");
      await d.context.close();
    }

    this.devices.clear();
    // The headless host's profile holds its devices' data and must be closed to copy.
    await this.stopHeadlessHost();
    // A hosting lab page drops the devices it no longer has.
    await this.syncHost().catch(() => {});
  }
  async reopenDevices() {
    for (const d of (await this.manifest()).devices ?? [])
      await this.addDevice(d, true);

    await this.syncHost().catch(() => {});
  }
  async checkpoint(name, restore = false) {
    const snapshot = path.join(this.root, "checkpoints", name);
    const running = Boolean(this.worker);

    if (restore) await readFile(path.join(snapshot, "manifest.json"));

    // A lab page keeps its in-page devices' data in its own browser profile,
    // which a checkpoint cannot copy.
    if (
      this.host &&
      !this.host.headless &&
      [...this.devices.values()].some((d) => d.kind === "inpage")
    )
      throw new Error("checkpoint_needs_headless_host");

    return this.maintenance(async () => {
      await this.closeDevices();

      try {
        if (restore) {
          await rm(this.data, { recursive: true, force: true });
          await cp(snapshot, this.data, { recursive: true });
          this.available = (await this.manifest()).available ?? true;
        } else {
          await mkdir(path.dirname(snapshot), { recursive: true });

          if ((await readdir(path.dirname(snapshot))).includes(name))
            throw new Error("checkpoint_exists");
          await cp(this.data, snapshot, { recursive: true });
        }
      } finally {
        // The Worker must be started before app screens reopen.
        this.maintaining = false;
        await this.start();
        await this.reopenDevices();

        if (!running) await this.stop();
      }

      return { name };
    });
  }
  async wait(input) {
    const end = Date.now() + input.timeoutMs;
    const cancel = new AbortController();
    let last = [];
    let server = null;

    const poll = async () => {
      while (!cancel.signal.aborted && Date.now() < end) {
        last = await Promise.all(
          input.devices.map((id) => this.inspectDevice(id)),
        );

        if (cancel.signal.aborted) return;

        const empty = last.every((d) =>
          d.state?.ready && d.state.groups.every((g) => g.pending_commands === 0),
        );

        if (input.until === "outbox" && empty) return { matched: true };

        if (
          input.until === "recovery" &&
          empty &&
          last.every(
            (d) => d.state.online && d.state.reachable && !d.state.syncError,
          )
        )
          return { matched: true };

        if (
          input.until === "convergence" &&
          empty &&
          last.every((d) => d.state.group?.confirmed_snapshot)
        ) {
          server = await this.inspectServer();
          const group = last[0].state.group;

          const authority = server.groups?.find(
            (g) => g.snapshot.group.id === group.group_id,
          );

          if (
            authority &&
            last.every(
              (d) =>
                d.state.group.group_id === group.group_id &&
                d.state.group.revision === authority.revision &&
                JSON.stringify(d.state.group.confirmed_snapshot) ===
                  JSON.stringify(authority.snapshot),
            )
          )
            return { matched: true, revision: authority.revision };
        }

        await delay(Math.min(100, Math.max(1, end - Date.now())), undefined, {
          signal: cancel.signal,
        });
      }

      throw new Error("wait_timeout");
    };

    try {
      return await Promise.race([
        poll(),
        delay(input.timeoutMs, undefined, { signal: cancel.signal }).then(
          () => {
            throw new Error("wait_timeout");
          },
        ),
      ]);
    } catch (error) {
      if (error.message !== "wait_timeout") throw error;

      const diagnostics = {
        error: "wait_timeout",
        input,
        devices: last,
        server,
        status: await this.perform("status", {}),
      };

      await this.event("wait.timeout", diagnostics);
      throw Object.assign(new Error("wait_timeout"), { diagnostics });
    } finally {
      cancel.abort();
    }
  }
  execute(operation, raw = {}) {
    const concurrent = [
      "deviceNetwork",
      "serverNetwork",
      "status",
      "discover",
      "inspectDevice",
      "inspectServer",
      "timeline",
      "wait",
    ].includes(operation);

    const task = (concurrent ? Promise.resolve() : this.tail).then(async () => {
      if (
        this.maintaining &&
        ["deviceNetwork", "serverNetwork"].includes(operation)
      )
        throw new Error("maintenance_in_progress");
      const schema = operations[operation];

      if (!schema) throw new Error("unknown_operation");
      const input = schema.parse(raw);

      if (
        ![
          "status",
          "discover",
          "inspectDevice",
          "inspectServer",
          "export",
        ].includes(operation)
      )
        await appendFile(
          path.join(this.root, "steps.jsonl"),
          JSON.stringify({ operation, input }) + "\n",
        );
      await this.event("operation", { operation, input });

      try {
        const result = await this.perform(operation, input);
        await this.event("operation.done", { operation });

        return result;
      } catch (error) {
        await this.event("operation.failed", {
          operation,
          error: String(error),
        });
        throw error;
      }
    });

    if (!concurrent) this.tail = task.catch(() => {});

    return task;
  }
  async perform(operation, input) {
    switch (operation) {
      case "shutdown":
        return { closing: true };
      case "timeline":
        return this.lines("timeline");
      case "discover":
        return {
          operations: discovery(),
          appActions: "inspectDevice.actions",
          stores: "inspectStores",
          isolation: this.root,
        };
      case "status":
        return {
          initialized: this.initialized,
          root: this.root,
          workerPort: this.port,
          running: Boolean(this.worker),
          available: this.available,
          devices: [...this.devices.keys()],
          deviceKinds: Object.fromEntries(
            [...this.devices.values()].map((d) => [d.id, d.kind]),
          ),
          host: {
            mode: this.hostMode,
            connected: Boolean(this.host?.ready),
            headless: Boolean(this.host?.headless),
          },
          sequence: this.sequence,
        };
      case "addDevice":
        return this.addDevice({ id: input.device, kind: input.kind });
      case "removeDevice":
        return this.removeDevice(input.device);
      case "inspectDevice":
        return this.inspectDevice(input.device);
      case "reloadDevice": {
        const d = this.device(input.device);

        if (d.kind === "inpage") {
          await this.hostDevice(d.id, { method: "reload" });
          await this.waitForInPageScreen(d.id);

          return { reloaded: true };
        }

        await d.context.setOffline(false);
        await d.page.reload();
        await this.waitForScreen(d.page);
        await d.page.evaluate(
          (online) => window.splitnextLab?.online(online),
          d.online,
        );

        await d.context.setOffline(!d.online);

        return { reloaded: true };
      }

      case "deviceNetwork": {
        const d = this.device(input.device);
        d.online = input.online;
        d.latencyMs = input.latencyMs ?? d.latencyMs;

        if (d.kind === "inpage") {
          await this.hostDevice(d.id, {
            method: "network",
            online: d.online,
            latencyMs: d.latencyMs,
          });
          await this.save();

          return { online: d.online, latencyMs: d.latencyMs };
        }

        await this.closeSockets(d);
        await d.context.setOffline(!d.online);
        await d.page.evaluate(
          (online) => window.splitnextLab?.online(online),
          d.online,
        );
        await this.save();

        return { online: d.online, latencyMs: d.latencyMs };
      }

      case "deviceScreen": {
        const d = this.device(input.device);
        const screen = { width: input.width, height: input.height };

        if (d.kind === "inpage") await this.hostDevice(d.id, { method: "resize", ...screen });
        else await d.page.setViewportSize(screen);
        d.screen = screen;
        await this.save();

        return { screen };
      }

      case "deviceForeground": {
        const d = this.device(input.device);

        if (d.kind === "inpage")
          return this.hostDevice(d.id, { method: "foreground" });

        await d.page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        );

        return { foreground: true };
      }

      case "deviceNavigate": {
        const d = this.device(input.device);

        if (d.kind === "inpage")
          return this.hostDevice(d.id, {
            method: "navigate",
            direction: input.direction,
          });

        await d.page.evaluate(
          (direction) =>
            direction === "back" ? history.back() : history.forward(),
          input.direction,
        );

        return { moved: true };
      }

      case "deviceCapabilities": {
        const d = this.device(input.device);

        if (d.kind !== "inpage") throw new Error("in_page_device_required");
        const { device: _device, ...change } = input;
        const result = await this.hostDevice(d.id, { method: "capabilities", ...change });

        d.clipboard = input.clipboard ?? d.clipboard;
        d.share = input.share ?? d.share;
        await this.save();

        if (input.clipboard !== undefined || input.share !== undefined)
          await this.waitForInPageScreen(d.id);

        return result;
      }

      case "reloadHost":
        await this.reloadHost();

        return { reloaded: true };
      case "serverNetwork":
        this.available = input.available;
        await this.save();
        this.epoch++;
        await this.closeSockets();
        await this.pushGate();

        return { available: this.available };
      case "serverProcess":
        if (input.running) await this.start();
        else await this.stop();

        return { running: Boolean(this.worker) };
      case "action":
        if (this.device(input.device).kind === "inpage") {
          await this.waitForInPageScreen(input.device);

          return this.hostDevice(input.device, {
            method: "action",
            name: input.name,
            input: input.input,
            confirmed: input.confirmed,
          });
        }

        return this.device(input.device).page.evaluate(
          ({ name, input, confirmed }) =>
            window.splitnextLab?.dispatch(name, input, confirmed) ?? { status: 'failed', error: 'app_not_ready', issues: ['This installation needs to finish startup before app actions are available.'] },
          input,
        );
      case "input": {
        if (this.device(input.device).kind === "inpage") {
          await this.inPageInput(input.device, input);

          return { sent: true };
        }

        const page = this.device(input.device).page;

        if (input.kind === "click")
          await page.mouse.click(input.x ?? 0, input.y ?? 0);

        if (input.kind === "type")
          await page.keyboard.insertText(input.text ?? "");

        if (input.kind === "key")
          await page.keyboard.press(input.text ?? "Enter");

        if (input.kind === "wheel") {
          await page.mouse.move(input.pointerX ?? 195, input.pointerY ?? 390);
          await page.mouse.wheel(input.x ?? 0, input.y ?? 0);
        }

        return { sent: true };
      }

      case "inspectServer":
        return this.inspectServer();
      case "inspectStores":
        return this.maintenance(() => stores(path.join(this.data, "server")));
      case "replaceRows":
        return this.maintenance(() =>
          stores(path.join(this.data, "server"), input),
        );
      case "checkpoint":
        return this.checkpoint(input.name);
      case "restore":
        return this.checkpoint(input.name, true);
      case "freshStart":
        return this.maintenance(async () => {
          await this.closeDevices();
          await rm(this.data, { recursive: true, force: true });
          await mkdir(this.data);
          await this.save();

          return { reset: true };
        });
      case "wait":
        return this.wait(input);
      case "export":
        return {
          status: await this.perform("status", {}),
          steps: await this.lines("steps"),
          timeline: await this.lines("timeline"),
          devices: await Promise.all(
            [...this.devices.keys()].map((id) => this.inspectDevice(id)),
          ),
          server: await this.inspectServer(),
        };
      case "replay": {
        const results = [];

        for (const step of input.steps) {
          if (
            ["replay", "export"].includes(step.operation) ||
            !operations[step.operation]
          )
            throw new Error("invalid_replay_operation");
          results.push(
            await this.perform(
              step.operation,
              operations[step.operation].parse(step.input),
            ),
          );
        }

        return results;
      }

      default:
        throw new Error("unknown_operation");
    }
  }
  async lines(name) {
    return (
      await readFile(path.join(this.root, `${name}.jsonl`), "utf8").catch(
        () => "",
      )
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  }
  async close() {
    await this.closeDevices();
    await this.stop();
  }
}
