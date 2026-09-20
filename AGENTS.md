# Splitnext instructions

This file contains decisions that are not evident from the code. Follow them
unless the user changes them, and update this file when a decision changes.

## Working agreement

- Build small, reviewable vertical slices.
- Run `npm run check` after each slice, then leave it uncommitted for the user to
  inspect. Commit only when asked.
- Do not add compatibility logic for discarded pre-production designs or erase
  remote data without explicit permission.

## Product constraints

- Do not invent owner/admin roles.
- Keep access identities and ledger members separate. A preferred member is a
  nonexclusive UI choice, not ownership of a member.
- Group access grants are permanent and cannot be revoked by participants.
  Leaving a group only hides it and stops syncing. A user may revoke their own
  device credentials.
- Ledger members are active or archived; never physically delete them. Active
  member names are unique within a group.
- Consumer apps are offline-first. Network delivery, including WebSockets, is
  never a source of truth: writes must be retry-safe, deletions must synchronize,
  concurrent changes must reconcile without silently discarding history, and
  reconnecting clients must be able to catch up or replace local state from a
  consistent server snapshot.
- Domain validation, state transitions, and automatic convergence rules must be
  deterministic and reusable by the server and offline clients. Keep them free
  of Cloudflare, HTTP, and storage-adapter concerns.

## Invites

- Invites are temporary credentials; redemption issues a permanent group access
  grant. Expiring an invite does not revoke grants already issued from it.
- Use reusable **group links** as the only invite type for now. Do not implement
  individual member links unless the user explicitly revisits this decision.
- A group link lets the joining identity select an active member or create one
  as its initial preferred member. Selection is nonexclusive.
- Join URLs include group id and secret: `/join/{groupId}/{inviteToken}`. Persist
  only the token hash in the relevant group's Durable Object.
- Default expiry is seven days. Never reactivate an expired or revoked link;
  inviting again creates a fresh token.
- "Disable link" sets `revoked_at` instead of deleting the record.
- Group links remain usable until expiry, or revocation.
- Redemption atomically validates the invite, selects or creates the preferred
  member, issues the access grant, and records use.
