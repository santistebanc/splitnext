# Merge guest identity into an existing account identity

Status: Accepted

## Context

Fresh installs should work without sign-in, but signing in on another device
should bring the guest device's groups into the account. A group identity owns
access grants and stable actor handles, and one identity may already be
participating in a group through both guest and account identities. Audit
events are append-only and must keep the actor and handle recorded at the time.

## Decision

When an anonymous device signs into an account linked to a different identity,
merge the guest identity into the account identity. In each guest-accessible
group, collapse duplicate grants to one account grant. If the two identities
have different preferred members, use the latest preference transition.
Preserve all prior audit events and actor handles; record the merge as a new
transition.

The Worker processes each group's Durable Object idempotently before changing
the D1 identity-device mapping. After all groups succeed, one D1 batch combines
the derived group index, records the identity redirect, and reassigns the device
credential to the account identity. If processing fails partway through the
group set or the D1 batch, sign-in fails without changing the D1 mapping or
index; retrying repeats already-completed group transitions safely. Group-local
redirects allow old identity references to resolve during a retry.

An authenticated synchronization also repairs a legacy grant that still names
an identity whose group-local redirect resolves to the authenticated account.
This lets existing replicas recover on their next sync without resetting the
group or requiring the user to sign in again.

## Consequences

- A guest device is automatically assigned an anonymous identity; account
  sign-in remains optional.
- After merge, all devices authenticate as the account identity and see the
  union of its and the guest's groups.
- Old identities remain as historical references; they are not deleted and
  their audit attribution is not rewritten.
- The debug mock-account flow exercises this behavior but is not production
  authentication. Production account-provider integration remains separate.
- Group redirects are a retry mechanism, not a way to retain two participants
  after the merge.
