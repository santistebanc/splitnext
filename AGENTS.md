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

- Build small, reviewable vertical slices.
- Extend `/dashboard/` in every API slice so its public behavior is testable.
- Run `npm run check` after each slice and leave it uncommitted for inspection.
  Commit only when asked.
- Do not add compatibility code for discarded pre-production designs or erase
  remote data without explicit permission.
