# Separate access identities from ledger members

An access identity is an authenticated actor; a ledger member is a name used in
expenses and balances. Connect them only through a nonexclusive preferred-member
choice. This avoids treating a member as a claimable account slot, allows
several actors to identify with the same member, and preserves ledger history
when identities or preferences change.
