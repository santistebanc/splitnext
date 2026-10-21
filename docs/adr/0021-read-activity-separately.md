# Read and cache Activity independently of snapshots

Activity is an authenticated read of the existing append-only audit store, cached lazily alongside a replica rather than included in its synchronized snapshot. Snapshot revisions continue to synchronize current state; audit sequences order history and never become synchronization cursors. The initial endpoint reads complete history, keeping the immutable attribution and validated credential-free audit schema; pagination can be added independently when group histories require it. Cached history remains readable offline.
