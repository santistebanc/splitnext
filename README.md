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
- `/openapi.json` and `/docs` expose the generated API contract and console.
- `/dashboard/` provides a small browser tester for the implemented endpoints.

The older member-bound capability API was intentionally removed. Group reads,
additional members and access grants, expenses, and synchronization are not
implemented yet.

## Run locally

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open `http://localhost:8787/` for the control room or
`http://localhost:8787/docs` for the API reference.

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

Run all checks:

```bash
npm run check
```

## Cloudflare resources

- D1 stores global identities and devices.
- Each created group has its own `GroupObject`. Its private SQLite database is
  the authoritative consistency boundary for group state, access, and history.
- Remote deployment has not been performed. `wrangler.jsonc` still contains a
  placeholder D1 database id.
