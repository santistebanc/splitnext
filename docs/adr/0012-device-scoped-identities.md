# Keep identities scoped to one installation

Status: Accepted

## Context

Account sign-in would let someone continue the same access identity across
devices, but it adds authentication, identity linking, and merge behavior. The
MVP can give another device group access through the existing invite-link flow.

## Decision

Every fresh installation creates an anonymous access identity and a device
credential. An identity belongs to one installation; there is no account
sign-in or account linking. A person joining a group on another device uses a
current group invite link, which grants access to that device's own identity.
The identity receives its own actor handle and history, even if it chooses the
same ledger member as the other device.

Keep the derived D1 identity-to-group index as the server's list for an
authenticated identity. Keep the client cache for offline group lists. The
index can restore a lost local group cache when the installation still has its
device credential; it cannot recover access on a fresh installation.

## Consequences

- Losing an installation's credential loses that identity's access. On a new
  installation, the person must join each group with a current invite link.
- One person may have separate actor handles and history in a group when they
  use it from multiple installations.
- The group index remains useful for restoring locally cached group lists and
  listing groups while online.
- Account authentication and identity merges are outside the planned scope.
