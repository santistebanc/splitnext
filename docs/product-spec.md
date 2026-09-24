# Splitnext product specification

This document records the product behavior agreed during design discussions.
It is the durable source for what Splitnext should become. The
[README](../README.md) describes what exists today, while
[architecture decisions](./adr/) explain why the important technical choices
were made.

## Status and scope

The current MVP establishes identities, groups, ledger members, offline
synchronization, and realtime revision announcements. Invitations, expenses,
settlements, account sign-in, audit browsing, and group recovery are accepted
future behavior unless this document says otherwise.

The MVP temporarily permits an authenticated identity that knows a group
identifier to join directly. This is for development and must be replaced by
group invitations before public use.

## Product principles

- Web/PWA and React Native clients are offline-first. Losing connectivity must
  not lose user intent.
- Every participant with group access has the same authority. There are no
  owner or administrator roles.
- Access identities and ledger members are different concepts.
- The server resolves concurrent intent deterministically. Users are informed
  about unsuccessful intent, but are not asked to merge data structures.
- Network delivery, including realtime connections, is never a source of truth.
- Applied changes remain attributable and reversible through later compensating
  actions.
- The service should remain economical on Cloudflare's low-cost tiers.

## Identities and devices

- The first release creates anonymous access identities. A device authenticates
  an identity with its own secret credential.
- The model must later allow an account to represent the same access identity
  on multiple devices. Signing in must not create a different actor in a
  group's history.
- An identity may revoke its own device credentials. Group participants cannot
  revoke another identity's device or group access.
- Each group assigns an identity a stable actor handle in join order, such as
  “User 1” or “User 6.” The handle remains usable when the identity has no
  preferred member.
- Secret credentials and invitation tokens are stored only as hashes on the
  server.

## Groups and access

- A group is created with a name, currency, and the creator's initial ledger
  member name. Creation gives the creator permanent access and makes that
  member the creator's preferred member.
- Clients generate group identifiers before creation. Repeating creation with
  the same normalized input is a retry; reusing the identifier with different
  input is a conflict.
- A group can be renamed. It is never closed or deleted.
- Leaving a group clears the identity's preferred member, hides the group from
  that identity, and stops its synchronization and realtime notifications.
  It does not revoke access or alter any ledger member.
- Rejoining unhides the group and selects or creates a preferred member.
- A group access grant is permanent and cannot be revoked by participants.
  If a malicious identity obtains access, the recovery path is to create a new
  group from a chosen trustworthy point in the old group's history.

## Ledger members and “you”

- A ledger member is a group-local name used by expenses, balances, and
  settlements. It is not a user account, identity, or access slot.
- Active member names are unique within a group after normalization.
- Adding a member whose normalized name matches an active member means the same
  person. The command has no effect, and the member id the client generated
  becomes a permanent alias: later commands naming it act on the existing
  member, so work queued offline against it is not lost.
- Any participant may add or rename a member.
- Removing a member archives it rather than erasing it. Historical references
  remain valid, and an archived member is unavailable for new activity.
- Archiving a member clears it as the preferred member of every identity that
  selected it. Those identities remain authorized but become unassigned.
- Each identity may change only its own preferred member. It may select any
  active member or create a new one.
- Preferred-member selection is nonexclusive. Several identities may select the
  same member.
- Clients should show which actor handles currently prefer each member. When an
  identity selects a member already preferred by someone else, the UI should
  warn but allow the choice.
- Joining normally requires selecting an active member or creating one, so the
  new identity initially has a preferred member. Being unassigned remains valid
  after leaving or after that member is archived.

## Offline client model

- A client keeps a durable local snapshot, its last confirmed group revision,
  an ordered command outbox, and local conflict notices.
- Production PWA clients should be able to use IndexedDB and React Native
  clients should be able to use SQLite. Synchronization logic must depend on a
  storage interface rather than either database.
- Ordinary group, member, and future expense edits may be queued offline and
  projected optimistically with the same deterministic rules used by the
  server.
- Actions that establish or deliberately stop authority require an online
  server decision. These include creating or joining a group, leaving/hiding a
  group, managing invites, and revoking a device credential.
- Reconnecting sends the ordered outbox as one synchronization batch. Transport
  failure leaves the outbox intact for retry.
- An unreachable server is treated like being offline: ordinary edits still
  queue and project locally, and are delivered once the server responds.
- Local storage implementations and Cloudflare persistence are adapters; their
  details are not shared between clients and the server.

## Synchronization contract

- One group synchronization operation accepts the client's known revision and
  zero or more ordered commands.
- Every command has a stable client-generated identifier. Repeating the same
  identifier and content returns its stored outcome without applying it twice.
  Reusing the identifier for different content is rejected.
- A group's authoritative revision increases once for each applied state
  transition. Rejected, superseded, duplicate, and no-effect commands do not
  advance it.
- The server evaluates a batch in order inside the group's serialized
  transaction. Concurrent clients therefore observe a deterministic order.
- Synchronization uses complete current-state snapshots, not replay of audit
  events. If the client's revision is current and it sent no commands, the
  server may return `unchanged`.
- After synchronization, the client replaces its confirmed state with the
  authoritative snapshot and projects any commands that remain in its outbox.
- Snapshot synchronization is deliberately optimized for small group ledgers.
  A different transfer format should be introduced only after measured payload
  size demonstrates a need.

## Concurrent intent and command outcomes

- Commands carry intent-specific preconditions, such as the name observed
  before a rename. The system does not reject every write merely because the
  group's overall revision changed.
- Do not introduce CRDTs, a generic conflict engine, or global base-revision
  rejection for ordinary edits.
- Every acknowledged command receives exactly one durable outcome:
  - **Applied**: the requested transition changed authoritative state.
  - **No effect**: authoritative state already satisfies the intent.
    Converging on the same result, such as renaming to the name another device
    already chose or adding a member someone else already added, is no effect
    and never produces a conflict notice.
  - **Superseded**: another accepted transition made the original intent stale.
  - **Rejected**: the intent is invalid or unauthorized and was not applied.
- An outcome identifies the target, a machine-readable reason when applicable,
  the relevant authoritative state, and the audit event when one was created.
- Two devices can edit while offline and synchronize simultaneously without
  silently overwriting history. The group's serialization order and each
  command's preconditions determine the outcomes.
- A rejected or superseded command is not silently retried as a new intent.

## Conflict-notice experience

- The client stores rejected and superseded outcomes locally together with the
  original command.
- If a synchronization contains one or more unsuccessful commands, the UI shows
  one summary notification and marks each affected group, member, expense, or
  other target.
- Target details explain the intended change, the authoritative result, and the
  reason. When available, they also identify the other actor whose change
  superseded it.
- Dismissing a notice is local UI state and does not change group history.
- “Apply again” creates a fresh command identifier against current state. It is
  not a replay of the rejected command identifier.

## Realtime delivery

- Realtime messages only announce that a newer group revision may exist.
- A client receiving an announcement synchronizes through the normal snapshot
  path. It never applies the announcement itself as authoritative state.
- Disconnects, duplicate messages, missed messages, and reordered messages must
  be harmless.
- A client that leaves or hides a group stops receiving its announcements.
- Every new connection first announces the current revision, so reconnecting
  is how a client catches up on anything it missed.
- Announcements follow applied changes. Synchronizations that apply nothing do
  not wake other clients.

## Audit history and recovery

- Audit history is append-only and separate from synchronization.
- Every applied transition records a stable audit identifier, revision, actor
  identity, actor handle, the actor's preferred-member name at that moment when
  present, timestamp, action, target, and before and after state.
- Renaming a member does not rewrite old events. History may render an old
  action as “Thomas (now John)” when the actor currently prefers John, or
  “Thomas (User 6)” when the actor is currently unassigned.
- Reversal creates a new compensating command and audit event; it never edits or
  deletes existing history.
- The audit trail must eventually support creating a new group whose ledger is
  copied from a selected timestamp in an old group. This is the recovery
  mechanism when permanent access has been abused.
- Audit events are not the client synchronization protocol.

## Invitations (deferred)

- Public use replaces direct join with one reusable group invitation link.
  Individual or single-use member invitations are not part of the planned first
  version.
- At most one group link is current. Rotating it revokes the previous link and
  creates a new one while retaining old records for audit.
- A group link has an expiry, defaults to seven days, and can be revoked before
  expiry. An expired or revoked link is never reactivated; inviting again
  creates a new token.
- Redeeming a valid link atomically issues a permanent group access grant and
  lets the identity select an active member or create its preferred member.
- Revoking or expiring a link never revokes access already issued through it.
- Join URLs contain the group identifier and plaintext token, while persistence
  contains only the token hash.

## Expenses and money (deferred)

- The first expense version has one payer, but the persisted model and money
  module must be extendable to multiple payers without redefining an expense.
- An expense may include any subset of active ledger members.
- Allocation supports equal shares, unequal shares, exact amounts, and a mix of
  exact amounts and shares.
- All allocation, validation, and deterministic minor-unit rounding lives
  behind one pure money module. API routes, UI code, and persistence adapters do
  not reproduce that logic.
- Final integer-minor-unit allocations are persisted with the expense.
- Rounding should distribute unavoidable extra minor units fairly over time by
  tracking which members previously absorbed them and preferring members with
  the lowest accumulated rounding burden.
- Expense mutations follow the same offline command, outcome, audit, and
  compensating-reversal model as group and member mutations.
- Splitnext records a ledger for later external settlement. It does not move
  real money or integrate payment execution in the first version.

## Data and security boundaries

- End-to-end encryption is not planned. Server-side group state is readable by
  the service.
- Attachments and receipt files are outside the planned scope.
- Knowing a group identifier is not authorization after invitations replace
  the direct-join MVP.
- There is deliberately no participant-level access revocation or moderation
  role. The history-based group recovery path is the escape hatch for abuse.
