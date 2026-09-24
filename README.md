# Splitnext MVP

Splitnext is an offline-first group ledger foundation built on Cloudflare
Workers, D1, and one SQLite Durable Object per group. The current MVP handles
groups and ledger members only; invitations and expenses are intentionally
deferred.

## What works

- Anonymous device identities backed by D1.
- Retry-safe group creation with a client-generated group id.
- Direct group joining by id, including initial preferred-member selection.
- Offline-capable group rename and member add, rename, and archive commands.
- Nonexclusive preferred-member selection (the member the UI calls “you”).
- Leaving and rejoining a group without revoking its permanent access grant.
- Ordered, idempotent outboxes and full revisioned server snapshots.
- Rejected or superseded command notices stored by the client.
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

1. Initialize two independent device identities.
2. Create a group from Device 1 and join it from Device 2.
3. Toggle either device or the simulated server offline.
4. Queue optimistic changes while offline.
5. Watch request traffic, command outcomes, snapshots, and replica convergence.

Run the complete verification suite with:

```bash
npm run check
```

## Synchronization contract

`POST /groups/{groupId}/sync` receives the client's last confirmed revision and
its ordered outbox. Each command has a stable client-generated id. The server
processes the batch in order and returns an immutable outcome for every command
plus a complete authoritative snapshot whenever state may differ.

The client retains its outbox when transport fails. If the server applied a
command but the response was lost, retrying the same command id returns the
stored outcome without applying the change twice. Concurrent intent conflicts
are returned as `superseded` or `rejected`; the SDK replaces its confirmed
snapshot and preserves those outcomes as local notices.

## Client SDK

The low-level transport validates shared request and response contracts. The
stateful client owns identity initialization, confirmed snapshots, optimistic
projections, ordered outboxes, reconciliation, and conflict notices:

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
```

`MemoryClientStorage` is useful for tests and the dashboard.
`JsonClientStorage` works with a browser-like string key-value store. A future
PWA can provide IndexedDB and React Native can provide SQLite without changing
the synchronization module. `ClientReplicaStore` serializes local replica
changes so concurrent mutations and in-flight synchronization cannot discard
newly queued intent.

## Storage seams

- D1 stores global access identities and device credentials.
- `DurableObjectGroupRepository` transactionally persists current group state,
  audit events, command outcomes, and join outcomes in normalized SQLite tables
  inside that group's Durable Object.
- `MemoryGroupRepository` runs the same group engine without Cloudflare and is
  used for fast tests with the same commit and rollback behavior.
- Client storage is accessed only through `ClientStorageAdapter`.

The dashboard delegates its experiment state to `SyncLab`, which can be tested
without a browser. In local development, its server panel reads the current
Durable Object state through debug-only inspection routes; those routes return
404 unless `ENABLE_DEBUG_INSPECTION` is enabled.

The pure command transition rules are shared by the server and the optimistic
client projection. Cloudflare storage and client-local persistence remain
separate implementations.

## HTTP surface

- `GET /health`
- `GET /ready`
- `POST /identities/anonymous`
- `GET /identity`
- `POST /groups`
- `POST /groups/{groupId}/join`
- `POST /groups/{groupId}/sync`
- `GET /openapi.json`
- `GET /docs`

Direct joining is suitable for this private MVP tester, but knowing a group id
is currently enough to join. Invitations should replace it before public use.

Remote deployment has not been performed. `wrangler.jsonc` still contains a
placeholder D1 database id.

## Project documentation

- [Domain language](./CONTEXT.md)
- [Accepted product behavior](./docs/product-spec.md)
- [Architecture decisions](./docs/adr/)
- [Agent working agreement](./AGENTS.md)
