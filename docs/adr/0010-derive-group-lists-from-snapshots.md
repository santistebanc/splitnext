# Derive each identity's group list from snapshots

Keep a D1 index of the groups each identity can access, with each group's name
and whether the identity left it, so a device can list its groups without
asking every group's Durable Object. The Durable Objects remain authoritative;
the index is refreshed from the snapshot an identity receives when it creates,
joins, or synchronizes a group, with a conditional upsert that writes only when
something changed. That makes the index self-correcting: a stale name or a
missed leave is repaired by the identity's next synchronization, which realtime
announcements prompt. Clients cache the list and merge it with their local
replicas, so it also works offline and survives lost local storage.

The debug dashboard derives its server-wide tab list from distinct group IDs
in the same index, then reads current names and state from each Durable Object.
This includes groups no current test device uses without adding a second
catalog that could drift. The debug reset erases every indexed group before
clearing the index and identity directory.
