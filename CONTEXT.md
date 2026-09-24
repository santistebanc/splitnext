# Splitnext

Splitnext is an offline-first shared-expense ledger. These terms are distinct:

**Access identity**: the actor behind one or more authenticated devices. The
first release uses anonymous identities; accounts may be added later.

**Device credential**: a secret held by one device that authenticates its access
identity. A user may revoke their own device credential.

**Group access grant**: permanent permission for an access identity to use a
group. Group participants cannot revoke it. Leaving hides the group and stops
syncing; it does not destroy the grant.

**Ledger member**: a name used in expenses, balances, and settlements. It is not
an account or an access-control record. Members are active or archived.

**Preferred member**: an access identity's nonexclusive choice of which ledger
member the UI calls “you.” Multiple identities may choose the same member.

**Direct join**: the temporary MVP mechanism in which an authenticated identity
that knows a group id receives a permanent grant while selecting an active
member or creating one. Invitations will replace this before public use.
