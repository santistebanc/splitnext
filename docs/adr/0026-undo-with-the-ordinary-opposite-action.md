# Undo with the ordinary opposite action

Undo in Activity sends the ordinary command that puts back what an entry
changed: removing what it added or restored, restoring what it removed, and
renaming or editing back. Activity then shows that action as itself, such as
"You renamed the group", rather than as an undo of another entry, and undoing
an undo is just Undo or Restore on that newer entry. There is one way to make
each change, and history reads as what happened.

Renames and edits name what the entry left, the name or the record version,
so a later change makes them fail rather than be overwritten. Removing and
restoring carry no such precondition. Activity offers Undo only on the latest
change to a record while the record still matches it, and a removal can
always be restored, so a change racing an undo is recoverable. Undoing a
member's addition stays blocked once expenses or repayments name them.

The server keeps the `change.undo` command so undos already queued offline
still apply, and existing "undid a change" entries stay in history, without
Undo. This supersedes [ADR 0022](./0022-compensate-canonical-actions.md).
