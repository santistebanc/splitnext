# Development, checks and testing

Moved from the README.

## Quickstart

```bash
npm install
npm run dev
```

`npm install` also points git at the tracked hooks in `.githooks/`. The
development command applies pending migrations to the local D1 database,
exports the Expo web client, and starts the API and server-rendered entry
pages on port 8787 with debug inspection on. It refuses to start while
something already listens on 8787, since a second server in one checkout
leaves both unresponsive.

- `http://localhost:8787/` is the homepage and `/app` the app.
- `/app?devtools` opens the in-app development panel; `/components` the
  design system catalog.
- For fast UI iteration, keep that Worker running and run `npm run app:dev` in
  a second terminal; Expo serves on port 8081 against the API on port 8787, and
  reloads SDK edits in `src/` without a restart.
- To try several devices by hand, open `/app` in separate browser profiles or
  a private window; tabs in one profile share an installation.

## Staging

The current web app is deployed at
[splitnext-api-staging.santistebanc94.workers.dev/app](https://splitnext-api-staging.santistebanc94.workers.dev/app).

`npm run deploy:staging` builds the client, applies pending migrations to the
separate staging D1 database, and deploys the staging Worker. It requires a clean
checkout and Cloudflare credentials. `/health` reports the deployed Git revision;
`/ready` checks D1 and the group Durable Object.

The staging environment is configured in `wrangler.jsonc`. The default
production environment still has a placeholder D1 database id and is not deployed.

## Checks

```bash
npm run check
```

runs everything: text encoding, the app build, generated Worker types, lint,
both TypeScript projects, a deploy dry run, the Worker tests, and the browser
tests. The Worker tests load the bundle the dry run writes to
`.wrangler/dry-run`, so run `npm test` on its own only after a check or a dry
run.

`npm run check:fast` runs everything except the app build and the browser
tests, against the last app build. The pre-push hook runs
it; when Git for Windows pushes a checkout inside WSL, the hook runs the checks
inside that distribution. Skip it once with `git push --no-verify`.
`.github/workflows/check.yml` runs the same boundaries on a fresh checkout for
every push to `main` or `master` and every pull request, and uploads only the
sanitized public verification evidence, also when it fails.

`npm run test:e2e` drives the built app in headless Chromium. It starts its
own Worker on port 8791 with separate local storage in `.wrangler/e2e-state`,
recreated on every run, so it does not touch `npm run dev` data. Install the
browser once with `npx playwright install chromium-headless-shell`; a failure
keeps a trace in `test-results/` that `npx playwright show-trace` opens.

### Verification

Start verification with `npm run verify -- help`. Machine-readable discovery is
`npm run --silent verify -- discover --json`; `doctor` checks local prerequisites.
The [feature map](../verification/features.json) names executable promises, their
expected checks, fidelity and limits. Agents use the
[repository verification skill](../.agents/skills/verify-splitnext/SKILL.md).

`npm run check:fast` includes verification contracts and deterministic architecture
checks. It runs the unchanged storage timing budget separately after the other
unit tests, with one worker. `npm run check` additionally builds and runs e2e,
including expense recovery and its real lost-outbox detector control. The scenario
validates and reuses that build; it does not build a second time. CI runs these
same boundaries in bounded check/browser jobs on Node from `.nvmrc`.

Two kinds of test measure time on the machine running them: the storage
budget and browser tests tagged `@timing`, which count animation frames. A
busy host can fail them while the app is fine. Tag a browser test `@timing`
when it needs a minimum number of frames or limits the change between
consecutive frames. `npm run check:steady` runs
the full check without them and `npm run check:timing` runs only them, after
a build, so a shared runner can wait for a quiet machine first. `check`,
`check:fast` and CI still run everything.

Only `.wrangler/verification/public/` contains intended publishable evidence.
Private logs, patches, profiles, traces, credentials and state remain under
`.wrangler/verification/private/` or the lab/test directories; CI never uploads
them. Failure messages stay private, since their values, locators and call logs
can hold credentials, URLs or personal data. Public results preserve check IDs,
statuses, source/build/data fingerprints and failure categories. For each failed
test, the CI log and evidence give its location, a failure kind (assertion,
test-timeout, error or unknown) with the matcher, action or error class and
timeout, the failing line of tracked source, and a command to reproduce it
locally. Titles are shown only when the source spells them out. Categories need
investigation rather than being proof that the product or environment is at fault.

## Showcase

```bash
npm run showcase
```

builds the app and drives it through every flow on a phone-sized screen.
It records a video of each flow, with steps and thumbnails that jump to each
moment, then writes `showcase/out/index.html` to open in a browser. Its
Conditional UI section spotlights every element that appears only in some
situation, such as an empty state, an offline or failure message, a conflict
to review, or a missing browser capability, forcing each one with offline
mode, failed or slowed requests, a second device, or a shifted clock. Like the
browser tests, it starts its own Worker, on port 8793, with fresh storage in
`.wrangler/showcase-state`. The flows live in `showcase/capture.spec.ts` and
the conditional cases in `showcase/cases.spec.ts`; a case that can no longer
be reached shows on the page as not captured, with the reason.
`npm run showcase:page` rebuilds only the page from the last capture. The
output is not committed.

## How it is tested

The [device lab](agents/device-lab.md) runs real independent installations
against a dedicated local Worker. Start it with `npm run lab -- --env=NAME` after
building the frontend; `npm run lab:cli -- discover` publishes the common operation
schemas used by its frontend and AI callers. It retains isolated profiles, steps
and diagnostics under `.wrangler/lab/`. Devices are real headless browsers (`kind: "browser"`)
or many live app instances, each in its own frame of the lab page (`kind: "inpage"`); the guide says when
to use each. See the guide before controlling stores.

| What | Where | What it guarantees |
| --- | --- | --- |
| Command rules | `test/groupCommandRules.test.ts` | The outcome of every rule of every command, as a table. |
| Money | `test/money.test.ts` | Allocation and balances net to zero and round fairly, for generated inputs. |
| Server and HTTP | `test/groups.test.ts`, `join.test.ts`, `sync.test.ts`, `realtime.test.ts`, `transportContract.test.ts`, and others | Routes, persistence, and the contract both transports share. |
| Offline synchronization | `test/syncConvergence.test.ts` | Generated devices, tabs, and groups with lost requests, failed storage, and races converge on the server, with one outcome per command. |
| Client storage | `test/storageBudget.test.ts` | The installation document's size, round trips, and speed stay within budget. |
| App actions | `test/appActions.test.ts`, `test/actionModel.test.ts` | The rules of each action, and for generated sequences, including double clicks, that dispatch agrees with availability and the app always settles. |
| Diagnostics | `test/requestLog.test.ts`, `test/diagnostics.test.ts` | Request ids join client reports to Worker logs, without names or secrets. |
| Browser | `e2e/app.spec.ts` | Rendering, focus, history, realtime between two devices, and offline edits in the built app. |

A generated test that fails prints the shortest failing sequence of steps; keep
it in that test's examples once fixed.

## Diagnosing a problem

In development, **Copy diagnostics** in devtools' Actions tab copies
a report of the app's recent actions and requests with their ids, without
names, links, or inputs. Every request's id is also in the Worker's log line
for it, which records what the server decided. In development, devtools show
the same log live, and `GET /debug/groups/{groupId}` reads a group's server
state. See [docs/architecture.md](architecture.md#diagnostics).
