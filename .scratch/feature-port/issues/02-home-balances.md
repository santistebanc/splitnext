# Show your separate currency balances on group rows

Status: ready-for-agent
Depends on: None

See [the feature-port spec](../spec.md) and
[accepted behavior](../../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).

## Scope

- Extend existing group summaries with the preferred member's nonzero balances per currency, derived through shared selectors/money rules.
- Show Settled only when all currency balances are zero. Show Choose who you are when no preferred member is selected.
- Keep member counts, preferred-member labels, offline startup, left groups and rejoin behavior.

## Acceptance and validation

- A member who is owed EUR 30 and owes USD 20 sees both amounts, never a converted/net total.
- All-zero and unassigned cases differ. Removing your preferred member makes the summary show Choose who you are.
- Queued edits and another device's synchronized changes update the summary. Cover the flow in e2e/app.spec.ts.
- Run `npm run check` after this slice and leave it uncommitted.
- Update the relevant product/domain/architecture documentation in the same slice.

## Comments

Agreed during the source-app inventory and specification interview.

