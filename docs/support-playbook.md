# Support playbook

The public privacy policy and beta terms live in
[`apps/client/src/legal.ts`](../apps/client/src/legal.ts) and are served at
`/privacy` and `/terms`. Change them there, in the same slice as any change to
what the app stores or logs.

## Channel

Email `support@splitnext.online` (the `supportEmail` constant) is the official
channel for bug reports, deletion requests and support decisions, so they stay
searchable. Feedback in chats is fine, but ask for anything that needs a
decision to be sent by email.

Announce new releases, known issues, serious incidents and any action users
must take by email to beta testers.

## What to promise

> Splitnext is a free app maintained as an independent project. I read every
> support request and do my best to respond, but response times are not
> guaranteed.

> Splitnext is in public beta. I monitor serious issues and fix them on a
> best-effort basis, but the app may occasionally be unavailable, delayed, or
> buggy.

> Splitnext helps groups keep track of shared costs. It does not move money,
> hold funds, process payments, do accounting, or give financial advice.

Treat beta data as real user data: best-effort preservation, recovery and
deletion, with no uptime guarantee or compensation.

## Bug reports

Ask for:

- What happened, and what they expected.
- Browser, device and OS version.
- Approximate time.
- Whether it affects one group or all of them.
- The **Copy diagnostics** report from devtools (`/app?devtools`). It carries
  identity, group and request ids but no names or amounts; search the Worker
  logs for its request ids.

Do not ask for screenshots of a group's expenses unless the diagnostics are not
enough.

## Wrong balances

Treat a wrong balance or repayment suggestion as high priority. Ask for the
smallest sequence of actions that reproduces it, with made-up numbers where
possible. If it is confirmed and can affect other groups, fix it as an
emergency and write a short incident note after the release.

## Monitoring boundary

Monitoring is operational, not behavioral: errors, request outcomes, release
health and user reports. Never log or collect names, descriptions, amounts,
invite codes, keys, or per-screen behavior. `src/requestLog.ts` enforces this
for request logs.

## Deleting a group

Leaving a group only hides it on that installation. Erasing a whole group needs
an operator, and there is no tool for it yet: until there is, write down the
request and handle it by hand only with an explicit owner decision, since it
changes remote data.

Ask for:

- The group's invite link.
- The group name and at least two people's names in it.
- Confirmation that deletion removes the group for everyone.

Delete only when the link opens that group and the names match. If authority
is unclear, for example someone else in the group objects, do not delete until
it is resolved. Record each decision: date, group id, what was checked, and
what was done.
