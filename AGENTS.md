# Splitnext agent instructions

Read these before changing behavior:

- [CONTEXT.md](./CONTEXT.md) defines the domain language.
- [docs/product-spec.md](./docs/product-spec.md) records accepted product
  behavior and separates the current MVP from deferred work.
- [docs/adr/](./docs/adr/) records consequential architectural decisions and
  their rationale.
- [README.md](./README.md) describes what is implemented, how to run and
  check it, and how it is tested.
- [docs/architecture.md](./docs/architecture.md) describes how the parts fit
  together and the rules each keeps.

If a decision changes, update the relevant document in the same slice.

## Working agreement

- Build small, reviewable vertical slices, each small enough to be its own
  commit.
- Cover user-visible flows and UI bugs in `e2e/app.spec.ts`. New app actions are
  exercised by `test/actionModel.test.ts` automatically; give inputs that need
  state-backed values a `choices` or `suggestions` source.
- Put each group command in its own file in `src/domain/commands/` and register
  it in `src/domain/commands.ts`. Give it a generator in
  `test/syncConvergence.test.ts` and a row per outcome in
  `test/groupCommandRules.test.ts`. When a generated test finds a failure, keep
  its shrunk steps in that file's `examples`.
- Use focused TDD and relevant checks during iteration. Save meaningful recoverable commits automatically. Run `npm run check:fast` while iterating and `npm run check` before opening a PR; CI repeats the full check.
- Do not add compatibility code for discarded pre-production designs or erase
  remote data without explicit permission.

## Agent skills

For multi-device experiments or sync bugs, use the isolated [device lab](docs/agents/device-lab.md).

### Issue tracker

Tickets live in GitHub Issues for `santistebanc/splitnext`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Boundaries

A dev server may already be running on port 8787: reuse it instead of starting another. A second `wrangler dev` in this checkout leaves both hung. For a separate server, use another worktree, port and `--persist-to` directory, as `playwright.config.ts` does.

Use local Worker/D1 state and offline fixtures for verification. Production deployment, remote migrations, remote data changes, and real financial transactions require an explicit owner decision. Run `npm run check:fast` during development and `npm run check` before opening the PR; CI repeats the full check.
