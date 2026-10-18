# Earlier-app feature port

Status: ready-for-agent

Agreed through the feature inventory and specification interview. Product
behavior is recorded in [docs/product-spec.md](../../docs/product-spec.md#agreed-feature-port-from-the-earlier-app).
This document provides the implementation handoff, not a claim of completed
features. Leave work uncommitted unless asked otherwise.

## Target and authority

- Implement in `/root/code/v4/splitnext`.
- Use `/root/code/splitnext` as a read-only feature and asset reference.
- Preserve v4's accepted product decisions and ADRs. The earlier app's blueprint,
  implementation quirks, and dormant UI paths do not override them.
- No old-data migration or compatibility layer is required. The user explicitly
  permits replacing/wiping existing data when needed for implementation.
- This planning slice does not wipe data or implement the features.

## Source inventory and disposition

The inventory inspected routes, domain rules, services, platform adapters, and
documentation. It did not run the earlier app or verify store releases.
Source paths below are relative to `/root/code/splitnext`.

- **Groups and remembered home:** `app/index.tsx`, `app/new-group.tsx`,
  `src/services/create-group.ts`. V4 already has groups, creation, last-group
  reopening, member counts, and preferred-member labels. Add monetary summaries.
  Keep v4's creator-name creation flow rather than the earlier arbitrary roster
  form and hardcoded EUR group currency.
- **Members and access:** `src/services/group-membership.ts`,
  `src/services/group-entry.ts`, `src/services/join-group-orchestrator.ts`.
  Preserve v4's separate access identities, nonexclusive preferred member,
  repeated names, hide/delete removal, and server-backed leave/rejoin.
  Do not port title-casing, automatic replacement of a removed you member,
  blocking removal of expense-referenced members, or device-only leave.
  The older claimed-member/all-joined UI is dormant: invite resolve currently
  returns an empty claimed-member list; it is not a parity requirement.
- **Invitations:** `app/i/[token].tsx`,
  `src/services/group-settings-workflow.ts`, `src/services/member-invites.ts`.
  V4 already provides preview, join, copy/share, and regeneration. Preserve its
  reusable shared link, fragment token, permanent access, and confirmation.
- **Expenses:** `src/components/expense-form-screen.tsx`,
  `src/domain/expenses/expense-split-state.ts`, `src/services/expense-write.ts`.
  Single payer, equal/subset and integer weighted shares, mixed fixed amounts
  and shares, edit/remove, pending display. Already represented in v4's command
  registry, `apps/client/src/ui/ExpenseEditor.tsx`, ledger actions, and tests.
  Keep v4's required description and per-expense currency.
- **Balances and settlements:** `src/domain/ledger/index.ts`,
  `src/domain/expenses/group-balances.ts`, `app/group/[id]/settle-up.tsx`,
  `src/navigation/settlement-prefill.ts`. Add suggestions and recorded
  settlements. Do not port aggregate rational rounding, one-cent forgiveness,
  or inferring payments from one-payer/one-recipient ordinary expenses.
- **Activity and undo:** `app/group/[id]/activity.tsx`,
  `src/services/activity-reversal.ts`,
  `src/domain/activity/can-reverse-activity.ts`. Add browsing and safe reversal
  over v4's existing append-only audit foundation. Do not port stale snapshot
  restoration that overwrites later edits.
- **Awareness:** `src/domain/activity/activity-notifications.ts`,
  `src/domain/push/activity-push-delivery.ts`,
  `src/services/push-notifications.ts`. Add important foreground notifications
  under the narrower agreed policy. Native push exists in the reference;
  the web push adapter is a no-op. Native push remains deferred.
- **Appearance:** `src/theme/theme-context.tsx`,
  `assets/svg/splitnext-icon-paths.svg`, `src/components/brand-mark.tsx`.
  Reuse the original split-S artwork and blue, not v4's temporary green s icon.
  Replace the old light/dark switch with the single approved theme.
- **Platforms and operations:** `app/+native-intent.tsx`,
  `src/lib/check-for-updates.ts`, `src/sync/local-schema-bootstrap.ts`,
  `landing/`, `docs/production-launch.md`. Preserve web-first delivery and
  v4's command/snapshot synchronization; defer native storage, distribution,
  push and OTA work. The older iOS store link is a placeholder; code support
  is not evidence of a released app. Existing legal/runbook documents and
  marketing promises do not silently become accepted v4 release requirements.

No implemented recurring expenses, duplication, templates, percentage-entry
mode, CSV import/export, expense search/filter, spending reports, budgets,
receipt uploads/OCR, categories, exchange conversion, account/profile flows,
payment execution, or archive/delete-group UI were found. Do not create parity
tickets for these. Preserve v4's existing explicit exclusions and future
history-based recovery scope.

## Agreed behavior

### Visual direction

- Blue paper, with `#C5DBF3` background, contrasting dark blue ink, and a visibly
  textured fine grain or fine paper fibers. The user approved either material;
  choose its final implementation within that direction during visual review.
- One fixed theme. No light/dark/system control or user-facing texture control.
- Original blue split-S logo, `#60A5FA`, on the groups list only.
- Compact, readable rows over the colored surface, not a stack of white cards.
- Palette previews are examples of color/material, not approved changes to
  navigation, group creation, member controls, or existing accessibility rules.
- Preserve field, keyboard, focus, presence, reduced-motion, and touch-target
  requirements. Texture never reduces text or control contrast below usable
  levels. Use local assets for offline operation; credit licensed sources.
- The texture research used https://www.transparenttextures.com/ and its
  individually credited tiles. No specific library tile was selected; do not
  interpret the last preview's Rice paper default as an approval.

### Monetary group summaries

Show every nonzero currency balance of the preferred member, with no conversion
or combined total. Settled requires zero in every currency. An unassigned
identity sees Choose who you are. Retain current group-list and offline rules.

### Repayments

- Settlement is an explicit repayment, not an inferred kind of ordinary expense.
  It changes balances and is excluded from spending.
- Suggestions simplify net debts independently by currency. Deterministic greedy
  matching is acceptable; exact minimum-transfer optimization is unnecessary.
- Settle up lists suggestions such as You pay Ana EUR 23.40. Tapping one opens
  a short review with sender, recipient and currency prefilled, an editable
  amount, and Record repayment. A secondary Record another repayment action
  exposes manual sender, recipient, amount and currency entry.
- Recording means the external transfer already happened; there is no payment
  execution or recipient approval. Any participant may record for others.
- Any positive amount is valid between distinct members, including partial
  repayment and overpayment. Overpayment changes the sign of remaining debt.
- A removed member with an outstanding balance remains available for repayment
  without restoring them to new expenses or preferred-member selection.
- Record, edit, remove and restore all work offline. Follow expense version
  preconditions, outcomes, conflict notices, retained removal, and exact restore.
- Preserve per-currency zero-sum balances and integer minor units. Repayment
  arithmetic stays behind the money boundary; no exchange rates or dust waiver.

### Activity and undo

Show meaningful group/member/expense/settlement changes, group creation,
participants joining/leaving and invite replacement. Exclude presence and
preferred-member selections. Keep immutable actor attribution.

Undo is available to every participant, including for others' actions, with no
time cutoff while safe. Exclude group creation, joining, leaving and invite
replacement. Block reversal of a member addition once any expense or settlement
references them, including retained removed records. Preserve references when
extending the member-record rules to settlements.

Undo cannot overwrite later changes to affected information, but unrelated
group changes do not invalidate it. Recheck on the authoritative server;
concurrent/offline invalidation produces the usual outcome and conflict notice.
Explain unavailable undo. A reversal creates an attributed, linked Activity
entry, is itself undoable while safe, and never rewrites audit history.

### Important foreground notifications

Only another identity's change qualifies, and only if it changes your preferred
member's balance or changes monetary details of/removes a record you originally
created. Do not equate preferred-member selection with actor identity.
Routine joins and renames do not toast. Apply only to the currently open group,
deduplicate repeated deliveries, summarize bursts, and do not replay startup or
reconnect backlogs. Keep sync failures, offline/pending indicators and conflict
notices independent. Native/background push remains deferred.

## Implementation slices

Each issue is a reviewable slice with its own validation; see `issues/`.

1. Fixed theme and original groups-list logo.
2. Per-currency home summaries.
3. Record explicit settlements and show suggestions/manual entry end to end.
4. Edit, remove and restore settlements.
5. Browse Activity over the audit foundation.
6. Safely undo expense and settlement changes, including reversing reversals.
7. Safely undo group/member changes with the agreed reference restrictions.
8. Important foreground notifications.

Implementation may choose persistence schemas and algorithms within existing
boundaries. Record consequential choices in ADRs and update domain language and
architecture in the same slice. In particular, account for settlement references
when extending the expense-only member record rules and their documentation.
Do not introduce new layers merely to copy the older app's architecture.

## Validation and completion

- Exercise user-visible flows and UI failures in `e2e/app.spec.ts`, including
  another identity, offline use, reconnect, and stale edits where applicable.
- Register actions through the shared catalog; use state-backed choices or
  suggestions, so generated action-model checks can supply valid references.
- Put every new group command in its own file and register it. Add outcome rows
  in `test/groupCommandRules.test.ts`, generators in
  `test/syncConvergence.test.ts`, and preserve shrunk failures as examples.
- Extend pure money and persistence/transport tests where behavior changes.
- Run `npm run check` after each slice. Leave all changes uncommitted.
- This planning slice is complete when the accepted behavior, source inventory,
  and separate implementation issues are recorded; implementation is future work.
