# Expense recovery verification

## Observable contract

This contract was drafted from the accepted offline-first behavior before inspecting
the implementation. One Save submits one expense intent, not one expense per HTTP
attempt. A draft is not submitted until Save is invoked.

- **Locally saved:** the outbox transaction completed. Show the expense and, when
  disconnected, one change saved here. This survives reload in the same installation.
- **Synchronized:** the authoritative store contains one expense and one applied
  creation event; both clients eventually show it and have empty durable outboxes.
- **Retry:** connection Retry redelivers saved intent with its original identifiers.
  It is different from saving a new draft or retrying a rejected conflict notice.
- **Reload:** committed local work survives; unsaved drafts need not survive.
- **Lost response:** server commit followed by response loss retains local intent;
  reload/reconnect/retry produces one expense, not two.
- **Persistence failure before enqueue:** Save fails visibly, the editor retains
  its values, no saved-here count is added and no expense reaches the server.
  Reload may discard that unsaved draft. Restoring storage permits a fresh Save.
- **Failure persisting acknowledgment:** already saved intent remains retryable;
  it must not be erased just because the server may have committed it.

Assumptions: eventual connectivity, available storage, unchanged group access and
valid expense input. Browser transaction completion is the durability boundary;
cleared/evicted browser storage, hardware loss and recovery onto another installation
are outside this promise. No new account/recovery policy is implied. The experiment
does not yet inject acknowledgment-persistence failure or server disk failure.

## Reproduce

Prerequisites: Node with `node:sqlite`, `npm ci`, and
`npx playwright install chromium`. From a clean checkout:

```sh
npm run verify:expense-recovery
```

The command builds current sources, uses two real headless Chromium profiles and
a fresh local Worker store under `.wrangler/lab/v-RUN_ID`. Keeping the state path
short avoids the Windows SQLite path limit; metadata and command logs remain in
`.wrangler/verification/private/RUN_ID`.
Use executable help/discovery for scenario and control commands. The optional
`--built` mode checks both production inputs and every built asset against the
build stamp; missing, changed or stale files fail. Full e2e uses this mode after
the enclosing fresh build, so expense recovery does not build twice.
Port 8857 must be free; an occupied port fails rather than reusing a service.
No production data or port 8787 is used. Only owned processes are stopped. Retained
profiles contain disposable credentials; do not publish them.

The lab's process/profile ownership and network gates are reused after inspection.
Its convergence predicate is not the oracle: assertions read rendered UI, IndexedDB
and stopped-Worker SQLite. Offline and dropped responses are controlled faults,
not claims about physical packet loss. IndexedDB and reload run in Chromium, not
an in-memory state simulation. Storage failure aborts a real browser transaction.
The lab's browser reload temporarily permits shell traffic while its API gate
stays offline. This proves restoration from real IndexedDB after a page reload;
it does not verify service-worker caching or app-shell startup without a network.
Oracle controls corrupt isolated observation inputs. The separate `controls`
command deliberately erases the actual saved outbox in disposable IndexedDB after
the app reports Save success, then reloads the ordinary app. Acceptance requires
the named `outbox-survives-reload` assertion to fail after injection and cleanup to
complete; a missing fixture, unrelated exception or timeout cannot count as a
detected product failure. Its inner evidence stays failed, with an explicit
negative-control label. Product sources and unrelated stores are unchanged.
Recovery waits are bounded at 90 seconds, allowing the app's capped background
backoff; browser interactions have a separate 15-second bound.
Evidence records exact HEAD, dirty patch and untracked source hashes, built asset
hashes, environment, fixture, store paths, checkpoints and control outcomes. A failure
writes failed evidence; missing fixtures/stores and incomplete checkpoints fail.
The runner writes not-run evidence before setup, and blocked evidence on build
failure. Only an allowlisted summary is published in
`.wrangler/verification/public/RUN_ID.json`; full patches, errors and state stay
private. Inspect a result with the executable `evidence` command, which rejects
a mismatching source identity. Normal exit, signals and bounded command timeouts
stop owned processes; a host crash cannot guarantee cleanup or artifact upload.
