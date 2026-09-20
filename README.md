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
- `/openapi.json` and `/docs` expose the generated API contract and console.
- `/dashboard/` provides a small browser tester for the implemented endpoints.

The older member-bound group capability API was intentionally removed before
the new offline-first group and synchronization model is built. Group access,
ledger members, expenses, and synchronization are not implemented yet.

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

Run all checks:

```bash
npm run check
```

## Cloudflare resources

- D1 stores global identities and devices.
- `GroupObject` is currently a minimal SQLite Durable Object shell used by the
  readiness probe. Later slices will make each instance the consistency boundary
  and source of truth for one group.
- Remote deployment has not been performed. `wrangler.jsonc` still contains a
  placeholder D1 database id.
