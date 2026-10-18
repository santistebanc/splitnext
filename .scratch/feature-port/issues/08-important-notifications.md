# Notify only about important foreground changes

Status: ready-for-agent
Depends on: 03-record-settlements, 05-activity

See [the feature-port spec](../spec.md) and
[accepted behavior](../../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).

## Scope

- Notify for another identity's change only when it changes your preferred member's balance, or changes monetary details of/removes an expense or settlement originally recorded by your identity.
- Use immutable identity attribution, not selected member name, to suppress own actions and identify original authors.
- Only the currently open group's fresh changes toast. Deduplicate repeated delivery, summarize bursts and suppress startup/reconnect backlogs.
- Keep pending/offline indicators, failed-sync feedback and conflict notices independent. Routine joins, renames, presence and preferred-member selection do not toast.
- Do not add browser/native background push in this slice.

## Acceptance and validation

- Two identities selecting the same member still distinguish their own actions; an unassigned identity can still be notified about qualifying changes to its authored records.
- Fresh qualifying changes produce one compact summary; repeated sync and reconnect catch-up do not replay toasts.
- Changes in another group and routine joins remain quiet. Conflict and sync-failure feedback remains visible regardless of toast filtering.
- Cover two-device browser flows and the pure selection/deduplication logic at their existing boundaries.
- Run `npm run check` after this slice and leave it uncommitted.
- Update the relevant product/domain/architecture documentation in the same slice.

## Comments

Agreed during the source-app inventory and specification interview.

