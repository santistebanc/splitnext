# Edit, remove and restore recorded repayments

Status: ready-for-agent
Depends on: 03-record-settlements

See [the feature-port spec](../spec.md) and
[accepted behavior](../../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).

## Scope

- Any participant may edit, remove or restore any settlement, including offline, through the shared action catalog.
- Edits use the version opened; stale edits are superseded and editing removed records is rejected. Removal retains history and excludes the record from balances; restore returns exactly the recorded repayment.
- Expose edit/remove in settlement details and restore through Activity once that screen exists; keep restore available to the catalog/devtools in this slice.

## Acceptance and validation

- Two-device concurrent edits cannot overwrite silently; unsuccessful intent remains visible as a notice.
- Removing and restoring a repayment changes balances exactly, including partial/overpayments and removed-member references.
- Lost responses, retries and offline reload never duplicate a repayment or audit event. Add full command-rule and convergence coverage.
- Run `npm run check` after this slice and leave it uncommitted.
- Update the relevant product/domain/architecture documentation in the same slice.

## Comments

Agreed during the source-app inventory and specification interview.

