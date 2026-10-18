# Safely reverse expense and settlement Activity

Status: ready-for-agent
Depends on: 04-settlement-lifecycle, 05-activity

See [the feature-port spec](../spec.md) and
[accepted behavior](../../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).

## Scope

- Offer Undo to any participant for reversible expense/settlement actions, regardless of original actor or age, while safe.
- Reversal creates a compensating command and attributed Activity entry linked to the reversed action. A reversal can itself be reversed safely.
- Compare the affected information with the original action's result; reject stale reversals that would overwrite later changes. Do not reject merely because unrelated group state advanced.
- Recheck safety authoritatively, preserve offline intent/outcome semantics, and explain unavailable Undo without a force-overwrite option.

## Acceptance and validation

- Undoing an earlier EUR 30-to-40 edit cannot replace a later EUR 50 edit; an unrelated rename does not block it.
- Undo then undo-the-reversal produces new immutable events and correct balances, without modifying old events.
- Concurrent/offline invalidation produces a conflict notice rather than silent overwrite. Add rule rows, generated commands/scenarios and browser coverage.
- Run `npm run check` after this slice and leave it uncommitted.
- Update the relevant product/domain/architecture documentation in the same slice.

## Comments

Agreed during the source-app inventory and specification interview.

