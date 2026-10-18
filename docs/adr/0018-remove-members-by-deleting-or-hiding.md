# Remove members by deleting or hiding them

Removing a ledger member is one command, and the shared transition decides its
effect when it applies: a member no expense refers to, removed or not, is
deleted; any other member is hidden. Both are soft. Members stay in the
snapshot as `active`, `hidden`, or `deleted`, and either kind can be restored.
A later expense that names a removed member still applies, turning a deleted
member into a hidden one, so offline work is never lost and no balance loses a
participant.

The person removing a member cannot know whether an offline device has already
recorded an expense with them, so the effect is decided where the order is
known. Hidden members are not offered for new expenses but keep showing in a
currency's balances while they are not settled there.

## Considered options

- **Reject expenses that name a removed member.** Rejected: an offline
  person's expense would be lost because of a removal they never saw.
- **Restore the member when such an expense arrives.** Rejected: it silently
  undoes another person's removal.
- **Erase members without records.** Rejected: a late expense would then name
  a member that no longer exists.
