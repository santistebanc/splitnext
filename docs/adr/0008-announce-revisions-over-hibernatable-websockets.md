# Announce revisions over hibernatable WebSockets

Each group's Durable Object accepts WebSocket subscriptions through the
hibernation API and sends `{ "type": "revision", "revision": n }`: once on
connect and after every applied change. Clients respond by synchronizing
through the ordinary snapshot path, so missed, duplicated, or reordered
messages cannot corrupt state, and the first message on every connection is
the catch-up after a disconnect. Hibernation keeps idle subscriptions free of
compute on Cloudflare's low-cost tiers.

The same authenticated connection also carries transient
`{ "type": "presence", "identity_ids": [...] }` rosters. Derive these from open
socket tags, deduplicating multiple tabs for an identity; broadcast after a
connection opens, closes, fails, or leaves. Presence never changes a ledger
revision, snapshot, or audit event. Clients discard it when disconnected and
wait for a fresh roster after reconnecting. This keeps connection status separate
from permanent access and nonexclusive preferred-member selection. Sudden network
loss can take time for the server to detect. These markers do not promise
foreground activity or continuous reachability.

Browsers cannot set an Authorization header on a WebSocket, so clients offer
`splitnext.v1` plus `splitnext.auth.v1.<device secret>` as subprotocols and the
server selects only `splitnext.v1`. This keeps the long-lived credential out of
URLs and request logs without a separate ticket endpoint. A single-use ticket
remains the alternative if a platform or proxy mishandles subprotocols.
