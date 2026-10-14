# Dispatch app actions through one caller-agnostic catalog

Everything a person can do in the client is an app action in one catalog: a
name, a description, a zod input schema, declared preconditions, an optional
confirmation message, and an implementation over `AppController`. Every caller
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
navigation state. Screens change data only by dispatching actions and read
state from the controller. Lifecycle work that no person initiates (startup,
background refresh, and following the browser's online state) stays on the
controller. Navigation-only state (which sheet is open) stays outside the
catalog. App actions are distinct from
commands: one action may submit a command, make a direct request, or only
change local state.
