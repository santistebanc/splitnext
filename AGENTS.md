# Splitnext agent instructions

Read these before changing behavior:

- [CONTEXT.md](./CONTEXT.md) defines the domain language.
- [docs/product-spec.md](./docs/product-spec.md) records accepted product
  behavior and separates the current MVP from deferred work.
- [docs/adr/](./docs/adr/) records consequential architectural decisions and
  their rationale.
- [README.md](./README.md) describes what is implemented and how to run it.

If a decision changes, update the relevant document in the same slice.

## Working agreement

- Build small, reviewable vertical slices, each small enough to be its own
  commit.
- Give every new group command an action in `test/syncConvergence.test.ts` and a
  row per outcome in `test/groupCommandRules.test.ts`. When the generated test
  finds a failure, keep its shrunk steps in that file's `examples`.
- Run `npm run check` after each slice and leave it uncommitted for inspection.
  Commit only when asked.
- Do not add compatibility code for discarded pre-production designs or erase
  remote data without explicit permission.
