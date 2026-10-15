# Splitnext MVP

Splitnext is an offline-first group ledger foundation built on Cloudflare
Workers, D1, and one SQLite Durable Object per group. The current MVP handles
groups, invite links, and ledger members with offline synchronization and
realtime revision announcements; expenses are intentionally deferred.

## What works

- Anonymous per-installation identities and device credentials backed by D1;
  there is no sign-in or account linking.
- Retry-safe group creation with a client-generated group id and an immediately
  usable invite, created atomically by the API.
- Joining through a reusable invite link with a preview of the group, then
  choosing an existing member or joining as someone new.
- Exactly one current invite link per group with no time limit and
  regeneration. Every participant can share the same current link.
  Regeneration invalidates the previous link.
- Offline-capable group rename and member add, rename, and archive commands.
- Nonexclusive preferred-member selection (the member the UI calls “you”).
- Leaving and rejoining a group without revoking its permanent access grant.
- A per-identity list of accessible groups, marking the ones it left, backed
  by a derived D1 index and cached by the SDK for offline use. The server index
  can restore the list when an installation still has its device credential
  but has lost its local group cache.
- Ordered, idempotent outboxes and full revisioned server snapshots.
- Rejected or superseded command notices stored by the client.
- Realtime revision announcements over hibernatable WebSockets, with automatic
  background synchronization, reconnection, and catch-up in the SDK.
- A stateful TypeScript client SDK with swappable local storage adapters.
- A server group engine with Durable Object and in-memory repository adapters.
- A `/components` workbench, enabled with debug inspection, for searching the
  app's reusable components and previewing them under editable props and state.
- A responsive Expo web app at `/app`, with a public homepage and invite entry
  pages rendered by the same Cloudflare Worker. It includes single-screen group
  creation, member management, invitation sharing, joining and rejoining,
  group switching, and offline command/conflict feedback.
- The invitation sheet shows an inline copy icon, native sharing when
  supported, and New link to regenerate the invitation after confirming that
  the current link will stop working.
- The groups list has a Your groups heading, or Start a group with a one-line
  prompt when there are none. Group settings open from a Settings button, and
  leaving asks for confirmation with a Cancel option. Offline captions name
  the blocked action. When joining or rejoining, names already used by a
  current participant are marked In use.
- Group rows show the member count and who you are, left groups appear as rows
  with Rejoin, and a placeholder list shows while local storage opens. Share
  invite becomes secondary once someone else has joined. Errors appear beside
  the row or button that caused them; background sync errors join the status
  banner. Sheets close with Escape and keep keyboard focus inside them, then
  return it to the control that opened them without taking it from anything
  focused while they fade out; every control has a visible keyboard focus
  outline. On the web, sheets render in their own layer
  (`ui/SheetOverlay.web.tsx`) instead of React Native Web's Modal.
- A compact Members list supports adding and editing inline, saving on blur
  without shifting the row or needing confirm/cancel controls. It has no member
  avatars or a heading count. Click a person icon to choose who is you; the
  selected member stays first with animated row movement.
  Other names currently used by joined participants have a dark filled icon;
  names without a current participant stay outlined.
  One ringed status dot (or a YOU badge) overlays the icon's right edge,
  online if any participant using that name is online; a "+N" badge on the
  left edge counts the other participants using it.
  Hollow markers mean presence is unavailable. Multiple tabs count once.
  A cross icon removes any member immediately, including your own,
  retaining them for history. The app list shows current members only.
- Mobile and touch layouts use a full page for group settings, with
  keyboard-aware scrolling and Back to group. Desktop layouts retain a dialog.
- A separate app installation credential, SDK replicas persisted atomically in
  IndexedDB, and reopening the last group on a returning visit.
- Groups have no currency setting. Future expenses and settlements will record
  their own currency, with separate balances per currency; see
  [ADR 0014](./docs/adr/0014-record-currency-per-expense.md).
- The money rules expenses will use already exist as a pure, property-tested
  module, `src/domain/money.ts`: whole minor units per currency, allocation by
  exact amounts and shares, rounding extras that rotate by accumulated burden,
  and balances that net to zero per currency; see
  [ADR 0017](./docs/adr/0017-allocate-money-in-whole-minor-units-with-burden-fair-rounding.md).
  No expense commands or screens exist yet.

## Run locally

```bash
npm install
npm run dev
```

The development command applies pending migrations to the local D1 database
before starting Wrangler.

Open `http://localhost:8787/` for the homepage or `/app` for the app. Creating a
group uses one form for group name and your name, with
Create group and Back to groups actions. The app remembers the last name used
as you on this installation in localStorage and prefills it when creating a
group or joining as someone new. The name stays editable. The group
opens with its Members list visible and actions to add members or invite friends.
Invite recipients preview the group and choose an existing name or add their
own. Entering an existing member's name while joining selects that member, even
when another participant uses it, without creating a duplicate. Invite links
for a group already joined on this installation open that
group directly, keeping the selected member. The invite entry route remains
available for future native app handoff. Expenses and balances are not
implemented in this beta.

Browser app replicas use IndexedDB; the installation credential and last group are retained in
localStorage. Losing that credential loses this installation's access. On a
fresh installation, use a current invite link to join each group again.

After an online visit has cached the app shell, `/app` can reload without a
connection. The service worker caches public entry HTML and build assets only;
API responses and invite previews are not cached. Saved
ledger replicas stay in IndexedDB, and supported edits queue through the SDK.
Startup restores those replicas before refreshing in the background, so a
stalled server does not block opening a saved group. Other tabs on the same
origin share the installation and reread replicas through a BroadcastChannel.

`npm run dev` exports the Expo web client and starts the API and
server-rendered entry pages on port 8787.
For fast UI iteration, keep that Worker running and use `npm run app:dev` in a
second terminal; Expo runs on port 8081 and connects to the API on port 8787.
Native release and platform-specific persistence are a later slice.

Open `http://localhost:8787/components` (or `:8081/components` under Expo) for
the component workbench. Search the sidebar, pick a component, and edit its
controls; callbacks such as presses appear in the Events log. `MemberIcon` has
an explicit `isYou` switch, separate presence controls, and an other-participant
count; turn `isYou` off with one other participant to preview a dot without the
YOU badge. `MemberList` runs
against an in-memory group, with controls for members, who is you, other
participants, presence, connection, latency, and forced command errors. The
viewport presets resize the canvas only; components that read the window size
still see the real window. The Screens and Sheets groups render each app screen
(groups list, create, group, join, invite, settings, review) against the same
in-memory fake, with connection, latency, and failure controls. Add examples
with `defineStory` in `apps/client/src/workbench/catalog.tsx` or `screens.tsx`.
The Worker serves this route only when `ENABLE_DEBUG_INSPECTION` is true.

Metro watches the repository's `src/` folder as well as the workspaces, so SDK
edits reload under `npm run app:dev` without a restart.

The component workbench uses the production `AppController`, SDK, and group
engine through an isolated memory transport. Its fixtures use valid contracts;
creation, joining, leaving, replacement links, aliases, outboxes, and notices
follow the same rules as the app. Latency and forced server failures apply
to connected requests; offline ledger edits continue to queue locally.

### App actions

Everything a person can do in the app is an app action
([ADR 0016](./docs/adr/0016-dispatch-app-actions-through-one-caller-agnostic-catalog.md)).
Actions are declared per group in `apps/client/src/model/actions/` (`ui.ts`,
`ledger.ts`, `access.ts`) with `defineAction` and the shared requirement
checks in `define.ts`; `apps/client/src/model/actions.ts` assembles the
catalog. `createDispatcher(controller)` returns one caller-agnostic surface:

- `dispatch(name, input, { confirmed, origin })` checks preconditions (online,
  reachable, open group) and validates input with the action's zod schema, in
  the same order as `availability`, and returns an `Outcome`: `done`,
  `needs_confirmation` with a message, or `failed` with an error code. It
  never throws.
- `dispatchJson(name, json)` does the same for callers holding only names and
  JSON, such as RPC or an assistant.
- `describe()` lists every action with its description, preconditions,
  group, current availability, whether it needs confirmation, an example
  input, and a JSON Schema.
- `inputOptions(source)` resolves state-backed choices and suggestions for any caller.
- `availability(name, input?)` checks current state and platform support
  without running anything; with input, it also validates the proposed values.
  Unavailable results include a short reason and the same failure code dispatch
  enforces. This is a local preflight, not a guarantee of server success.
  `test/actionModel.test.ts` checks this for generated sequences of every
  action, some dispatched twice or alongside another before the first
  finishes, as a double click would: dispatch fails exactly when and why
  availability said when it was called, available actions fail only for
  server decisions about someone else's group, nothing stays running, and
  every view keeps the group it shows.
- `stateActionMap()` returns the live state/action map.
- `executions.snapshot()` and `executions.subscribe()` expose shared pending work.
- `observe(listener)` reports each dispatch with its origin and status.

Actions that need approval (replacing the invite link, leaving, choosing a
member another participant uses) return `needs_confirmation` until called
with `confirmed: true`; each caller obtains approval its own way. The UI uses
`useActionCall()`. Navigation, form drafts, member editors, join choices,
visibility toggles, and copy/share also use the catalog. `showGroups` returns
to the group list; `showSettings`, `showInvite`, and related actions open the
same views from any caller. `changeDraft` updates a named field without saving;
submission actions consume the shared draft. `ui.snapshot()` and
`ui.subscribe()` expose the shared screen state, and `state()` includes it.
`confirmAction` and `cancelConfirmation` resolve a pending request by id.
Every screen changes data only through actions;
startup, background refresh, and online tracking stay on the controller.

`model/workflow.ts` defines the local view/phase state machine and pure
transitions. The catalog declares each workflow intent and uses the same rules
for availability and execution. Shared checking, creating, joining, and saving
phases work across callers; repeated submissions are blocked, failed requests
retain their draft, and obsolete invite responses are ignored. Direct ledger
operations still work from any view and can queue offline. No state-machine
library is required.

Pending action executions are observable and shared across callers. Each
action declares the locks it `holds` while running and the locks it
`waitsFor`, so direct mutations and draft submissions use the same guards.
Member saves protect the editor and target while unrelated ledger edits remain
available, including offline; navigation always waits for a running member
save, and other workflow steps wait for a navigation still loading its group.
Locks release after success or failure. A panel or member editor whose group
goes away, for example because another tab left it, returns to the groups
list, and a leave that finishes while another step runs leaves the view to
that step. `stateActionMap()` exposes the
current workflow, evaluated completion edges, action metadata and
availability, and pending executions. Devtools renders it in the Map tab;
there is no separate transition table to maintain.

`availability()` is the only thing that decides whether a control is enabled.
Screens disable a control when its action is unavailable or when that
control's own call is still running, through `useActionCall().can(name,
input)`; they add no busy rules of their own. A dependency a screen needs,
such as not choosing a member who is being removed, is declared on the action,
so devtools and every other caller see the same reason.

### Devtools

Open `/app?devtools` to switch on a development panel inside the app; the
choice is remembered on that device, and `?devtools=0` switches it off. A
`</>` button opens a panel with four tabs. The button and panel remain above
app dialogs and popups; devtools fields stay usable while a dialog is open.
Escape inside devtools closes its panel without closing the app dialog.

The tabs are:

- **Map** shows the current workflow, completion transitions, action availability,
  requirements, input fields, and pending operations, generated from the catalog
  and transition evaluator.
- **Actions** calls any app action against the real open group, through the
  same dispatcher as the screens (origin `devtools`). Actions are grouped into
  **UI**, **Ledger changes**, and **Access & sync**, according to their main
  purpose; UI opens first. Member selectors default to another member when
  available and include you. Browse actions through these tabs, without a
  search field, secondary categories, or an All tab.
  Available actions come first; unavailable actions are faded at the bottom
  and remain selectable for inspection. Dispatch
  is disabled with a short reason until state and inputs permit the action;
  approval also rechecks the original pending action. Each action gets a form
  generated from its input schema: dropdowns for fixed options and for values
  that must be a member, group, or notice of this installation (labelled by
  name); text fields with suggestions where app state can help, such as the
  current invite link; plain text, number, and switch fields otherwise; and a
  kind dropdown for inputs with variants. The JSON it sends is shown below the
  form. A confirmation shows its message with Approve and Cancel.
- **Log** lists every dispatch from any caller, with its origin (`ui`,
  `devtools`, `history`), result, and time, collected from when the app opened.
- **State** shows the connection, groups, open group, and UI drafts and view as
  the action layer sees them, including the workflow phase and request id.
  Invite credentials are omitted from this display.

Devtools run in Expo development and in builds served by a Worker with
`ENABLE_DEBUG_INSPECTION` enabled, as `npm run dev` does; the app asks
`GET /debug/status`, which answers only then. Production never enables them,
and every build is identical, so no build setting can switch them on.

To try several devices by hand, open `/app` in separate browser profiles or
a private window; tabs in one profile share an installation. Compare their
devtools Log request IDs, and read the server's state with
`GET /debug/groups/{groupId}`.

### Diagnosing problems in any build

Every SDK request carries an `x-request-id` header, and the Worker writes one
JSON log line per request under that id, echoing it in the response: route,
status, duration, error code, identity and group ids, and for synchronization
the known and new revision and each command's id, type, status, and reason.
Lines never contain names, tokens, credentials, or request bodies.
`LOG_REQUESTS` switches them off (tests do); deployed Workers keep them on.

The app's dispatcher keeps the last 100 dispatches and SDK request events from
the moment it starts, in every build. Devtools show them, and **Copy
diagnostics** at the bottom of the groups list copies them as a report for
support: app and connection state, this installation's identity id, group ids
with their outboxes and notices as ids and codes, recent actions with
invocation ids and failure codes, and requests with their request ids. Search
the Worker logs for those request ids to see what the server decided.

Run the complete verification suite with:

```bash
npm run check
```

This also exports the app, checks its TypeScript, and tests frontend rendering
against the actual bundled Worker. Run `npm test` after a build/check has
prepared `.wrangler/dry-run`; the renderer tests load that bundle.

`npm run check:fast` runs everything except the app build and the browser
tests, against the last app build, in about a minute. `npm install` points git
at `.githooks/`, whose pre-push hook runs it; when Git for Windows pushes a
checkout inside WSL, the hook runs the checks inside that distribution. Skip it
once with `git push --no-verify`. `.github/workflows/check.yml` runs the full
`npm run check` on a fresh checkout for every push to `main` or `master` and
every pull request, and keeps Playwright traces when it fails.

`npm run test:e2e` drives the built app in headless Chromium through
`e2e/app.spec.ts`: creating groups, member edits, settings, invite
replacement, joining from a second device with realtime updates, offline
edits, and leaving and rejoining. It starts its own Worker on port 8791 with
separate local storage in `.wrangler/e2e-state`, recreated on every run, so it
does not touch `npm run dev` data. Install the browser once with
`npx playwright install chromium-headless-shell`; a failure keeps a trace in
`test-results/` that `npx playwright show-trace` opens.

## Synchronization contract

`POST /groups/{groupId}/sync` receives the client's last confirmed revision and
its ordered outbox. Each command has a stable client-generated id. The server
processes the batch in order and returns an immutable outcome for every command
plus a complete authoritative snapshot whenever state may differ.

The client retains its outbox when transport fails. Edits made while the server
is unreachable resolve with the queued local state, as they would offline;
only server rejections report a failure. Leaving can start only online, but
once queued it is not undone by a lost response: the group shows as left and
the leave is delivered on reconnect. If the server applied a
command but the response was lost, retrying the same command id returns the
stored outcome without applying the change twice. Concurrent intent conflicts
are returned as `superseded` or `rejected`; the SDK replaces its confirmed
snapshot and preserves those outcomes as local notices.

Joining or rejoining a group first delivers its queued commands, so a leave
whose response was lost reaches the server before the rejoin. Rejoining keeps
unreviewed notices. Once a synchronized snapshot shows this identity's access
is active, the SDK drops any join it was still retrying.

`test/syncConvergence.test.ts` checks this contract with generated scenarios:
three devices, each with two tabs sharing one installation's storage, work in
two groups, one of which a device joins through its link. They go offline,
reload, lose requests or responses, fail to read or save local storage, list
their groups, and issue every command, join, leave, rejoin, notice retry and
dismissal, some of them concurrently. Realtime announcements reach every tab
and start background synchronization while steps run. After everyone
reconnects, each device must match the server snapshot of every group it can
access and list exactly those groups, and every queued command must have
exactly one stored outcome and one audit event per revision. Unresolved
rejections must still be visible as notices, resolved ones must never return,
and background synchronization may fail only from injected faults. A failure
prints the shortest failing sequence of steps. Add new commands to its
`commandArbitrary`, and add sequences that once failed to its `examples`.
`test/groupCommandRules.test.ts` lists the outcome of every command rule as a
table.

Each local operation's last write also returns the replica it produced, so an
operation that fails to save has changed nothing and one that saved is never
reported as failed. Once a command or retry is in the outbox, its call has
succeeded: if delivery then finds the server unreachable or storage failing,
the next synchronization delivers it, and a storage failure is reported like
a failed background synchronization. An outcome becomes a notice only through
the update that removes its command from the outbox, so another tab's late
response cannot bring back a notice already retried or dismissed. A join
retried after a lost request carries the newest link, since the old one may
have been replaced meanwhile.

A successful link replacement shows its new link locally even if the device
goes offline before the follow-up synchronization.

## Group lists

`GET /identity/groups` lists the groups an identity can access, active ones
first, marking those it left. The list comes from a D1 index derived from group
snapshots: the Worker refreshes an identity's row whenever it creates, joins,
or receives a snapshot of a group, writing only when something changed. Each
group's Durable Object stays authoritative, so a rename by someone else
appears in your list after you next synchronize that group, which realtime
announcements trigger. The SDK's `listGroups()` merges the list with its local
replicas and caches it for offline use; `syncGroup` fetches a group that has no
local replica. Groups an identity left stop synchronizing; `refreshGroup`
fetches one explicitly, for example to choose a member before rejoining. See
[ADR 0010](./docs/adr/0010-derive-group-lists-from-snapshots.md).

## Invite links

Every group has exactly one current invite link, shared as
`{app}/join/{groupId}#{token}`. The client generates the token before creation
or regeneration so retries reuse it. The server retains the current token in
the authoritative group snapshot and its hash for redemption checks. Every
participant receives the same usable link in authenticated creation, join,
and synchronization responses, and caches it with the group for offline sharing.
Regeneration replaces the link for everyone through normal synchronization;
links never expire with time. There is no standalone revoke action. Public
previews, audit history, and SDK diagnostic logs omit tokens.

`PUT /groups/{groupId}/invite` replaces this single resource and returns 200
with current metadata. A retry reuses the client-generated invite id and token;
retrying an older replacement never overwrites a newer link. The SDK exposes
this as `regenerateInvite(groupId)`.

`POST /groups` requires `invite: { invite_id, token }` alongside the group id,
group name, and creator member name. It creates the group, member, access grant,
and invite in one transaction and returns public invite metadata. The sync SDK
generates and saves the token before sending the request, then makes the link
available through `projected_snapshot.invite.token`; callers supply only the group and member
names. A retry returns the original creation result without replacing a newer
invite.

A new identity previews the group with the token, then joins with it and
either an existing member or a new one. An identity that left rejoins without
a link. Regenerating a link never removes access it already granted.
See [ADR 0015](./docs/adr/0015-share-the-current-invite-through-group-snapshots.md).

## Realtime announcements

`GET /groups/{groupId}/realtime` upgrades to a WebSocket. Because browsers
cannot set headers on WebSockets, the client offers two subprotocols:
`splitnext.v1` and `splitnext.auth.v1.<device secret>`. The server selects
`splitnext.v1`, rejects identities that lack access or have left the group,
and closes a subscription with code 4403 when its identity leaves.

The revision message is `{ "type": "revision", "revision": n }`, sent on connect
and after every applied change. It is a hint, not state: the SDK synchronizes
through the normal snapshot path when the announced revision is newer than its
confirmed one. The announcement on connect makes every reconnect a catch-up,
so missed, duplicate, or reordered messages are harmless. Synchronizations are
serialized per group, so a burst of announcements costs at most one extra
request. See [ADR 0008](./docs/adr/0008-announce-revisions-over-hibernatable-websockets.md).

Separate `{ "type": "presence", "identity_ids": [...] }` messages identify
connected participants, deduplicating their tabs. The SDK exposes the current
roster through `client.presence(groupId)` and `on_presence_change`; a disconnected
client returns `null` for unknown presence. These updates do not advance revisions
or write snapshots or audit history. Abrupt network loss is reflected when the
server detects the disconnect.

## Client SDK

The low-level transport validates shared request and response contracts. The
stateful client owns identity initialization, confirmed snapshots, optimistic
projections, ordered outboxes, reconciliation, and conflict notices. An
optional observer receives one credential-redacted event stream whose stable
request identifiers correlate requests with responses or network failures,
and realtime connection phases with their messages:

```ts
import {
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
} from './src/client';

const api = new SplitnextClient({ baseUrl: 'https://api.example.com' });
const client = new SplitnextSyncClient({
  api,
  device_secret: deviceSecret,
  storage: new MemoryClientStorage(),
  on_background_sync: (replica) => console.log(replica.revision),
});

await client.initializeIdentity();
const group = await client.createGroup({
  name: 'Berlin flat',
  creator_member_name: 'Santi',
});

client.setOnline(false);
await client.submit(group.group_id, {
  type: 'member.create',
  payload: { display_name: 'Robin' },
});
client.setOnline(true);
await client.syncGroup(group.group_id);

// Receive other devices' changes as they happen.
client.watchGroup(group.group_id);
```

Every group command goes through `submit(groupId, intent)`. An intent is the
command without its identifiers; omitted preconditions, such as the name a
rename expects to replace, default to what the local projection shows. The app
controller and app actions use the same path. Each command is one file in
`src/domain/commands/` holding its schema, the rule the server and every
client projection apply, its target, member alias handling, intent
completion, retry intent, and audit change. A new command is that file, its
entries in `groupCommandSchema`, `registered`, and `groupCommandTypes`, its
notice wording, and one app action; the registry's type rejects a missing or
mismatched entry, and the notice wording is an exhaustive switch. Each command keeps
one name everywhere: the `groupCommandTypes` key, such as `archiveMember`,
names its app action, and its value, such as `member.archive`, is the wire
type.

`MemoryClientStorage` is useful for tests. `IndexedDbClientStorage` is the atomic
browser adapter used by the app. React Native can provide a SQLite
adapter at the same opaque storage seam.

Realtime connections go through the same kind of seam: `browserWebSocket` is
the default `RealtimeSocketFactory`, and tests or other platforms can supply
their own.

The client persistence module validates its versioned document and serializes
updates so concurrent client instances and in-flight synchronization cannot
discard newly queued intent.
Startup upgrades saved pre-shared-invite documents automatically while retaining
identities, pending edits, and retries. A device without the saved link token
needs one connection to fetch its group's current snapshot for that upgrade;
failed attempts preserve the original data.

The SDK owns notice retries through `retryNotice(groupId, commandId)`. It
creates fresh command identifiers and rename preconditions from the current
projection, retaining that intent and retiring the old notice in one atomic
storage update. Ordinary retries work offline; retrying a leave must start
online. The app uses this SDK operation.

## Storage seams

- D1 stores global access identities and device credentials.
- `DurableObjectGroupRepository` transactionally persists current group state,
  audit events, command outcomes, and join outcomes in normalized SQLite tables
  inside that group's Durable Object.
- `MemoryGroupRepository` runs the same group engine without Cloudflare and is
  used for fast tests with the same commit and rollback behavior.
- Client storage is accessed only through `ClientStorageAdapter`.

`AuditHistory` validates action-specific before/after state, captures actor
attribution, and reads events in durable order. It remains internal until a
future history or recovery slice exposes product behavior. Protected Hono
routes share one authenticated-request module for credential parsing, device
authentication, identity availability, and consistent unauthorized responses.

In local development, debug-only inspection routes read current server state.
`GET /debug/groups` lists groups represented in the D1 identity-group index;
`GET /debug/groups/{groupId}` reads one group's Durable Object state, including
its realtime subscribers; and `GET /debug/identity-directory` lists identities
and devices. These routes return 404 unless `ENABLE_DEBUG_INSPECTION` is
enabled.

The pure command transition rules are shared by the server and the optimistic
client projection. Cloudflare storage and client-local persistence remain
separate implementations.

Shared snapshot selectors in `src/domain/selectors.ts` define active members,
joined participants, preferred members, and invite-preview choices for the
server, SDK, and app. Display ordering and presence markers live
in the app model; devtools input choices also live in the model.

## HTTP surface

- `GET /health`
- `GET /ready`
- `POST /identities/anonymous`
- `GET /identity`
- `GET /identity/groups`
- `POST /groups`
- `POST /groups/{groupId}/join`
- `PUT /groups/{groupId}/invite`
- `POST /groups/{groupId}/invite/preview`
- `POST /groups/{groupId}/sync`
- `GET /groups/{groupId}/realtime` (WebSocket)
- `GET /openapi.json`
- `GET /docs`

Debug-only routes, hidden unless `ENABLE_DEBUG_INSPECTION` is enabled:

- `GET /debug/status`
- `GET /debug/identity-directory`
- `GET /debug/groups`
- `GET /debug/groups/{groupId}`

Remote deployment has not been performed. `wrangler.jsonc` still contains a
placeholder D1 database id.

## Project documentation

- [Domain language](./CONTEXT.md)
- [Accepted product behavior](./docs/product-spec.md)
- [Architecture decisions](./docs/adr/)
- [Agent working agreement](./AGENTS.md)

SDK failures distinguish network, server, protocol, storage and offline causes
through `clientErrorKind(error)`. Cached identity and queued-command fallback
apply only to `SplitnextNetworkError`. Invalid server replies are observable
as `protocol_error` in SDK transport diagnostics;
storage and programming failures are surfaced rather than marked offline.

`SplitnextSyncClient.installationState(groupIds)` returns group summaries,
notice counts, and requested replicas from one local storage read. The app
uses it to publish consistent state without reparsing the entire
installation once per group. Pending responses reread current storage before
publication so newer local work takes precedence.

HTTP and memory transports run the same contract suite for input validation,
access and invite failures, replacement, directory discovery, idempotency and
lost sync responses. Failure status mapping is shared with Worker routes;
memory transports keep independent device identities over the same isolated
server state.

Devtools Log includes action UUIDs, durations and workflow changes alongside
SDK command/request/outcome diagnostics. `observeDiagnostics` is available on
the SDK and dispatcher. Request IDs match HTTP observer IDs; offline command attribution survives local reload until acknowledgment.
Observer failures cannot change operation results. Diagnostics contain IDs and
outcome codes, with credentials, invite links and draft inputs excluded.
