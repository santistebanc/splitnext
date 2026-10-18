# Record repayments with net-balance suggestions

Status: ready-for-agent
Depends on: None

See [the feature-port spec](../spec.md) and
[accepted behavior](../../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).

## Scope

- Introduce explicit settlements through the full domain/server/client/action/UI path. Do not classify ordinary expenses as settlements by their split shape.
- Suggest a small deterministic set of transfers from net balances in each currency. No currency conversion or globally optimal solver is required.
- Settle up shows readable suggestions. Tapping one prefills sender, recipient and currency and offers editable amount plus Record repayment.
- Provide secondary Record another repayment for manual entry between distinct members. Allow any positive minor-unit amount, partial repayment, and overpayment without recipient approval.
- Keep a removed member available for repayment while they have an outstanding balance, without restoring their roster/preferred-member eligibility.
- Include settlements in balances and retain member references; keep them out of spending and expense rounding-burden calculations. Document the persistence/member-reference decision and extend relevant domain docs/ADRs.

## Acceptance and validation

- Recording the Ana-to-Cara transfer in a three-person debt chain updates only its currency and keeps balances zero-sum.
- Ordinary one-payer/one-recipient expenses remain expenses. Partial and excess repayments produce the expected remaining balances.
- Manual and suggested paths work offline, survive reload and converge across devices. Member removal does not erase repayment history.
- Register every command/action, outcome row and convergence generator, and cover the user paths in e2e/app.spec.ts.
- Run `npm run check` after this slice and leave it uncommitted.
- Update the relevant product/domain/architecture documentation in the same slice.

## Comments

Agreed during the source-app inventory and specification interview.

