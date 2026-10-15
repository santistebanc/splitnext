# Dispatch app actions through one caller-agnostic catalog

Everything a person can do in the client is an app action in one catalog: a
name, group, description, zod input schema, declared preconditions, an optional
confirmation message, and an implementation over `AppController` and shared
`AppUiState`. Every caller
(UI events, a future assistant, RPC, tests, the component workbench) invokes
actions through the same `dispatch(name, input, options)`, which validates the
input, checks preconditions, and returns an `Outcome` value instead of throwing.
The layer never knows or branches on who called it; caller-specific behaviour
lives in thin adapters around it. We chose this so the app's capabilities can
later be driven by an assistant or a remote client with exactly the guarantees
the UI has, without a second implementation.

Confirmation is a result, not a dialog: an action that declares one returns
`needs_confirmation` with its message unless the call carries `confirmed: true`.
Each caller decides how to obtain approval (the UI's inline confirm, an
assistant asking the person, an RPC client relaying it), while the rule itself
is enforced in one place. Callers may pass an `origin` label for future audit
attribution; it is carried, never used to change behaviour.

## Considered options

- **Expose `AppController` methods directly to every caller.** Rejected: no
  discoverable catalog, no shared input validation, and online or confirmation
  rules stay duplicated in screens.
- **Drive an assistant through the server API.** Rejected: it bypasses the
  client's offline outbox, this installation's preferred member, and conflict
  notices, so an assistant would not act as the person would in the app.

## Consequences

`AppController` remains the engine for synchronization, storage, and
group selection. The dispatcher owns an observable `AppUiState` for views,
form drafts, join choices, member editors, visibility toggles, copied-link
feedback, and pending confirmations. Screens read that state and dispatch the
same actions exposed in devtools; opening settings from either caller changes
the actual visible view. Lifecycle work that no person initiates (startup,
background refresh, and following the browser's online state) stays on the
controller. Browser history and clipboard/share operations use thin platform
adapters. Browser Back/Forward dispatches a restoration action rather than
changing component state directly. Navigation remains local; these UI actions
do not become server commands or enter the offline outbox.

The catalog groups actions by primary purpose: UI, Ledger changes, and
Access & sync. Ledger changes can enter the offline outbox; Access & sync
requires a connection. UI includes navigation, drafts, local review state,
device copy/share, and confirmation decisions, even when navigation fetches
a group or approval runs another action. Submission actions belong to the
operation they perform. Devtools uses these three groups without secondary
domain categories or an All tab, placing available actions before unavailable
ones in each list. A default Suggested tab shows all available contextual next
steps across the groups, ordered by priority without a fixed count limit.
Group steps include editing and removing any active member, including you,
alongside inviting, adding members, choosing you, settings, and returning to
groups. Removal inputs default to another member when available, retaining the
current you as a choice; removal remains suggested when you are the only member.
The workflow machine derives candidate steps and
their base ranks from the current phase and local focus (group/list, member
editor, or confirmation). Actions declare their corresponding step; the
catalog filters candidates through the same availability guards used by
dispatch and adjusts priorities using drafts, member selection, connection,
and group data. View/phase checks are not repeated in action suggestion rules.
Pending confirmations take priority; pending submissions suggest no ordinary
steps, while an invite check can still suggest returning to groups.
Ordinary draft/history actions remain in the full groups. `describe()` exposes
the current suggestion rank so callers can use the same rules. Devtools browses
actions by tab without a search field.
`changeDraft` identifies a field instead of adding
one action per keystroke or per field. Confirm/cancel actions refer to one
pending request and recheck the original action's preconditions when approved.
Failed saves retain their draft; delayed invite previews cannot reopen a
closed view or replace a newer link. App actions are distinct from
commands: one action may submit a command, make a direct request, or only
change local state.

The same catalog provides read-only availability checks for connection and
group requirements, open forms and drafts, current choices, pending
confirmations, and platform capabilities. `describe()` includes state-level
availability; `availability(name, input)` also validates proposed inputs.
Dispatch enforces these checks again, including the original action when
approving a pending confirmation. Availability is a local preflight: server
rejections and transport failures still return normal action outcomes.
Devtools fades unavailable actions while keeping them selectable for
inspection, disables Dispatch/Approve, and shows a short reason. Offline
ledger edits remain available through the outbox.

UI workflows use a small TypeScript state machine in `model/workflow.ts`,
with typed view/phase combinations and one pure transition function. The
catalog declares workflow intents; availability and execution evaluate the
same transitions. Group data, drafts, connection status, and device
capabilities remain separate context and guards, avoiding a combined state
for every possible connection/view/data combination.

Creation, joining, and settings saves enter shared pending phases before
awaiting work. Duplicate submissions, draft edits, and navigation wait until
the request settles; failures restore the preceding phase and retain drafts.
Direct create/join operations use the same lifecycle without requiring a form
to be opened. Ordinary ledger commands remain independent of UI workflows and
can still queue offline. Invite checking permits navigation and link edits;
request identifiers prevent obsolete success/failure responses from changing
the newer workflow or selecting an obsolete group. `AppUiState` owns context
updates and transitions rather than exposing arbitrary view/draft patches.
Devtools State shows the current phase and request id.

We use a reducer and typed states rather than a state-machine framework: this
keeps the existing dispatcher interface and makes the rules directly testable
without introducing another runtime or modeling synchronization as UI state.

Snapshot queries are shared with the server and SDK through pure domain
selectors. Display ordering and transient presence formatting remain in the
app model. State-backed action input choices live beside the catalog and are
exposed by `inputOptions(source)`; devtools only renders those choices.

The SDK owns notice retries through `retryNotice(groupId, commandId)`. It
creates fresh command identifiers and rename preconditions from the current
projection, retaining that intent and retiring the old notice in one atomic
storage update. Ordinary retries work offline; leaving still needs a server
decision. The app and dashboard use the same SDK operation.

The workbench replaces handwritten command projections with the real
controller and SDK over a memory transport backed by `GroupStore` and
`MemoryGroupRepository`. Scenario state and presence are fixtures; ledger
behavior, notices, retries, and complete screen workflows are production
logic. Fixture transports never contact the server or installation storage.

Direct create/join actions and form submissions call the same internal
operations, using shared input schemas, normalized values, and workflow
lifecycles. Separate action names describe the different entry points without
duplicating the operation. Rename drafts retain the expected name captured
when editing began.

Pending action executions are observable and shared across callers. The
catalog declares affected resources so direct mutations and draft submissions
use the same busy guards. Member saves protect the editor and target while
unrelated ledger edits remain available, including offline. Resource guards
release after success or failure. `stateActionMap()` exposes the current
workflow, evaluated completion edges, action metadata and availability,
suggestion ranks, and pending executions. Devtools renders it in the Map tab;
there is no separate transition table to maintain.

The dispatcher runs the declared submission lifecycle automatically. Action
implementations only resolve their input and perform the operation; they do
not repeat the workflow intent or pending/success/failure setup. The declared
intent therefore drives preflight, execution, and map inspection together.

Confirmations retain their original selected group and navigation revision.
Approval after that context changes requires a new confirmation. A completed
leave or leave retry only clears the selection it started in; later group
selection and panel navigation take precedence. Diagnostic observers cannot
change action outcomes or prevent other observers from receiving them.

The controller owns foreground, reconnect and automatic refresh scheduling.
Concurrent refreshes share one promise; connectivity changes during a request
request at most one follow-up. Online/offline state changes immediately, even
while a request is pending. Retry timers back off from 10 to 60 seconds while
network reachability or queued work requires it, and stop on disposal or an
actionable non-network failure. Browser events only forward lifecycle signals.

Each dispatch has a UUID, duration, original group, before/after workflow,
and optional parent invocation for approval. The controller binds that context
explicitly per invocation; concurrent work never shares mutable attribution.
The SDK publishes metadata-only command/request/result diagnostics, using the
same request ID as its HTTP transport. Command outbox entries retain optional
invocation IDs locally through offline reload and delivery; metadata is never
sent as part of a domain command or recorded in the server audit. Diagnostics
omit credentials, links, request inputs and server-state contents. Devtools
Log shows action and SDK records; dashboard exchanges show matching request,
command and invocation IDs. Each devtools stream retains at most 100 entries,
and Clear removes both streams. Coalesced refresh callers share refresh work;
request attribution identifies the callers present when that work began.
