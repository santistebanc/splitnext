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

## Invites

- Invites are temporary credentials; redemption issues separate member/device
  access. Expiring an invite does not revoke access already issued from it.
- Use reusable **group links** as the only invite type for now. Do not implement
  individual member links unless the user explicitly revisits this decision.
- A group link can create a new member or claim an eligible pre-created member.
- Join URLs include group id and secret: `/join/{groupId}/{inviteToken}`. Persist
  only the token hash in the relevant group's Durable Object.
- Default expiry is seven days. Never reactivate an expired or revoked link;
  inviting again creates a fresh token.
- "Disable link" sets `revoked_at` instead of deleting the record.
- Group links remain usable until expiry, or revocation.
- A member is claimable through a group link only while active and only if
  member access has never been issued for that member.
- Redemption atomically validates the invite, creates or claims the member,
  issues access, and records use.
