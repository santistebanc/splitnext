# Browse meaningful group Activity

Status: ready-for-agent
Depends on: 03-record-settlements

See [the feature-port spec](../spec.md) and
[accepted behavior](../../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).

## Scope

- Expose the existing append-only audit foundation as a group Activity view, covering expense/settlement changes, group creation/renames, member add/remove/rename, participant join/leave and invite replacement.
- Exclude presence and preferred-member selection changes from the feed. Keep immutable actor attribution, current display conventions and credential redaction.
- Retain v4's snapshot synchronization contract; Activity history is not the sync protocol. Record consequential history transport/cache choices in an ADR.
- Provide ordinary navigation and accessible loading, empty and error states. Keep settlement/expense restoration reachable through Activity as available.

## Acceptance and validation

- Another participant's changes appear with correct actor attribution; renaming a person does not rewrite old attribution.
- Presence/preference changes do not clutter Activity. Invite credentials never appear.
- History remains readable after removal/restoration and failed requests preserve usable navigation. Cover the browser flow.
- Run `npm run check` after this slice and leave it uncommitted.
- Update the relevant product/domain/architecture documentation in the same slice.

## Comments

Agreed during the source-app inventory and specification interview.

