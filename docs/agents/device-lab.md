# Device testing lab

Use the lab freely for local experiments, bug reproduction and multi-device
verification. Its stores are disposable and isolated from normal development.
Start from the repository checkout that owns the experiment, after `npm ci`,
`npx playwright install chromium` (if needed), and `npm run frontend:build`:

```sh
npm run lab -- --env=my-experiment --port=8806 --workerPort=8807
```

Add `--host=auto|headless|tab` to choose where in-page devices render (see
below). Both ports must be free. Startup refuses occupied ports, reserved development/test
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

## Page layout

The dark lab page fills the window like an IDE: the page never scrolls, only
panels do. It is a tree of sections divided by separators; each section shows its
panels as tabs. The panels are Server, Timeline, Server state, Operations and one
per device. Drag a separator to resize (arrow keys on a focused separator, Shift
for larger steps; double-click shares the room evenly). Drag a tab onto another
section's tabs or body to join it, or near a section's edge to split that section
there; a highlight shows where it lands and Escape cancels. On a focused tab,
Left/Right switch tabs, Alt+Left/Right reorder them and Alt+Shift+Left/Right move
the panel to the previous or next section. Empty sections close. New devices open
beside the other devices. Reset layout restores the default.

Each device panel works like Chrome's responsive device mode with DevTools docked
to the side. A thin bar across the whole panel holds the device's own controls: an
Online/Offline toggle (click to flip), Reload, and the Inspector toggle. The screen
section has a device toolbar (Dimensions, width × height, Zoom, Rotate). Beside it
is an inspector that
motion-panels resizes and collapses (Enter on its separator, or the Inspector
button); the screen section narrows down to a minimum width first, then the
inspector does. Both always fill the panel, which never scrolls as a whole: the
screen's viewport and the inspector each scroll on their own. A device's tab shows a × on hover (or Delete on the focused tab)
that removes the device after confirming. Hidden tabs and collapsed content stay
mounted.

The inspector (`lab/inspector.mjs`) has three tabs, all fed by `inspectDevice`:
Overview summarises status, the open group (members, outbox, notices, latest
expenses), groups, filled drafts, recent activity and network events. Actions
lists the app actions by group with a search and a Show unavailable toggle (an
unavailable action says why); opening one shows a form built from its input
schema, where `choices` become dropdowns from `inputOptions`, lists and objects
are typed as JSON, and Run reports the outcome inline. Data is a collapsible tree
of the whole inspection with a key and value filter and Copy JSON. Open forms,
typed values and expanded nodes survive the periodic refresh.

Each device has a screen size and the page draws it at a zoom. The size is the
device's own viewport (default 390 × 780): set it with `deviceScreen` (`width`
240–1600, `height` 320–1600), pick a Dimensions preset, type it, rotate it, or drag
the handles on the screen's right edge, bottom edge or corner (arrow keys on a
focused handle; Shift takes larger steps). The screen is centred, so dragging the
right edge changes the width by twice the pointer's movement, as in Chrome. The size
is saved with the device and applied to both kinds. Zoom only changes how large the
page draws a screen and is saved in this browser. Fit to window (default) draws the
whole screen in its section at up to 100% and follows the section's size. The Full
panel dimension sizes the screen to the view beside the inspector, edge to edge with no
margin, border or handles (at 100% under
Fit, or to fill it at a chosen zoom) and keeps following it, for example when the
inspector collapses; it is saved in this browser and any other resize leaves it. A
headless host always draws at 100%, so its screenshots and clicks use screen pixels.

Moving a panel retains the live screen and its drafts. The layout, inspector
sizes and zooms are saved in this browser's localStorage, separate from the lab
environment and its checkpoints. The headless host page shows only devices, each
whole, for the supervisor to screenshot and click.

The supervisor bundles the plain DOM entry in `lab/ui.mjs`, its motion-panels
core adapter in `lab/panels.mjs` and `lab/inspector.mjs` with esbuild on the first `/ui.js` request,
then caches it and rebuilds when any bundled lab source file changes, so edits to
`lab/ui.html` and these modules show on reload without a restart. No package
directories are served; app assets retain their existing loading paths. There is no separate lab build command.

## Device kinds: pick one per question

`addDevice` takes a unique device name and a `kind`. The default is `browser`.
`removeDevice` closes a device and deletes its data, so re-adding the name starts a
new installation. An in-page device's data is deleted by its connected host;
without one, the result reports `storage: "left_in_host_profile"` and the data stays
under a namespace no new device reuses.

| | `inpage` | `browser` |
| --- | --- | --- |
| What it is | The ordinary app screen, controller and dispatcher, mounted in a box inside one shared lab document. Many devices cost one browser, not one each. | A real persistent headless Chromium profile loading `/app` from the Worker. |
| Use it for | Sync, convergence, offline/online, outage and lost-response experiments; many devices; watching several screens live in the lab page; fast agent loops. | Anything about the browser itself: real service worker, URL and history, native scrolling and focus, `navigator` capabilities, IndexedDB eviction or corruption, startup of the real bundle. |
| Persistence | A per-device namespaced IndexedDB database and `localStorage` keys in the host browser's profile. Survives reloads of the screen and of the host page. | Its own profile directory, copied by checkpoints. |
| Network | A virtual adapter for fetch and realtime sockets in front of the same real Worker. Offline informs the app; latency, server gate and dropped in-flight responses match browser devices. | Playwright routing and `setOffline`. |
| Not simulated | Soft keyboard and `visualViewport`, a separate pointer type, reduced motion and viewport per device, multi-window effects, service worker, real URL/history (navigation is in memory), browser clipboard and share (replaced by inspectable fakes). | Nothing beyond headless Chromium. |
| Cost | One shared browser for any number of devices. | One Chromium context per device. |

A bug that reproduces on an `inpage` device is a bug in the shared app. A bug that
needs the browser to reproduce, or that must be shown on a real browser before it is
fixed, belongs to a `browser` device. When unsure, reproduce on `inpage` first and
confirm on `browser`. The two kinds can share one environment and one Worker.

### Hosting in-page devices

In-page devices need a page to render in. The supervisor serves the lab page at
its own URL, and the first page that offers itself becomes the host:

- `--host=auto` (default): a lab page you open hosts if it is first. Otherwise the
  supervisor starts its own headless Chromium on the same page the first time a
  device needs it. No human tab is required, so agents and CI can use in-page
  devices from the CLI. Mirrors of the host's screens appear in any other lab page.
- `--host=headless`: always host headlessly; the open lab page is only a viewer.
  Data lives in the environment's `host` profile, so checkpoints and `restore` cover
  it. Use this for reproducible agent runs.
- `--host=tab`: never start a headless host. In-page operations fail with
  `host_unavailable` until a lab page is open. The devices render live in that
  tab and you click and type in them directly. Its data lives in your browser's
  profile, not in the environment, so `checkpoint` and `restore` refuse
  (`checkpoint_needs_headless_host`), `input` needs the tab itself, and reloading
  the tab keeps each device's data but moving to another browser does not.

Only one page hosts at a time. A second page is a viewer; reload it after the host
goes away to take over. `reloadHost` reloads the host page, as a person would, and
waits for every device to come back from what it persisted. The frontend's kind
picker chooses the kind for **Add device**; CLI callers pass `"kind":"inpage"`.
A lab page that is not the host mirrors an in-page device's screenshot the same as
a browser device, through the supervisor's headless host.

## Devices and experiments

`inspectDevice` returns the actual screen's
controller state, UI drafts, all app action schemas, availability reasons, resolved
input choices, diagnostics and durable storage: browser storage including IndexedDB
for `browser` devices; for `inpage` devices the namespace, its `localStorage` keys,
its IndexedDB document, in-memory navigation entries and the fake platform's record
of copied text, shares, replica notifications and homepage opens.
`action` invokes the screen's dispatcher with `device`, `name`, `input` and optional
`confirmed`. Confirmations retain the app's ordinary rules. `input` sends clicks,
text, keys and wheel events to that same page. The frontend displays its screenshot
and forwards input for browser devices (a 1.5-second mirror); an in-page device in
the hosting page is the live screen itself and takes real input. The mirror is not
a native browser accessibility tree or a touch/IME emulator.

`deviceForeground` signals that a device returned to the foreground, so the app
refreshes. `deviceNavigate` goes `back` or `forward` through the device's history
entries. `deviceCapabilities` (in-page only) sets the fake clipboard text a Paste
reads and turns copy/share support on or off; changing support restarts the screen
with the same persisted data. Timeline records of an in-page device's state and
draft changes are coalesced to the latest one per quarter second.

A new installation needs the server to establish its identity. If it starts
during an outage, inspection reports the actual startup error screen and
`app_not_ready`, with no controller/actions yet. Once the server returns, use
`reloadDevice` or the screen's Try again button to complete ordinary app startup.

`deviceNetwork` informs the app of offline/online status and gates traffic
(for in-page devices the app's lifecycle adapter reports it, as the browser does).
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

MCP, native builds, arbitrary SQL, deterministic in-memory simulation, an
in-browser server emulation, iframe-per-device isolation, packet
reordering and production/remote store control are deferred. Use the CLI/API for
experimentation and `e2e/app.spec.ts` for real browser regression coverage. A bug
found in the lab should retain its steps/diagnostics and gain a focused regression
test before the fix is considered complete.
