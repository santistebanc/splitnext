# Focused group navigation

Status: resolved
Type: task

Replace the combined group screen with Expenses, Balances, and Activity.
Use mobile bottom navigation and desktop tabs, keep Members and invitations in
a separate view, preserve the existing receipt theme, and retain history, scroll,
keyboard access, reduced motion and repayment drafts. Keep primary actions out
of the navigation destinations. Existing keyboard-aware form pages stay in use.

## Validation

Cover navigation and existing member, expense, repayment, Activity and offline
flows in e2e/app.spec.ts. Run npm run check and leave the slice uncommitted.

## Result

Implemented focused views, compact bottom navigation, desktop tabs, Members,
per-view scroll positions, sheet return destinations, keyboard tab navigation,
and reduced-motion-aware web content and indicator transitions. Preserved the
Calm receipt theme and keyboard-aware mobile form pages.

npm run check passed: 299 unit tests and 19 browser tests. Reviewed the saved
desktop and mobile screenshots from the navigation browser test. All changes
remain uncommitted for inspection.
