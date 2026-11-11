# What works

Moved from the README: everything the app and its SDK do today.

- Anonymous per-installation identities and device credentials backed by D1;
  there is no sign-in or account linking.
- Retry-safe group creation with a client-generated group id and an immediately
  usable invite, created atomically by the API.
- Joining through a reusable invite link with a preview of the group, then
  choosing an existing member or joining as someone new.
- Exactly one current invite link per group with no time limit and
  regeneration. Every participant can share the same current link.
  Regeneration invalidates the previous link.
- Offline-capable group rename and member add, rename, remove, and restore
  commands.
- Offline-capable expense record, edit, remove, and restore commands, as
  plain numbers without currency, with allocations and burden-fair rounding
  fixed by the server.
- Explicit repayments with a settle-up plan of the fewest payments,
  partial or excess amounts, offline recording and versioned
  edit/remove/restore commands.
- Cached, attributed Activity and safe compensating undo, including reversing a
  reversal while preserving immutable history and later changes.
- An Activity count in the group header for new changes from other
  identities and changes waiting for review, with new entries marked in
  Activity and Mark all seen.
- Renaming a group in place from its header, and leaving it on this device
  from its row in the groups list.
- Nonexclusive preferred-member selection (the member the UI calls “you”).
- Leaving and rejoining a group without revoking its permanent access grant.
- A per-identity list of accessible groups, marking the ones it left, backed
  by a derived D1 index and cached by the SDK for offline use. The server index
  can restore the list when an installation still has its device credential
  but has lost its local group cache.
- Ordered, idempotent outboxes and full revisioned server snapshots.
- Rejected or superseded command notices stored by the client.
- Realtime revision announcements over hibernatable WebSockets, with automatic
  background synchronization, reconnection, and catch-up in the SDK.
- A stateful TypeScript client SDK with swappable local storage adapters.
- A server group engine with Durable Object and in-memory repository adapters.
- A responsive Expo web app at `/app`, with a public homepage and invite entry
  pages rendered by the same Cloudflare Worker: single-screen group creation,
  member management, invitation sharing, joining and rejoining, group
  switching, expense entry and editing with per-person share controls and fixed
  amounts mixed with weighted shares, balances, and offline command and conflict feedback. Its
  screens are
  described in [docs/architecture.md](architecture.md#the-web-app) and
  specified in [docs/product-spec.md](product-spec.md).
- One group screen led by where you stand and Settle up, with People and
  Expenses tabs: everyone's balance beside their avatar, settled people folded
  away, and expenses and repayments by month with expense search; a settle-up
  page with your payments first; person details with a balance breakdown,
  Settle up, rename, and remove; and browser Back/Forward support. Forms return to where
  they were opened.
- A design system (`apps/client/src/design/`) every screen is built from,
  documented in a `/components` catalog, and in-app devtools; both are
  enabled with debug inspection.
- One fixed light theme on warm paper with barely rounded black controls, locally
  served Instrument Sans and Geist Mono fonts, and morphing screen changes on
  the web. Theme assets are precached with the app shell
  for offline reloads; changing a theme asset invalidates that cache.
- Amounts are plain numbers with two decimals, never shown with a currency,
  and shown with their digits grouped in threes, such as 1,234.50.
  Expenses and repayments record the no-currency code XXX, and the ledger keeps
  any older real-currency records separate; see
  [ADR 0025](adr/0025-deal-in-plain-numbers-without-currency.md).
- Expenses use the pure, property-tested money module, `src/domain/money.ts`:
  whole minor units per currency, allocation by
  exact amounts and shares, rounding extras that rotate by accumulated burden,
  and balances that net to zero per currency; see
  [ADR 0017](adr/0017-allocate-money-in-whole-minor-units-with-burden-fair-rounding.md).

Repayments, cached Activity, safe undo and the Activity count are
implemented. Their agreed behavior is in
[the product specification](product-spec.md#agreed-feature-port-from-the-earlier-app).

Only the web build of the app exists so far. The Expo app has native
variants of a few components, but no native build has been made, its storage
would need a SQLite adapter at the SDK's storage seam, and nothing tests it:
every app test drives the shared model or the web build.
