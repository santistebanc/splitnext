# Splitnext MVP

Splitnext is an offline-first group ledger foundation built on Cloudflare
Workers, D1, and one SQLite Durable Object per group. The current MVP handles
groups, invite links, and ledger members with offline synchronization and
realtime revision announcements; expenses are intentionally deferred.

## What works

- Anonymous device identities backed by D1.
- Retry-safe group creation with a client-generated group id.
- Joining through a reusable invite link with a preview of the group, then
  choosing an existing member or joining as someone new.
- One current invite link per group, with a chosen expiry (1 hour to 30 days),
  replacement, and revocation. Only token hashes are stored.
- Offline-capable group rename and member add, rename, and archive commands.
- Nonexclusive preferred-member selection (the member the UI calls “you”).
- Leaving and rejoining a group without revoking its permanent access grant.
- A per-identity list of accessible groups, marking the ones it left, backed
  by a derived D1 index and cached by the SDK for offline use. A device that
  lost its storage can list its groups and fetch any of them again.
- Ordered, idempotent outboxes and full revisioned server snapshots.
- Rejected or superseded command notices stored by the client.
- Realtime revision announcements over hibernatable WebSockets, with automatic
  background synchronization, reconnection, and catch-up in the SDK.
- A stateful TypeScript client SDK with swappable local storage adapters.
- A server group engine with Durable Object and in-memory repository adapters.
- A visual `/dashboard/` synchronization lab for two independent devices and
  the authoritative server.

## Run locally

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open `http://localhost:8787/dashboard/`. The test lab lets you:

1. Add devices. Each one registers its own anonymous identity, like a fresh
   install; removing one discards its local data but not its server access.
2. Create groups from any device, create an invite link in a group, and join
   from another device by pasting the link and choosing who it is. Each device
   shows its groups as tabs, marking the ones it left, plus a "+ New" tab.
3. Toggle any device or the simulated server offline.
4. Queue optimistic changes while offline.
5. Watch changes reach the other device through realtime announcements, or
   turn a device's Live toggle off to see it fall behind and catch up.
6. Watch request traffic, realtime activity, command outcomes, snapshots, and
   replica convergence.

The server panel's **Reset data** button erases the D1 identity directory and
every group in the D1 identity-group index, then removes every device. The
server panel lists all indexed groups in tabs, including groups no current
device uses. It reads current names and state from each group's Durable Object.
These inspection and reset routes return 404 unless `ENABLE_DEBUG_INSPECTION`
is enabled.

Run the complete verification suite with:

```bash
npm run check
```

## Synchronization contract

`POST /groups/{groupId}/sync` receives the client's last confirmed revision and
its ordered outbox. Each command has a stable client-generated id. The server
processes the batch in order and returns an immutable outcome for every command
plus a complete authoritative snapshot whenever state may differ.

The client retains its outbox when transport fails. Edits made while the server
is unreachable resolve with the queued local state, as they would offline;
only server rejections and leaving a group report the failure. If the server applied a
command but the response was lost, retrying the same command id returns the
stored outcome without applying the change twice. Concurrent intent conflicts
are returned as `superseded` or `rejected`; the SDK replaces its confirmed
snapshot and preserves those outcomes as local notices.

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

A group has at most one current invite link, shared as
`{app}/join/{groupId}#{token}`. The creating client generates the token, so a
retried creation reuses the same link, and keeps the plaintext locally; the
server stores only its SHA-256 hash, and the Worker hashes tokens before they
reach the group's Durable Object. Every participant sees the link's creator
and expiry in the group snapshot, but only the creating device can show the
link again. Creating a new link revokes the previous one.

A new identity previews the group with the token, then joins with it and
either an existing member or a new one. An identity that left rejoins without
a link. Revoking or expiring a link never removes access it already granted.
See [ADR 0009](./docs/adr/0009-generate-invite-tokens-on-clients-and-store-hashes.md).

## Realtime announcements

`GET /groups/{groupId}/realtime` upgrades to a WebSocket. Because browsers
cannot set headers on WebSockets, the client offers two subprotocols:
`splitnext.v1` and `splitnext.auth.v1.<device secret>`. The server selects
`splitnext.v1`, rejects identities that lack access or have left the group,
and closes a subscription with code 4403 when its identity leaves.

The only message is `{ "type": "revision", "revision": n }`, sent on connect
and after every applied change. It is a hint, not state: the SDK synchronizes
through the normal snapshot path when the announced revision is newer than its
confirmed one. The announcement on connect makes every reconnect a catch-up,
so missed, duplicate, or reordered messages are harmless. Synchronizations are
serialized per group, so a burst of announcements costs at most one extra
request. See [ADR 0008](./docs/adr/0008-announce-revisions-over-hibernatable-websockets.md).

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
  currency_code: 'EUR',
  creator_member_name: 'Santi',
});

client.setOnline(false);
await client.addMember(group.group_id, 'Robin');
client.setOnline(true);
await client.syncGroup(group.group_id);

// Receive other devices' changes as they happen.
client.watchGroup(group.group_id);
```

`MemoryClientStorage` is useful for tests and keeps the dashboard ephemeral.
`IndexedDbClientStorage` is the atomic browser adapter prepared for a future
PWA. React Native can provide a SQLite adapter at the same opaque storage seam.

Realtime connections go through the same kind of seam: `browserWebSocket` is
the default `RealtimeSocketFactory`, and tests or other platforms can supply
their own.

The client persistence module validates its versioned document and serializes
updates so concurrent client instances and in-flight synchronization cannot
discard newly queued intent.

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

The dashboard delegates its experiment state to `SyncLab`, which can be tested
without a browser. In local development, its server panel reads the current
Durable Object state through debug-only inspection routes, including its
realtime subscribers. `GET /debug/groups` lists groups represented in the D1
identity-group index; `GET /debug/groups/{groupId}` reads one group's current
state; and `POST /debug/reset` clears every indexed group and identity. These
routes return 404 unless `ENABLE_DEBUG_INSPECTION` is enabled.

The pure command transition rules are shared by the server and the optimistic
client projection. Cloudflare storage and client-local persistence remain
separate implementations.

## HTTP surface

- `GET /health`
- `GET /ready`
- `POST /identities/anonymous`
- `GET /identity`
- `GET /identity/groups`
- `POST /groups`
- `POST /groups/{groupId}/join`
- `POST /groups/{groupId}/invites`
- `POST /groups/{groupId}/invites/preview`
- `POST /groups/{groupId}/invites/{inviteId}/revoke`
- `POST /groups/{groupId}/sync`
- `GET /groups/{groupId}/realtime` (WebSocket)
- `GET /openapi.json`
- `GET /docs`

Debug-only routes, hidden unless `ENABLE_DEBUG_INSPECTION` is enabled:

- `GET /debug/identity-directory`
- `GET /debug/groups`
- `GET /debug/groups/{groupId}`
- `POST /debug/reset`

Remote deployment has not been performed. `wrangler.jsonc` still contains a
placeholder D1 database id.

## Project documentation

- [Domain language](./CONTEXT.md)
- [Accepted product behavior](./docs/product-spec.md)
- [Architecture decisions](./docs/adr/)
- [Agent working agreement](./AGENTS.md)
