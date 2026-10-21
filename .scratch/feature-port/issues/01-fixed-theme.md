# Fixed Blue paper theme and original logo

Status: resolved
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

Implemented the fixed palette, local Manrope font, static procedural fine grain,
transparent content surfaces, and original split-S mark on the groups list only.
Presence green and white presence badges retain their meaning. Appearance assets
are precached, and their contents participate in cache invalidation. Added a
small-screen, dark-system-appearance browser flow that verifies logo placement
and an offline reload with the font, texture, and icon available.

Visual review used desktop and 375px Playwright screenshots after the T3 preview
connection failed. The grain was reduced after that review to preserve legibility.


Texture refinement: replaced the synthetic SVG noise with the attributed Paper
Fibers texture at native scale after feedback that the grain looked poor. The
asset and its credit notice are served locally and included in the offline
precache and release hash. Blue paper tokens and layout are unchanged.

Superseded: the Blue paper palette and Paper Fibers texture were later replaced
by the Calm receipt theme described in docs/product-spec.md#appearance. The
logo placement rule is unchanged.
