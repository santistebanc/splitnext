# Splitnext API

An API-only shared-expense application built on Cloudflare Workers, D1, and one
SQLite Durable Object per group. Development is intentionally split into small,
reviewable slices.

## Completed slices

### 1 — Cloudflare foundation

Implemented in this slice:

- TypeScript Cloudflare Worker;
- D1 binding and first migration;
- SQLite-backed `GroupObject` Durable Object binding;
- liveness endpoint at `GET /health`;
- dependency readiness endpoint at `GET /ready`;
- Worker-runtime tests and deployment dry-run.

### API framework and generated console

- Hono routing and CORS middleware;
- Zod-backed endpoint contracts and request validation foundation;
- generated OpenAPI document served at `/openapi.json`;
- interactive Scalar API reference and request console served at `/docs`.

### 2 — Create and retrieve groups

Implemented in this slice:

- validated group creation at `POST /groups`;
- capability-protected retrieval at `GET /groups/{groupId}`;
- server-generated group ids and 256-bit access tokens;
- one singleton `group_state` record inside the SQLite Durable Object selected
  by group id;
- a required creator display name and an initial member created for that person;
- SHA-256 token hashes linked to members in the Durable Object's
  `member_access` table—the plaintext token is returned only at creation;
- atomic creation of the group, creator member, and creator capability;
- creating-device checks using `Authorization` and `X-Device-User-Id`;
- OpenAPI documentation and Worker-runtime integration coverage.

### 3 — Update and delete groups

Implemented in this slice:

- capability-protected updates at `PATCH /groups/{groupId}`;
- capability-protected soft deletion at `DELETE /groups/{groupId}`;
- server-owned timestamps and monotonically increasing group versions;
- optimistic concurrency through `expected_version`;
- `409 version_conflict` responses for stale writes;
- deletion tombstones retained inside the group's Durable Object.

### 4 — Member lifecycle

Implemented in this slice:

- member creation at `POST /groups/{groupId}/members`;
- active-member listing at `GET /groups/{groupId}/members`;
- individual retrieval at `GET /groups/{groupId}/members/{memberId}`;
- member renaming at `PATCH /groups/{groupId}/members/{memberId}`;
- soft deletion at `DELETE /groups/{groupId}/members/{memberId}`;
- server-generated member ids, timestamps, and initial versions;
- optimistic concurrency and no-op detection for member mutations;
- deletion tombstones retained for future expense references;
- member records stored only in their group’s Durable Object;
- deletion of a member revokes every capability linked to that member;
- group capability checks on every member endpoint.

D1 currently stores only global application metadata. It remains available for
future cross-group discovery, but it does not own group records or capabilities.

Intentionally deferred: additional access and invites, expenses, balances,
activity history, and WebSockets.

## Review locally

```bash
npm install
npm run db:migrate:local
npm run dev
```

In another terminal:

```bash
curl -i http://localhost:8787/health
curl -i http://localhost:8787/ready
```

Or open `http://localhost:8787/docs` in a browser to inspect and test the API.

Create a group:

```bash
curl -i http://localhost:8787/groups \
  -H 'Content-Type: application/json' \
  --data '{"name":"Berlin flat","currency_label":"EUR","device_user_id":"device-1","creator_display_name":"Santi"}'
```

The response contains the `group`, its initial `member`, and an `access_token`
belonging to that member on the creating device. Use the group id and token with
the same device id to retrieve the group:

```bash
curl -i http://localhost:8787/groups/GROUP_ID \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'X-Device-User-Id: device-1'
```

Treat the access token like a password. The API stores its SHA-256 hash, not the
plaintext value, and cannot show the original token again. Deleting the member
that owns it also revokes that access.

Update the group using the latest version you received:

```bash
curl -i -X PATCH http://localhost:8787/groups/GROUP_ID \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'X-Device-User-Id: device-1' \
  -H 'Content-Type: application/json' \
  --data '{"expected_version":1,"name":"Lisbon flat"}'
```

Delete it using its current version:

```bash
curl -i -X DELETE \
  'http://localhost:8787/groups/GROUP_ID?expected_version=2' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'X-Device-User-Id: device-1'
```

Create a member inside the group:

```bash
curl -i http://localhost:8787/groups/GROUP_ID/members \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'X-Device-User-Id: device-1' \
  -H 'Content-Type: application/json' \
  --data '{"display_name":"Ada"}'
```

Expected readiness body after the local migration:

```json
{"ok":true,"checks":{"d1":true,"durable_object":true}}
```

Run all project checks:

```bash
npm run check
```

## Remote Cloudflare setup

Remote deployment is deliberately not performed by this slice. To prepare it:

1. Run `npx wrangler d1 create splitnext-v4-index`.
2. Replace the placeholder `database_id` in `wrangler.jsonc` with the returned id.
3. Run `npm run db:migrate:remote`.
4. Run `npm run deploy`.

Do not rename `GroupObject` after production data exists without declaring the
corresponding state transition in Wrangler's `exports` configuration.
