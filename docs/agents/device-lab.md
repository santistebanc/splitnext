# Device testing lab

Use the lab freely for local experiments, bug reproduction and multi-device
verification. Its stores are disposable and isolated from normal development.
Start from the repository checkout that owns the experiment, after `npm ci`,
`npx playwright install chromium` (if needed), and `npm run frontend:build`:

```sh
npm run lab -- --env=my-experiment --port=8806 --workerPort=8807
```

Both ports must be free. Startup refuses occupied ports, reserved development/test
ports, another supervisor for the environment, and an environment's changed Worker
port. The supervisor binds only to `127.0.0.1`. Keep it running while using its
frontend at the printed URL or the CLI. Ctrl+C closes owned browsers and the
Worker. A crashed supervisor leaves a lock containing its PID: verify that process
and its Worker are gone before removing that environment's lock. Never terminate
an unidentified listener. Choose another environment and pair of ports instead.

Set `LAB_URL=http://127.0.0.1:8806` for a nondefault supervisor port. Discover the
live operation schemas with `node lab/cli.mjs discover`; inspect startup and devices
with `node lab/cli.mjs status`. Pass JSON as the second argument, or `@file.json`
to avoid shell quoting differences. The frontend calls exactly the same API:
`POST /api` with `Content-Type: application/json` and `{operation,input}`.

## Devices and experiments

`addDevice` takes a unique device name. `inspectDevice` returns the actual screen's
controller state, UI drafts, all app action schemas, availability reasons, resolved
input choices, diagnostics and durable browser storage including IndexedDB.
`action` invokes the screen's dispatcher with `device`, `name`, `input` and optional
`confirmed`. Confirmations retain the app's ordinary rules. `input` sends clicks,
text, keys and wheel events to that same page. The frontend displays its screenshot
and forwards input; these are real app screens, with a 1.5-second mirror refresh.
The mirror is not a native browser accessibility tree or a touch/IME emulator.

`deviceNetwork` informs the app of offline/online status and gates traffic.
`serverNetwork` gates traffic while devices remain online. `serverProcess`
actually stops/restarts the owned Worker. All three close existing realtime
connections; pending HTTP responses are discarded across a gate change. A lost
response can follow committed server work: synchronization retries safely.
`latencyMs` on a device delays traffic. `reloadDevice` retains its profile and
offline setting. Ordinary app drafts follow ordinary app reload behavior; durable
replicas, credentials, preferences and outboxes survive.

`wait` takes `devices`, `until` (`convergence`, `outbox`, `recovery`) and an explicit
`timeoutMs` (default 15000, maximum 120000). Convergence compares each selected
device's open group and revision to the authoritative server snapshot, with empty
outboxes. Recovery requires online, reachable devices with no sync error and empty
outboxes. A timeout returns device/server diagnostics and records them in the
timeline. Inspectors and connectivity controls remain usable during a wait.

`timeline` reads ordered operation, request, realtime, action and state records.
`export` preserves steps and diagnostics; the frontend can download them.
`replay` executes supplied `{operation,input}` steps in order on the current
environment. Use a named starting checkpoint for steps containing concrete group
or member IDs. Replay does not rewrite IDs or make nondeterministic timing
deterministic. Keep failed experiment directories when reporting bugs.

## Server stores and consistency

`inspectServer` reads authoritative groups (including command/join outcomes and
Activity) and the identity directory. It remains available through a simulated
server outage but reports stopped when the process is stopped.

`inspectStores` stops the Worker, reads isolated D1 and DO SQLite tables and rows,
then restores the prior process state. `replaceRows` replaces one table's rows
transactionally: use its discovered `store`, `table` and `rows` to edit, seed or
clear that table. Table/column names must exist. Blob values use `{blob:base64}`.
These are direct storage edits and can violate domain invariants or leave D1's
derived index inconsistent; every operation is logged. No arbitrary SQL or remote
path/target is accepted. Take a checkpoint before exploratory edits.

`checkpoint` names a coordinated copy of all server stores, browser profiles and
the device manifest. The Worker is stopped and profiles closed before copying.
`restore` replaces the current environment from that checkpoint. `freshStart`
explicitly resets all current server and device data. Timeline, steps, Worker logs
and named checkpoints survive these operations. Snapshots contain test credentials
and invite links: keep their files local. Data lives under `.wrangler/lab/ENV`.

## Boundaries

MCP, native builds, arbitrary SQL, deterministic in-memory simulation, packet
reordering and production/remote store control are deferred. Use the CLI/API for
experimentation and `e2e/app.spec.ts` for real browser regression coverage. A bug
found in the lab should retain its steps/diagnostics and gain a focused regression
test before the fix is considered complete.
