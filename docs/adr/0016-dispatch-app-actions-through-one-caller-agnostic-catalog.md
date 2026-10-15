# Dispatch app actions through one caller-agnostic catalog

Everything a person can do in the client is an app action in one catalog: a
name, group, description, zod input schema, declared preconditions, an optional
confirmation message, and an implementation over `AppController` and shared
`AppUiState`. Every caller (UI events, a future assistant, RPC, tests, the
component workbench) invokes actions through the same
`dispatch(name, input, options)`, which checks preconditions and the input in
the same order as availability and returns an `Outcome` value instead of
throwing. The layer
never branches on who called it; caller-specific behaviour lives in thin
adapters. We chose this so the app's capabilities can later be driven by an
assistant or a remote client with exactly the guarantees the UI has, without a
second implementation.

Confirmation is a result, not a dialog: an action that declares one returns
`needs_confirmation` unless the call carries `confirmed: true`. Each caller
decides how to obtain approval, while the rule is enforced in one place.

`availability(name, input)` is the one answer to whether an action can run, and
dispatch enforces the same check. It evaluates, in order, the action's workflow
step, locks held by running actions, connection and group requirements, and the
action's own conditions. Screens disable a control only when its action is
unavailable or the control's own call is still running; a dependency a screen
needs is declared on the action, where devtools and other callers see it too.

## Considered options

- **Expose `AppController` methods directly to every caller.** Rejected: no
  discoverable catalog, no shared input validation, and online or confirmation
  rules stay duplicated in screens.
- **Drive an assistant through the server API.** Rejected: it bypasses the
  client's offline outbox, this installation's preferred member, and conflict
  notices, so an assistant would not act as the person would in the app.
- **Rank suggested next steps in the catalog.** Built, then removed: every new
  action had to choose a step and priority for a caller that does not exist
  yet. Add ranking when an assistant needs it.
- **Use a state-machine framework for UI workflows.** Rejected: a reducer with
  typed view/phase states keeps the dispatcher interface and is directly
  testable without another runtime.

## Consequences

`AppController` remains the engine for synchronization, storage, group
selection, and refresh scheduling; lifecycle work no person initiates stays
there. The dispatcher owns an observable `AppUiState` for views, drafts, join
choices, the member editor, and pending confirmations. Navigation stays local
and never enters the offline outbox.

Actions are grouped as UI, Ledger changes (which can queue offline), and
Access & sync (which needs a connection). Ledger-change actions submit one
`CommandIntent` through `AppController.submit`, so they use the same command
path as the SDK. One action may instead make a direct request or only change
local state.

UI workflows use one pure transition function in `model/workflow.ts`.
Submissions enter a pending phase before awaiting work and restore the previous
phase and drafts on failure; request identifiers keep obsolete responses from
changing a newer workflow. Actions declare locks they hold and locks they wait
for, so a save protects its editor and target while unrelated ledger edits stay
available, including offline. Navigation always waits for a running member save.
A navigation that changes the open group holds a lock every workflow step waits
for, so none starts on a view about to be replaced; switching panels within a
group is instant and holds nothing, which keeps their openers enabled to take
focus back. Because availability and the lock check run
synchronously when dispatch is called, a second click sees the first one's
locks. The UI state leaves a panel or member editor whose group went away, in
this tab or another, so that rule does not depend on which action ran last.

Confirmations remember their group and navigation revision; approving after
either changed requires a new confirmation, and approval rechecks the original
action's availability.

Each dispatch has an invocation id, duration, original group, and before/after
workflow, and the SDK carries the id on the requests and queued commands it
causes, through offline reload, without sending it to the server. Diagnostics
omit credentials, links, inputs, and server state. Observers cannot change an
outcome.

`test/appActions.test.ts` specifies these rules in detail, and
`test/actionModel.test.ts` dispatches generated sequences of every action the
way a generic caller would, checking that dispatch fails exactly when and why
availability predicts and that every view keeps its group; devtools show the
catalog, each action's availability and reason, the current workflow, running
actions, and the dispatch log.
