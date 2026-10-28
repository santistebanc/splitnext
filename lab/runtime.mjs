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
import { operations, discovery } from "./operations.mjs";
import { stores } from "./stores.mjs";

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
  constructor(root, port) {
    this.root = root;
    this.port = port;
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

    for (const item of manifest.devices ?? []) await this.addDevice(item);
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
          ({ id, online, latencyMs }) => ({ id, online, latencyMs }),
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

        return;
      }

      await delay(200);
    }

    await this.stop();
    throw new Error("worker_start_timeout_see_worker_log");
  }
  async stop() {
    this.epoch++;
    await this.closeSockets();
    const child = this.worker;

    if (!child) return;

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
    await this.event("server.stopped", {});
  }
  blocked(device) {
    return (
      !device.online || !this.available || !this.worker || this.maintaining
    );
  }
  async closeSockets(device) {
    for (const d of device ? [device] : this.devices.values()) {
      d.epoch++;

      for (const socket of d.sockets)
        await socket.close({ code: 1011, reason: "lab_network_changed" });
      d.sockets.clear();
    }
  }
  async addDevice({ id, online = true, latencyMs = 0 }) {
    if (this.devices.has(id)) throw new Error("device_exists");

    const context = await chromium.launchPersistentContext(
      path.join(this.data, "devices", id),
      {
        headless: true,
        viewport: { width: 390, height: 780 },
        reducedMotion: "reduce",
        serviceWorkers: "block",
      },
    );

    const d = {
      id,
      online,
      latencyMs,
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
    await d.page.waitForFunction(() => window.splitnextLab);

    if (!online) await d.page.evaluate(() => window.splitnextLab.online(false));
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
  async inspectDevice(id) {
    const d = this.device(id);
    const app = await d.page.evaluate(() => window.splitnextLab.inspect());
    const storage = await d.context.storageState({ indexedDB: true });

    return {
      device: id,
      online: d.online,
      latencyMs: d.latencyMs,
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
    await Promise.allSettled(this.requests);
    await this.stop();

    try {
      return await run();
    } finally {
      this.maintaining = false;

      if (running) await this.start();
    }
  }
  async closeDevices() {
    if (this.initialized) await this.save();

    for (const d of this.devices.values()) {
      await d.page.goto("about:blank");
      await d.context.close();
    }

    this.devices.clear();
  }
  async reopenDevices() {
    for (const d of (await this.manifest()).devices ?? [])
      await this.addDevice(d);
  }
  async checkpoint(name, restore = false) {
    const snapshot = path.join(this.root, "checkpoints", name);
    const running = Boolean(this.worker);

    if (restore) await readFile(path.join(snapshot, "manifest.json"));

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
          d.state.groups.every((g) => g.pending_commands === 0),
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
          sequence: this.sequence,
        };
      case "addDevice":
        return this.addDevice({ id: input.device });
      case "inspectDevice":
        return this.inspectDevice(input.device);
      case "reloadDevice": {
        const d = this.device(input.device);
        await d.context.setOffline(false);
        await d.page.reload();
        await d.page.waitForFunction(() => window.splitnextLab);
        await d.page.evaluate(
          (online) => window.splitnextLab.online(online),
          d.online,
        );

        await d.context.setOffline(!d.online);

        return { reloaded: true };
      }

      case "deviceNetwork": {
        const d = this.device(input.device);
        d.online = input.online;
        d.latencyMs = input.latencyMs ?? d.latencyMs;
        await this.closeSockets(d);
        await d.context.setOffline(!d.online);
        await d.page.evaluate(
          (online) => window.splitnextLab.online(online),
          d.online,
        );
        await this.save();

        return { online: d.online, latencyMs: d.latencyMs };
      }

      case "serverNetwork":
        this.available = input.available;
        await this.save();
        this.epoch++;
        await this.closeSockets();

        return { available: this.available };
      case "serverProcess":
        if (input.running) await this.start();
        else await this.stop();

        return { running: Boolean(this.worker) };
      case "action":
        return this.device(input.device).page.evaluate(
          ({ name, input, confirmed }) =>
            window.splitnextLab.dispatch(name, input, confirmed),
          input,
        );
      case "input": {
        const page = this.device(input.device).page;

        if (input.kind === "click")
          await page.mouse.click(input.x ?? 0, input.y ?? 0);

        if (input.kind === "type")
          await page.keyboard.insertText(input.text ?? "");

        if (input.kind === "key")
          await page.keyboard.press(input.text ?? "Enter");

        if (input.kind === "wheel")
          await page.mouse.wheel(input.x ?? 0, input.y ?? 0);

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
