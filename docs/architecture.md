# Splitnext architecture

How the system fits together and the rules each part keeps. The
[README](../README.md) covers running and checking it,
[CONTEXT.md](../CONTEXT.md) the domain language,
[docs/product-spec.md](./product-spec.md) accepted product behavior, and
[docs/adr/](./adr/) why each consequential decision was made.

## Overview

- **Worker** (`src/app.ts`, `src/routes/`): Hono routes with OpenAPI
  contracts. D1 holds identities, device credentials, and a derived index of
  which identity can access which group.
- **One Durable Object per group** (`src/groupObject.ts`, `src/groupStore.ts`):
  the authoritative group state, command outcomes, join outcomes, and audit
  history in that object's SQLite storage
  ([ADR 0001](./adr/0001-one-durable-object-per-group.md)).
- **Shared domain** (`src/domain/`): schemas and pure rules used by the server
  and by every client's optimistic projection. Each group command is one file
  in `src/domain/commands/`, registered in `src/domain/commands.ts`.
- **Client SDK** (`src/client/`): the HTTP transport, the stateful sync client,
  the replica store over a swappable storage adapter, and realtime
  subscriptions.
- **App** (`apps/client/`): an Expo Router app, built for the web today. Its
  `model/` holds the controller over the SDK, the action catalog every caller
  uses, the workflow state machine, and the shared UI state; `ui/` holds the
  screens, `devtools/` the in-app development panel, and `workbench/` the
  component workbench.

## The web app

The Worker serves a public homepage, invite entry pages, and the Expo web app
at `/app`.

The app uses one fixed light palette from `ui/theme.ts`: white cards with a
hairline edge on a cool grey page, near-black ink, one blue for each page's
main action and links, and blue and orange only for money someone gets back or
owes; green means settled or online; a brighter orange marks the Activity
badge and changes to review. Body text uses local IBM Plex Sans, amounts, currency codes
and invite links local IBM Plex Mono, and titles local Bricolage Grotesque.
Icons are stroked outlines in `ui/icons.tsx`.

Screens follow the agreed phone design, in one narrow column on every device.
`AppScreen` picks each view's fixed header, body, and main action, and `Frame`
lays them out: a header (`ScreenHeader` with Back or Cancel, an optional title,
and an optional end action such as Save, `BackHeader` for details pages, or
`GroupHeader` for a group), the scrolling content, and the main action pinned
at the foot or floating over the content. The groups list pins New group; New
group pins Create group; the join screen pins Open link or Join as the chosen
name; the group screen always floats + Add expense, including when there are
no expenses or repayments, without an empty-expenses message; the expense and repayment forms
save from their headers. Screen, page, and drawer titles share the 18px
`viewTitle` style; scrolling compacts header spacing and context without
scaling the title. A saved repayment also has a short Delete header action,
using the existing removal action and returning to its opening view.

A group has one screen (`home`) without tabs. `GroupHeader` holds the group
name, which opens the groups list, the `ActivityBell`, and a gear button opening `settings`
(`GroupSettings`). `Frame` holds a thin `SyncStatus` strip above the header
across all views while offline or unreachable. Its measured height reduces
the available room used by `useBalancesLayout`. Tapping it
opens a `Drawer` with the connection state, locally queued change count, and
Retry when online. Reconnecting closes it and hides the strip. Background
network/offline errors use this status rather than a second banner; other
background errors remain visible. The web `AmountInput` uses
`react-number-format` to keep fixed currency precision while managing the
caret, accepts dot/comma entry, and rejects ambiguous pasted amounts.
Settings contains the group name field, Save group name
only after a change, and Leave group with its confirmation sheet. Below the
group header, `Frame`'s one `ScrollView` is
the only scroll area on every screen.
On the web its scroll anchoring is disabled: automatic anchor adjustments
during header resizing would feed back into compact progress and cause
the expense header to oscillate at the bottom of a nearly full split list.
The group screen's content is `GroupBalances` and `ExpenseList`, sections sharing `SectionHeading` and the
same card rows. `useBalancesLayout` measures the Balances heading, each row,
and the Add a person line, plans the default level from the window and header
heights (people that leave room for the Expenses heading, two expenses, and
the floating button, then a faded “more” item), and keeps the page's scroll
position in a small store that only the balances read, so scrolling
re-renders nothing else. At the default level the section is a `StickyTop`
(CSS sticky on the web) inside the page, followed by a spacer of its height;
its card's height follows the scroll, cut from the bottom until only the
heading is left; whole people show, with only the lower half of the “···”
button reserved below the card. Expenses follow with the normal section
spacing rather than filling the unused viewport allowance. Invite people
uses the solid action color while there are no active expenses, with Add
expense using the soft action color; once an expense exists they swap emphasis
without changing their labels, position, or size.
One `StickyTop` holds the Balances heading and Invite action in both levels,
above the card's layer; a measured placeholder keeps their space in the
section. `AppUiState.balancesExpanded` is Show all: the card then flows with
the page beneath the same heading, without mounting a second heading.
Tapping the heading calls `Frame`'s `scrollControl` to scroll smoothly to
the top. The Expenses heading is a `StickyTop` offset by the pinned Balances
heading, and tapping it scrolls the expenses up to it. `ExpenseList` shows expenses and
repayments newest first. Tapping a person opens
`person` (`PersonDetails`), whose Settle up opens `settle` (`SettleUp`), whose
payments open the repayment form (`settlements`) filled in. `AppUiState.trail`
records the views a page was opened from, so Back, Cancel, and saving return
there, and history restores the trail with the view and the person. Invite
opens `InviteSheet` as a bottom sheet over the group screen; leaving a group
confirms in a `ConfirmSheet`. Removing a member sets `AppUiState.removal`,
which `RemovalToast` shows without an Undo action until it is dismissed or times out. The
original split-S mark is rendered by `ui/BrandMark.tsx` on the groups list and
the join screen. The browser favicon uses the same artwork. Appearance assets
are served locally and precached; their contents contribute to the service
worker's release cache key.

- Creating a group uses one form for group name and your name in it, with
  Create group and Back to groups actions. The app remembers the last name used
  as you on this installation in localStorage and prefills it when creating a
  group or joining as someone new. The name stays editable. The group opens on
  its group screen with the balances expanded.
- Invite recipients preview the group and choose an existing name, even when
  it is already taken on another device, or add their own as a new member. Invite
  links for a group already joined on this installation open that group
  directly, keeping the selected member. The invite entry route remains
  available for future native app handoff. A link that no longer works shows
  why and a field to try a different one.
- The invite sheet shows the link, which selects and copies itself when
  tapped, then native sharing when supported and Replace link side by side,
  which regenerates the invitation after confirming, in the same sheet, that
  the old link will stop working.
- The groups list has the logo and Join in its header above group cards, or No
  groups yet when there are none. Leaving asks for confirmation with a Cancel
  option. Offline captions name the blocked action. When joining or rejoining,
  names already taken by a current participant are marked Taken.
- Group cards show the people count and who you are; left groups appear as
  cards with Rejoin. Locally stored active cards also show the preferred
  member's nonzero balances as signed amounts per currency, Settled when all
  are zero, or Choose who you are when unassigned. Summaries derive
  from the same projected snapshot, without additional storage reads or
  currency conversion. A placeholder list shows while local storage opens.
  Errors appear beside the row or button that caused them; background sync
  errors appear at the top of the page. Every control has a visible keyboard
  focus outline.
- The balances list everyone with a balance or still active, you first, and
  end with an Add a person field that adds on blur without confirm/cancel
  controls. They show a numeric zero in each currency a person has current
  records in when settled; people without current records keep a blank amount.
  Person details use the same per-currency balances, with Settled and zero
  shown together. They rename inline, choose the member as you without a
  confirmation (warning afterward when the name is already taken on another device), and remove the
  member immediately, including your own. `memberBreakdown` in
  `model/breakdown.ts` lists the expenses and repayments behind a balance, per
  currency, adding up exactly to it. Presence markers show online, offline, or
  unused; multiple tabs count once.
- Forms are pages with keyboard-aware scrolling on every device. Member
  editing is allowed on the group screen and in person details.
- Settle up shows the payments in `planTransfers` (`src/domain/settlements.ts`)
  that involve one person. The plan has the fewest payments per currency: it
  splits nonzero balances into as many zero-sum sets as possible with a bitmask
  search for up to 14 people, and settles each set greedily; larger groups use
  the greedy plan alone. Picking a payment opens the repayment form filled in;
  the form also lists earlier repayments. The expense editor has Cancel and
  Save, a payer row, a large centered amount, per-person split controls, Occasion,
  and Remove expense for an existing expense. `ExpenseDraft.parts` retains each
  person's whole shares or typed fixed amount independently. Per-person actions
  increase or decrease shares, include or exclude a person, and fix or clear an
  amount; the catalog protects the last person sharing the remainder. The
  preview uses the shared allocator, including the rounding burden with the
  edited expense excluded. Mixed weights and fixed amounts survive reopening
  and saving. Removal excludes an expense from balances while retaining it for
  future restoration. The SDK and server share the same money and command rules.

Browser app replicas use IndexedDB; the installation credential and last group
are retained in localStorage. Losing that credential loses this installation's
access. On a fresh installation, use a current invite link to join each group
again.

All of an installation's replicas live in one document, which every local
operation reads, validates, and rewrites whole. `test/storageBudget.test.ts`
keeps that affordable: for 12 groups of 40 members with notices and a queued
offline session, the document must stay under 128 KiB (88 KiB today), local
operations under 20 ms each (2 to 3 ms on a development machine), and each
operation within a fixed number of storage round trips. Expenses will grow the
document; when a budget fails, split storage per group rather than raising it
blindly.

After an online visit has cached the app shell, `/app` can reload without a
connection. The service worker caches public entry HTML and build assets only;
API responses and invite previews are not cached. Saved ledger replicas stay in
IndexedDB, and supported edits queue through the SDK. Startup restores those
replicas before refreshing in the background, so a stalled server does not
block opening a saved group. Other tabs on the same origin share the
installation and reread replicas through a BroadcastChannel.

### Component workbench

`/components` (or `:8081/components` under Expo) opens the component
workbench. Search the sidebar, pick a component, and edit its controls;
callbacks such as presses appear in the Events log. `MemberIcon` has an
explicit `isYou` switch, separate presence controls, and an other-participant
count; turn `isYou` off with one other participant to preview a dot without
the YOU badge. `BalancesPanel` runs against an in-memory group, with controls for
members, who is you, other participants, presence, connection, latency, and
forced command errors. The viewport presets resize the canvas only; components
that read the window size still see the real window. The Screens group
renders each app screen's content (groups list, create, group, join, invite,
group settings, Activity) against the same in-memory fake, with connection, latency,
and failure controls. Add examples with `defineStory` in
`apps/client/src/workbench/catalog.tsx` or `screens.tsx`. The Worker serves
this route only when `ENABLE_DEBUG_INSPECTION` is true.

The workbench uses the production `AppController`, SDK, and group engine
through an isolated memory transport. Its fixtures use valid contracts;
creation, joining, leaving, replacement links, outboxes, and notices
follow the same rules as the app. Latency and forced server failures apply to
connected requests; offline ledger edits continue to queue locally.

## App actions

Everything a person can do in the app is an app action
([ADR 0016](./adr/0016-dispatch-app-actions-through-one-caller-agnostic-catalog.md)).
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
- `inputOptions(source)` resolves state-backed choices and suggestions for any
  caller.
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
- `executions.snapshot()` and `executions.subscribe()` expose shared pending
  work.
- `observe(listener)` reports each dispatch with its origin and status.

Actions that need approval (replacing the invite link and leaving) return `needs_confirmation` until called
with `confirmed: true`; each caller obtains approval its own way. The UI uses
`useActionCall()`. Navigation, form drafts, member editors, join choices,
visibility toggles, and copy/share also use the catalog. `showGroups` returns
to the group list; `showSettings`, `showInvite`, and related actions open the
same views from any caller. `changeDraft` updates a named field without saving;
submission actions consume the shared draft. `ui.snapshot()` and
`ui.subscribe()` expose the shared screen state, and `state()` includes it.
`confirmAction` and `cancelConfirmation` resolve a pending request by id.
Every screen changes data only through actions; startup, background refresh,
and online tracking stay on the controller.

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
that step. `stateActionMap()` exposes the current workflow, evaluated
completion edges, action metadata and availability, and pending executions.
Devtools renders it in the Map tab; there is no separate transition table to
maintain.

`availability()` is the only thing that decides whether a control is enabled.
Screens disable a control when its action is unavailable or when that
control's own call is still running, through `useActionCall().can(name,
input)`; they add no busy rules of their own. A dependency a screen needs,
such as not choosing a member who is being removed, is declared on the action,
so devtools and every other caller see the same reason.

## Devtools

Open `/app?devtools` to switch on a development panel inside the app; the
choice is remembered on that device, and `?devtools=0` switches it off. A
`</>` button opens a panel with four tabs. The button and panel remain above
app dialogs and popups; devtools fields stay usable while a dialog is open.
Escape inside devtools closes its panel without closing the app dialog.

The tabs are:

- **Map** shows the current workflow, completion transitions, action
  availability, requirements, input fields, and pending operations, generated
  from the catalog and transition evaluator.
- **Actions** calls any app action against the real open group, through the
  same dispatcher as the screens (origin `devtools`). Actions are grouped into
  **UI**, **Ledger changes**, and **Access & sync**, according to their main
  purpose; UI opens first. Member selectors default to another member when
  available and include you. Browse actions through these tabs, without a
  search field, secondary categories, or an All tab. Available actions come
  first; unavailable actions are faded at the bottom and remain selectable for
  inspection. Dispatch is disabled with a short reason until state and inputs
  permit the action; approval also rechecks the original pending action. Each
  action gets a form generated from its input schema: dropdowns for fixed
  options and for values that must be a member, group, or notice of this
  installation (labelled by name); text fields with suggestions where app
  state can help, such as the current invite link; plain text, number, and
  switch fields otherwise; and a kind dropdown for inputs with variants. The
  JSON it sends is shown below the form. A confirmation shows its message with
  Approve and Cancel.
- **Log** lists every dispatch from any caller, with its origin (`ui`,
  `devtools`, `history`), result, and time, collected from when the app
  opened. It includes action UUIDs, durations and workflow changes alongside
  SDK command, request, and outcome diagnostics.
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

## Diagnostics

Every SDK request carries an `x-request-id` header, and the Worker writes one
JSON log line per request under that id, echoing it in the response: route,
status, duration, error code, identity and group ids, and for synchronization
the known and new revision and each command's id, type, status, and reason.
Lines never contain names, tokens, credentials, or request bodies.
`LOG_REQUESTS` switches them off (tests do); deployed Workers keep them on.

The app's dispatcher keeps the last 100 dispatches and SDK request events from
the moment it starts, in every build. Devtools show them, and their **Copy
diagnostics** action copies them as a report for
support: app and connection state, this installation's identity id, group ids
with their outboxes and notices as ids and codes, recent actions with
invocation ids and failure codes, and requests with their request ids. Search
the Worker logs for those request ids to see what the server decided.

`observeDiagnostics` is available on the SDK and the dispatcher. Request IDs
match HTTP observer IDs; offline command attribution survives local reload
until acknowledgment. Observer failures cannot change operation results.
Diagnostics contain IDs and outcome codes, with credentials, invite links and
draft inputs excluded.

## Synchronization contract

`POST /groups/{groupId}/sync` receives the client's last confirmed revision and
its ordered outbox. Each command has a stable client-generated id. The server
processes the batch in order and returns an immutable outcome for every command
plus a complete authoritative snapshot whenever state may differ
([ADR 0003](./adr/0003-synchronize-commands-and-full-snapshots.md)).

The client retains its outbox when transport fails. Edits made while the server
is unreachable resolve with the queued local state, as they would offline;
only server rejections report a failure. Leaving can start only online, but
once queued it is not undone by a lost response: the group shows as left and
the leave is delivered on reconnect. If the server applied a command but the
response was lost, retrying the same command id returns the stored outcome
without applying the change twice. Concurrent intent conflicts are returned as
`superseded` or `rejected`; the SDK replaces its confirmed snapshot and
preserves those outcomes as local notices.

Joining or rejoining a group first delivers its queued commands, so a leave
whose response was lost reaches the server before the rejoin. Rejoining keeps
unreviewed notices. Once a synchronized snapshot shows this identity's access
is active, the SDK drops any join it was still retrying.

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
[ADR 0010](./adr/0010-derive-group-lists-from-snapshots.md).

## Invite links

Every group has exactly one current invite link, shared as `{app}/j#{code}`
with a 12-character code of letters and digits (ADR 0024). The client generates
the code before creation or regeneration so retries reuse it. The D1
`invite_codes` table maps each code's hash to its group, written by
`InviteIndex.claim` before the group stores the code and kept after
replacement, so `POST /invites/preview` can find the group from the code alone
and still report a replaced link; a code already opening another group is
refused with 409. Groups created before keep their
`{app}/join/{groupId}#{token}` link and 43-character token until it is
replaced. The server retains the current token in
the authoritative group snapshot and its hash for redemption checks. Every
participant receives the same usable link in authenticated creation, join,
and synchronization responses, and caches it with the group for offline
sharing. Regeneration replaces the link for everyone through normal
synchronization; links never expire with time. There is no standalone revoke
action. Public previews, audit history, and SDK diagnostic logs omit tokens.

`PUT /groups/{groupId}/invite` replaces this single resource and returns 200
with current metadata. A retry reuses the client-generated invite id and token;
retrying an older replacement never overwrites a newer link. The SDK exposes
this as `regenerateInvite(groupId)`.

`POST /groups` requires `invite: { invite_id, token }` alongside the group id,
group name, and creator member name. It creates the group, member, access
grant, and invite in one transaction and returns public invite metadata. The
sync SDK generates and saves the token before sending the request, then makes
the link available through `projected_snapshot.invite.token`; callers supply
only the group and member names. A retry returns the original creation result
without replacing a newer invite.

A new identity previews the group with the token, then joins with it and
either an existing member or a new one. An identity that left rejoins without
a link. Regenerating a link never removes access it already granted. See
[ADR 0015](./adr/0015-share-the-current-invite-through-group-snapshots.md).

## Realtime announcements

`GET /groups/{groupId}/realtime` upgrades to a WebSocket. Because browsers
cannot set headers on WebSockets, the client offers two subprotocols:
`splitnext.v1` and `splitnext.auth.v1.<device secret>`. The server selects
`splitnext.v1`, rejects identities that lack access or have left the group,
and closes a subscription with code 4403 when its identity leaves.

The revision message is `{ "type": "revision", "revision": n }`, sent on
connect and after every applied change. It is a hint, not state: the SDK
synchronizes through the normal snapshot path when the announced revision is
newer than its confirmed one. The announcement on connect makes every
reconnect a catch-up, so missed, duplicate, or reordered messages are
harmless. Synchronizations are serialized per group, so a burst of
announcements costs at most one extra request. See
[ADR 0008](./adr/0008-announce-revisions-over-hibernatable-websockets.md).

Separate `{ "type": "presence", "identity_ids": [...] }` messages identify
connected participants, deduplicating their tabs. The SDK exposes the current
roster through `client.presence(groupId)` and `on_presence_change`; a
disconnected client returns `null` for unknown presence. These updates do not
advance revisions or write snapshots or audit history. Abrupt network loss is
reflected when the server detects the disconnect.

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
client projection apply, its target, intent completion, retry intent, and
audit change. A new command is that file, its
entries in `groupCommandSchema`, `registered`, and `groupCommandTypes`, its
notice wording, and one app action; the registry's type rejects a missing or
mismatched entry, and the notice wording is an exhaustive switch. Each command
keeps one name everywhere: the `groupCommandTypes` key, such as
`removeMember`, names its app action, and its value, such as
`member.remove`, is the wire type.

`MemoryClientStorage` is useful for tests. `IndexedDbClientStorage` is the
atomic browser adapter used by the app. React Native can provide a SQLite
adapter at the same opaque storage seam.

Realtime connections go through the same kind of seam: `browserWebSocket` is
the default `RealtimeSocketFactory`, and tests or other platforms can supply
their own.

The client persistence module validates its versioned document and serializes
updates so concurrent client instances and in-flight synchronization cannot
discard newly queued intent. Startup upgrades saved pre-shared-invite
documents automatically while retaining identities, pending edits, and
retries. A device without the saved link token needs one connection to fetch
its group's current snapshot for that upgrade; failed attempts preserve the
original data.

The SDK owns notice retries through `retryNotice(groupId, commandId)`. It
creates fresh command identifiers and rename preconditions from the current
projection, retaining that intent and retiring the old notice in one atomic
storage update. Ordinary retries work offline; retrying a leave must start
online. The app uses this SDK operation.

`SplitnextSyncClient.installationState(groupIds)` returns group summaries,
notice counts, and requested replicas from one local storage read. The app
uses it to publish consistent state without reparsing the entire installation
once per group. Pending responses reread current storage before publication so
newer local work takes precedence.

SDK failures distinguish network, server, protocol, storage and offline causes
through `clientErrorKind(error)`. Cached identity and queued-command fallback
apply only to `SplitnextNetworkError`. Invalid server replies are observable
as `protocol_error` in SDK transport diagnostics; storage and programming
failures are surfaced rather than marked offline.

HTTP and memory transports run the same contract suite for input validation,
access and invite failures, replacement, directory discovery, idempotency and
lost sync responses. Failure status mapping is shared with Worker routes;
memory transports keep independent device identities over the same isolated
server state.

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
server, SDK, and app. Display ordering and presence markers live in the app
model; devtools input choices also live in the model.

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

Repayments are explicit versioned settlement records in the group snapshot. They use the same durable outbox and command rules as expenses, contribute only to balances, and retain both member references even when removed. Settle up derives the fewest deterministic transfers from each currency's net balances and provides a catalog-backed review form.

Settlement edits preserve the version opened by the editor. Removal and restoration retain the recorded amount and both member references, following the expense command lifecycle.

Activity is read through GET /groups/{groupId}/activity after group authorization. The SDK caches validated history independently of snapshots and preserves the newest complete sequence when requests race. The Activity panel refreshes on group revisions, excludes preferred-member selection, and offers restoration for removed monetary records.

Undo is a retry-safe change.undo command naming a canonical audit event. The server resolves that event inside its transaction; clients project it from their cached history. Expense and settlement reversals compare the affected record version and restore the exact saved details, increasing the version. Each reversal appends a change.undone event with a link to its source, and can itself be reversed. Unrelated state changes do not affect eligibility.

Group renames compare their affected state and the latest audit event for that target, including intervening changes that returned to an earlier value. Member actions and earlier member reversals have no reversible effect: Activity offers no Undo and the shared client/server rules reject `change.undo` for them. Restoring a member remains a separate manual action. Group creation, access changes and invite replacement have no reversal.

The Activity bell refreshes canonical Activity for the open group on each new revision while connected (`useActivityFeed`). It counts visible events from other identities after the installation's seen sequence for that group, plus the replica's conflict notices. `AppUiState.activitySeen` keeps seen sequences per group in localStorage through a `SeenStorage` adapter; the first Activity read for a group sets the baseline, so existing history never counts as new. `markActivitySeen` advances it. Conflict notices are reviewed in Activity's Needs your review block, and affected expenses and repayments show a dot; nothing else shows review status. Sync errors and outbox indicators stay independent.
