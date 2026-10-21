# Phone design for every app screen

Status: resolved
Type: task

Implement the twelve-screen phone design (Your groups, Create a group, Join
from invite link, Invalid or replaced link, Group · Expenses, Add expense,
Group · Balances, Record a repayment, Group · Activity, Changes to review,
Group · People, Empty group offline) as closely as the app's behavior allows.
It replaces the Calm receipt theme and the Settings screen: Activity and
People join Expenses and Balances in a bottom navigation, and People holds the
invite link, members, Change who you are, Rename group, and leaving.

## Validation

Update e2e/app.spec.ts for the new screens and wording, keeping every flow it
covered. Run npm run check and leave the slice uncommitted.

## Result

Implemented the design's palette, IBM Plex Sans, IBM Plex Mono, and Bricolage
Grotesque fonts served locally, outline icons, four-tab bottom navigation,
floating Add expense, dark balance and invite cards, currency segments with
settle-up suggestions, the repayment and expense forms with header actions,
day-grouped Activity, the review cards, the join and broken-link screens, the
connection banner and sync pill, and bottom-sheet confirmations. The product
spec, architecture notes, and README describe the new screens.

npm run check passed: 299 unit tests and 19 browser tests.
