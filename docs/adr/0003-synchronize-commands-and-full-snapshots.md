# Synchronize commands and full snapshots

Clients persist an ordered command outbox and a confirmed group revision, while
the server returns an outcome for every command and a complete authoritative
snapshot whenever state may differ. Do not rebuild client state by replaying the
audit log. Full snapshots keep recovery and offline reconciliation simple for
the expected small groups; realtime delivery only signals that a newer revision
should be synchronized.
