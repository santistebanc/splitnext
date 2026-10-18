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
- Run `npm run check` after each slice and leave it uncommitted for inspection.
  Commit only when asked. Pushes run `npm run check:fast` through the tracked
  pre-push hook; CI runs the full check.
- Do not add compatibility code for discarded pre-production designs or erase
  remote data without explicit permission.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
