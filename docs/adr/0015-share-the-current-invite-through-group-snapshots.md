# Share the current invite through group snapshots

The invite belongs to the group: every participant must be able to share its
current link without replacing it. Retain the current token in the group's
authoritative snapshot and return it only through authenticated group responses.
Clients cache it with their replicas; regeneration propagates through ordinary
revision announcements and synchronization.

This supersedes the hash-only storage decision in ADR 0009. Clients still
generate tokens before retry-safe creation and regeneration, and the server
uses hashes for redemption and historical retry checks. Audit events, public
previews, and diagnostic traffic omit tokens. Retaining a shareable secret is
necessary because a hash cannot reconstruct the existing link.

Existing development data needs a one-time upgrade: import a saved token when
available, otherwise replace the link while retaining group data and access.
Client documents use schema version 2 with shared tokens in snapshots and a
separate pending-invite outbox for retry-safe replacements. Startup upgrades
version 1 documents atomically, preserving identity, queued commands, notices,
and pending requests. Saved creator tokens permit an offline upgrade; devices
without a saved token fetch the current authorized snapshot once online. Failed
upgrades leave the original document intact. This is a persistence migration;
the API continues to accept only the current shared-invite model.
