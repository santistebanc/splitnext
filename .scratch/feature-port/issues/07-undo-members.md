# Safely reverse group and member Activity

Status: resolved
Depends on: 05-activity, 06-undo-money

See [the feature-port spec](../spec.md) and
[accepted behavior](../../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).

## Scope

- Extend the safe reversal mechanism to group rename and member add/remove/rename, including reversal-of-reversal.
- Block reversal of member addition once any expense or settlement references that member, including retained removed records. Keep v4's hide/delete and preferred-member clearing rules.
- Group creation, joining, leaving and invite replacement never offer Undo.
- Show why an otherwise reversible action is unavailable and recheck its preconditions on the server.

## Acceptance and validation

- Any participant can reverse an eligible rename/removal; later affected changes prevent stale reversal.
- Expense and settlement references both prevent undoing member addition; removed records still count.
- Restoring a member does not restore cleared preferred-member choices. Confirm excluded actions have no Undo in the browser.
- Run `npm run check` after this slice and leave it uncommitted.
- Update the relevant product/domain/architecture documentation in the same slice.

## Comments

Agreed during the source-app inventory and specification interview.


Implemented group/member reversals, intervening-change checks and retained-record reference protection. Restoring a member leaves cleared preferred-member choices unchanged.
