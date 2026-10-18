# Allow repeated member names

Ledger members may share a name. Every member has its own client-generated id,
so two devices adding "Ana" offline create two members rather than merging
them, and renaming or restoring never conflicts over a name. The app tells
same-named members apart with a name ordinal, such as "Ana (2)", numbered by
creation order among active and hidden members and shown only while a name
repeats; it is never stored in the name.

This replaces the merge-by-name rule and member aliases from ADR 0004. Guessing
that two same-named creations meant one person was wrong whenever a group had
two people with that name, and the aliases it required touched every command
and the client outbox. An accidental duplicate without expenses is simply
removed, which deletes it; duplicates with expenses are fixed by editing those
expenses, with no member-merge action.
