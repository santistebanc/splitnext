# One SQLite Durable Object owns each group

Map every group identifier deterministically to one SQLite Durable Object and
keep that group's state, access grants, command outcomes, and audit history
there. Keep only global identity and device-credential records in D1. This gives
each group a serialized transaction boundary without cross-group tables or
coordination, while repository interfaces still allow in-memory testing and
future persistence changes.
