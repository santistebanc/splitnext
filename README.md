# Splitnext API

Splitnext is an offline-first shared-expense API built on Cloudflare Workers,
D1, and one SQLite Durable Object per group. Development proceeds in small,
reviewable vertical slices.

## Current implementation

- `GET /health` reports Worker liveness.
- `GET /ready` checks D1 and Durable Object storage.
- `POST /identities/anonymous` idempotently creates an anonymous access identity
  and device from a client-generated secret.
- `GET /identity` authenticates `Bearer v1.<device-secret>` and returns the
  current identity and device.
- `POST /groups` atomically creates a group, its first ledger member, the
  creator's permanent access grant and preferred-member selection, and the first
  audit event inside one SQLite Durable Object.
- `POST /groups/{groupId}/sync` accepts the client's known revision and queued
  commands. It returns a consistent full snapshot whenever state may differ,
  or a small `unchanged` response when the client is current.
- The same sync endpoint accepts retry-safe `member.create` commands, applies a
  batch in order, and returns an immutable outcome for every command.
- `member.rename` includes the name seen by the client as an intent-specific
  precondition, so a stale offline rename is reported instead of overwriting a
  newer name.
- `member.archive` preserves the member and history, clears every access
  identity that preferred it, and makes its name available to a new active
  member.
- An authorized identity can rotate the current seven-day reusable group link.
  A second identity can redeem it once for permanent access while selecting or
  creating its preferred member.
- `/openapi.json` and `/docs` expose the generated API contract and console.
- `src/client` provides a typed SDK for system checks, anonymous identity setup,
  authenticated group operations, invite redemption, and synchronization. It
  owns request construction, authentication, structured errors, transport
  observation, and response validation against shared schemas.
- `/dashboard/` provides two independent simulated devices with separate
  identities, credentials, local snapshots, offline outboxes, and transport
  logs, alongside the latest observed Durable Object state and incoming data.
  The dashboard uses the SDK rather than calling `fetch` directly.

The older member-bound capability API was intentionally removed. Invite
disabling, preferred-member changes, expenses, and realtime hints are not
implemented yet.

## Run locally

```bash
npm install
npm run db:migrate:local
npm run dev
```

`npm run dev` builds the browser SDK before starting Wrangler. Use
`npm run sdk:build` directly when changing the SDK while Wrangler is already
running.

Open `http://localhost:8787/` for the control room or
`http://localhost:8787/docs` for the API reference.

To exercise offline reconciliation in the control room, create both identities,
create a group through Device A, then create a link and join Device B. Take one
device offline and queue several member commands while the other changes the
server. Choosing **Go online & sync** submits the complete outbox, retains it if
the request fails, and shows the returned outcomes and replacement snapshot.

Create an anonymous identity with a 32-byte base64url secret:

```bash
curl -i http://localhost:8787/identities/anonymous \
  -H 'Content-Type: application/json' \
  --data '{"device_secret":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}'
```

Authenticate that device:

```bash
curl -i http://localhost:8787/identity \
  -H 'Authorization: Bearer v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
```

Create a group using a client-generated UUID so retries remain idempotent:

```bash
curl -i http://localhost:8787/groups \
  -H 'Authorization: Bearer v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
  -H 'Content-Type: application/json' \
  --data '{"group_id":"31c1af48-9f97-4a91-ac72-3ae70d259a4d","name":"Berlin flat","currency_code":"EUR","creator_member_name":"Santi"}'
```

Bootstrap a local database from a server snapshot:

```bash
curl -i http://localhost:8787/groups/31c1af48-9f97-4a91-ac72-3ae70d259a4d/sync \
  -H 'Authorization: Bearer v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
  -H 'Content-Type: application/json' \
  --data '{"known_revision":null,"commands":[]}'
```

After saving the returned revision, send it on the next request. If it matches,
the server returns `unchanged`. A stale, missing, or impossible future revision
receives a complete replacement snapshot. Audit events are stored separately
inside the Durable Object and are not part of client synchronization.

Create a ledger member through the same sync operation:

```json
{
  "known_revision": 1,
  "commands": [
    {
      "command_id": "0617db99-f209-4d28-b4e5-2e748407474a",
      "type": "member.create",
      "payload": {
        "member_id": "8061a4e7-fc67-4502-87ac-f57404700a11",
        "display_name": "Alex"
      }
    }
  ]
}
```

Resending the identical command id returns its original outcome without adding a
second member or audit entry. Reusing the id with different input is rejected.

Rename a member without overwriting a concurrent rename:

```json
{
  "known_revision": 2,
  "commands": [
    {
      "command_id": "94047122-dfc2-48cc-9a62-b20a086fe2cc",
      "type": "member.rename",
      "payload": {
        "member_id": "8061a4e7-fc67-4502-87ac-f57404700a11",
        "expected_display_name": "Alex",
        "display_name": "Robin"
      }
    }
  ]
}
```

If the member is no longer named `Alex`, the outcome is `superseded` with the
current member state. If another command already renamed it to `Robin`, the
outcome is `no_effect` because the requested intent is already satisfied.

Archive a member without deleting its historical identity:

```json
{
  "known_revision": 3,
  "commands": [
    {
      "command_id": "682cc77c-56a3-4135-a5df-eb3eebd6d899",
      "type": "member.archive",
      "payload": {
        "member_id": "8061a4e7-fc67-4502-87ac-f57404700a11"
      }
    }
  ]
}
```

Any identity that preferred the archived member becomes unassigned. Repeating
the intent returns `no_effect`; retrying the same command id returns its
original outcome.

Run all checks:

```bash
npm run check
```

## Client SDK

The TypeScript source is exported from `src/client/index.ts`. A browser ESM
bundle is generated at `public/sdk/splitnext-client.js` for the dashboard:

```ts
const api = new SplitnextClient({ baseUrl: 'https://api.example.com' });
const session = await api.createAnonymousIdentity(deviceSecret);
const deviceApi = api.forDevice(deviceSecret);

const result = await deviceApi.syncGroup(groupId, {
  known_revision: localRevision,
  commands: pendingCommands,
});
```

The SDK deliberately does not choose a local database. The PWA and React
Native clients will provide platform-specific persistence adapters in a later
slice while sharing these contracts and deterministic domain rules.

## Cloudflare resources

- D1 stores global identities and devices.
- Each created group has its own `GroupObject`. Its private SQLite database is
  the authoritative consistency boundary for group state, access, and history.
- Remote deployment has not been performed. `wrangler.jsonc` still contains a
  placeholder D1 database id.
