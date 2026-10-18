# Fixed Blue paper theme and original logo

Status: ready-for-agent
Depends on: None

See [the feature-port spec](../spec.md) and
[accepted behavior](../../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).

## Scope

- Replace the temporary palette with Blue paper: a colored #C5DBF3 surface, dark blue ink and a visible static fine grain or paper-fiber texture. Use the existing design skills when refining tokens and component states.
- Reuse the earlier app's assets/svg/splitnext-icon-paths.svg (original split-S artwork and #60A5FA blue). Show the logo on the app's groups list only.
- Keep one fixed theme with no appearance/texture settings or system-theme switching. Keep assets local for offline use and retain attribution for licensed texture assets.
- Preserve the accepted navigation, inline member editing, presence semantics, keyboard behavior and reduced motion. The palette mockups did not approve new navigation.

## Acceptance and validation

- Browser flows remain usable on narrow and desktop layouts, including keyboard focus, sheets and errors.
- The groups list shows the original mark; create/join/group/expense/settings views do not.
- Texture is visible at ordinary display size, while labels, numbers, controls and focus remain legible. Include visual review alongside functional e2e coverage.
- Run `npm run check` after this slice and leave it uncommitted.
- Update the relevant product/domain/architecture documentation in the same slice.

## Comments

Agreed during the source-app inventory and specification interview.

