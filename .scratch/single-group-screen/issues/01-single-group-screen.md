# One group screen with person details, settle-up plan, and an Activity bell

Status: resolved
Type: task

Implement the revised phone design. The bottom navigation goes: balances,
people, and expenses share one group screen, the group name opens the groups
list, and a bell opens Activity. Balances are expanded by default, collapse on
scroll to your balance, cap their height, and add people inline. Tapping a
person opens their details (rename, I’m …, remove with Undo, Settle up, and a
balance breakdown that adds up exactly). Settle up shows the person's payments
in a group-wide plan with the fewest payments; a payment opens the repayment
form filled in, and Cancel or Record return to Settle up. Changes from others
no longer pop up: the bell counts new Activity and changes to review, Activity
marks new entries and resolves reviews inline, and expenses needing review show
an orange dot. Sync status is one line under the group name, only when offline
or unreachable. The invite link opens as a bottom sheet; Rename group and Leave
group are links below the expenses; repayments appear in the expenses list. The
expense form shows one split summary line.

## Validation

Cover the flows in e2e/app.spec.ts, test the plan against a brute-force minimum
and the breakdown against balances, update the product spec, architecture,
README and CONTEXT, record the plan in an ADR, run npm run check, and leave the
slice uncommitted.

## Result

Implemented the single group screen, collapsible and capped balances with an
inline Add a person row, person details with the balance breakdown, the
fewest-payments settle-up plan (ADR 0023), the prefilled repayment form that
returns to Settle up, the Activity bell with New tags and Mark all seen, the
Needs your review block, review dots, the one-line sync status, the invite
bottom sheet, and the removal toast with Undo. Choosing a name another device
uses no longer asks first; it warns afterward.

npm run check passed: 300 unit tests and 19 browser tests.
