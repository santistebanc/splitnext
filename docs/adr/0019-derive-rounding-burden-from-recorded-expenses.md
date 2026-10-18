# Derive rounding burden from recorded expenses

Expense commands carry their inputs: total, currency, payers, and each
participant's exact amount or shares. The shared transition allocates them
against the group's current rounding burden, so the server's order decides who
absorbs an extra minor unit and a client's optimistic projection may differ
until it synchronizes. Each expense keeps its inputs, its allocations, and the
members who received an extra unit.

A member's burden in a currency is never stored. It is the number of extra
units they received across that currency's expenses that are not removed.
Removing or restoring an expense therefore adjusts the burden exactly, an edit
reallocates against the burden without that expense's own extras, and a
restored expense keeps its original allocations.

This refines ADR 0017, whose caller kept the returned burden. A running total
would drift as expenses are edited, removed, and restored; deriving it keeps
fairness exact without reconciliation.

## Considered options

- **Clients allocate and send final amounts.** Rejected: two offline devices
  would both give the extra unit to the same lowest-burden member.
- **A stored running burden.** Rejected: removals and edits would need
  compensating updates that can drift from the expenses themselves.
