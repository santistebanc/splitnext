# Derive each identity's group list from snapshots

Keep a D1 index of the groups each identity can access, with each group's name
and whether the identity left it, so a device can list its groups without
asking every group's Durable Object. The Durable Objects remain authoritative;
the index is refreshed from the snapshot an identity receives when it creates,
joins, or synchronizes a group, with a conditional upsert that writes only when
something changed. That makes the index self-correcting: a stale name or a
missed leave is repaired by the identity's next synchronization, which realtime
announcements prompt. The server index restores the list when an installation
still has its device credential but has lost its local group cache. Clients
also cache the list so it works offline.

Debug inspection lists server-wide groups from distinct group IDs in the same
index, then reads current names and state from each Durable Object. This
includes groups no current device uses without adding a second catalog that
could drift.
