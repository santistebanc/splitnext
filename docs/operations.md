# Operations

How to release, watch and recover the deployed app. Every incident, near miss
or awkward release should leave one small improvement here.

Production deployment, remote migrations and remote data changes need an
explicit owner decision (see [AGENTS.md](../AGENTS.md#boundaries)).
Production still has a placeholder D1 `database_id` in `wrangler.jsonc`, so only
staging is deployed.

## Staging

`env.staging` in `wrangler.jsonc` is a separate Worker, `splitnext-api-staging`,
with its own D1 database (`splitnext-staging-index`) and group storage. Its
data is test data. Deploy a clean, committed checkout with
`npm run deploy:staging`: it builds the app, applies D1 migrations to staging,
and stamps the commit in `DEPLOY_SHA` (shown by `GET /health`). Run the
two-phone smoke test there before every production release.

## Monitoring

`wrangler.jsonc` turns on Workers Logs (`observability`), which keeps every
request log line and uncaught error. Find them in the Cloudflare dashboard
under Workers & Pages → `splitnext-api` → Logs, and search by the request ids
from a user's **Copy diagnostics** report.

- `event: "request"` lines carry route, status, duration, error code, identity
  and group ids, and synchronization outcomes. They never hold names, amounts,
  links or keys ([docs/architecture.md](./architecture.md#diagnostics)).
- `unhandled_error` lines are bugs. Look at them after every release.
- `client_error` lines are uncaught errors and rejections in browsers, sent to
  `POST /client-errors`: the error type, stack frames and page path, with the
  Worker's `revision`. Messages are left out because they can quote what
  someone typed. Each page sends at most five distinct reports.

Monitoring stays operational: no analytics on how people use the app. See
[the support playbook](./support-playbook.md#monitoring-boundary).

## Backups and restore

Data lives in two places, and both have Cloudflare point-in-time recovery for
the last 30 days (7 days for D1 on the free plan). Neither is a copy outside
Cloudflare.

**D1 (`INDEX`)** holds installations, device credential hashes, the groups list
index and invite code hashes. Restore it with Time Travel:

```sh
npx wrangler d1 time-travel info splitnext-v4-index --timestamp=<ISO time>
npx wrangler d1 time-travel restore splitnext-v4-index --bookmark=<bookmark>
```

A restore replaces the whole database. Rows written since then are lost, so
devices that joined after that point lose access until they open an invite
link again.

**Group Durable Objects (`GROUPS`)** hold each group's members, expenses,
repayments, Activity and invite. They are authoritative. SQLite-backed Durable
Objects support point-in-time recovery through `ctx.storage`
(`getBookmarkForTime`, then `onNextSessionRestoreBookmark` and a restart), one
group at a time. `GroupObject` has no operator route for this yet, so a group
cannot be restored today.

A restore rehearsal is a beta launch requirement:

1. Add an operator-only way to restore one group to a bookmark.
2. On a non-production deployment, create a group, add expenses, note the time,
   then remove some of them.
3. Restore the group and D1 to the noted time.
4. Check that both phones see the earlier state after synchronizing, and that
   Activity and balances agree.
5. Write down the steps and how long they took here.

## Release checklist

Copy this into the release notes or the pull request.

Before:

- [ ] CI is green on the exact commit being released.
- [ ] New D1 migrations work with the app version currently in use, since
      installed apps keep running the old version until they reload. Apply
      them with `npm run db:migrate:remote` before deploying code that needs
      them.
- [ ] `apps/client/src/legal.ts` still describes what is stored and logged.
- [ ] Rollback plan written: the previous Worker version to roll back to
      (`npx wrangler rollback`, or Deployments in the dashboard), and whether
      any migration or data change would need a restore.
- [ ] Owner has approved the deploy.

Deploy with `npm run deploy`, then run the smoke test.

After:

- [ ] Smoke test passed on two real phones.
- [ ] No new `unhandled_error` lines and no unusual 5xx rate in Workers Logs
      for the first hour.
- [ ] Support inbox checked.
- [ ] Release announced to beta testers if it changes what they see.

## Two-phone smoke test

Use two real phones, ideally one iPhone (Safari) and one Android (Chrome),
each with a fresh browser profile or private window.

1. **Phone A:** open the homepage. Privacy, Terms and the support email work.
2. **Phone A:** open the app, create a group with your name, add a second
   person.
3. **Phone A:** share the invite link to Phone B.
4. **Phone B:** open the link, see the group preview, join as someone new.
5. **Phone A:** add an expense shared by everyone. **Phone B** sees it and the
   balances without reloading.
6. **Phone B:** edit the expense to split by exact amounts. **Phone A** sees the
   change, and Activity shows who made it.
7. **Phone A:** remove the expense, then undo it from Activity.
8. **Phone B:** record a suggested repayment from Settle up. Both phones agree
   on balances.
9. **Phone A:** turn on airplane mode, add an expense, close and reopen the
   app. It opens the group and shows the offline strip and the new expense.
10. **Phone A:** turn airplane mode off. The expense reaches **Phone B**.
11. **Phone B:** leave the group, then rejoin through the link.
12. **Phone A:** add the app to the home screen and open it from there.

Any failure blocks the release unless the owner accepts it in the release
notes.

## Incidents

Write a short note in `docs/incidents/` for anything involving real user data,
privacy or security, a rollback or hotfix, a failed migration, or a confirmed
wrong balance: what happened, impact, how it was found, the fix, and what
changes to prevent it.
