# Reverse canonical actions with affected-record preconditions

Undo names an immutable audit event instead of sending a client-supplied replacement. The server resolves it within the command transaction and compares the affected information with the event's result, so unrelated revisions do not prevent reversal and stale intent cannot overwrite newer work. A successful reversal appends a linked compensating event; history stays immutable and reversing that compensation is ordinary safe Undo. Monetary record versions prevent later edits, including edits that return to an earlier amount, from being mistaken for unchanged records.

Member additions, renames, removals, restorations, and prior member reversals
are excluded from Undo. They are straightforward to correct manually, so
their Activity entries and removal notifications do not need reversal
controls. The shared rules reject those reversals; expense, repayment, and
group-rename reversals keep the safety checks above.
