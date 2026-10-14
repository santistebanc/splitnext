# Splitnext product specification

This document records the product behavior agreed during design discussions.
It is the durable source for what Splitnext should become. The
[README](../README.md) describes what exists today, while
[architecture decisions](./adr/) explain why the important technical choices
were made.

## Status and scope

The current MVP establishes identities, groups, ledger members, offline
synchronization, realtime revision announcements, and invite links. Expenses,
settlements, audit browsing, and group recovery are accepted future behavior
unless this document says otherwise. Account sign-in is not planned.

## First user-facing app beta

The first app beta exposes the existing groups, ledger members, and invitations
to friends traveling together. Anyone can create a group without a beta access
gate. Ship the responsive web app, public homepage, and invite join flow first;
native releases follow. Expenses and balances remain deferred.

Returning visitors reopen their last active group. Creation uses one view with
group name and the creator's ledger member name,
with one submission and a Back to groups action. Prefill Your name from the
last active preferred member name used on this
installation, saved in localStorage. The default stays editable and survives
reloads and leaving groups. Creating, joining, selecting a different member,
or renaming the current preferred member updates this local default.
Use the same default in the name field when joining or rejoining as someone new.
After creation, show the group and its Members list immediately, with inline Add member and prominent
Invite actions. Share invite stays the primary action until another participant
has joined, then becomes secondary. Adding names and inviting can happen in
either order. The groups list shows each locally stored group's active member
count and the member this installation uses. Sheets close with Escape and keep
keyboard focus inside them. Sharing
opens a compact sheet with a copy icon inline with the invite-link field,
native Share link where supported, New link, and Done. New link first asks
for confirmation, stating that the current link will stop working, with
Cancel and Replace link actions.
Show link actions directly without a Manage link disclosure. The copy icon
has an accessible label and changes to a checkmark after copying.
Done returns to the same group.
Creating a link does not imply anyone has joined.

Use a calm visual direction and animated state-driven views. Use compact mobile
layouts with clear labels and usable touch targets. Avoid
repeated explanatory text, duplicate actions, unsupported controls, and rename
save actions before a name changes. Use precise control labels rather than
static explanatory paragraphs in app views and sheets. Keep access-recovery
details in the product documentation and the current beta scope on the homepage. Keep URL handling
for public entry points and browser navigation. Show a contextual banner while
offline or while changes are pending; hide it once synchronization succeeds.
Keep rejected/superseded change notices as described below. Add expense remains
absent until supported, then becomes the primary group action without requiring
invitation acceptance. See [the app plan](./app-product-plan.md).

Use Members as the list heading, Add member for inserting a draft row, and Member
name for editing. Keep rows compact without avatars. Tapping a name edits that
row in place; losing focus commits the edit, without confirm/cancel buttons.
The textbox occupies the same space as the name, leaving icons and row height
unchanged. Enter/Done blurs the field to commit. An empty existing name restores
the saved name without removing the member. A clickable person icon selects
the preferred member in the same row.
Give it an accessible This is me/You label and pressed state, and retain
the joined status in its accessible label. Fill other members' icons in dark ink
when at least one active access identity currently selects that member; leave
unselected names outlined. This follows current preferred-member choices,
not a permanent ownership or historical attendance record. Retain
the warning and Use anyway confirmation when another identity uses the name.
Overlay compact markers along the right edge of each person icon, one per active access identity
currently selecting that name. Use a compact badge reading "YOU" in bold instead of a
dot for this installation's identity. It is 30px wide and 16px tall, with its
bottom edge aligned with the 12px dots. It occupies two dot slots on the far
right (26px including their gap), shifted 6px to the right within that slot
and growing upward.
The reserved slot has no visible dot or background. Its extra width overflows to the
right without moving the dots or changing wrapping. Its background stays white;
only its outline and text carry the presence color, green when connected and
gray otherwise. Dot badges have a filled
center and outer circular outline separated by a small surface-colored gap.
Use 2px horizontal spacing, 5px between stacked rows to clear the taller badge,
and a 44px row, fitting
three dot slots before wrapping upward; the YOU badge uses two of those slots.
Cap the display at two rows. When participants exceed that capacity, reserve
the final dot slot for an ellipsis marker. Always retain YOU; the person
button's accessible label continues to list every participant and their status.
Rows may slightly exceed the
person icon's width. Keep the person artwork compact in its 44px tap target,
independently of the overlay markers. Center each dot and ring on the same point.
Keep the dot's white gap narrow, with an 8px center in its 12px ring.
Green means connected; lightly filled gray dots
mean disconnected, retaining a clear outer ring; hollow means presence is unknown while reconnecting or when
this installation cannot observe live presence. A known local outage makes its
own you badge gray. Multiple tabs for one identity share one marker, and a member may
have several markers. Unassigned identities have no member marker.
Use a plain Members heading without a count. A cross icon at the end of each
row removes the member immediately, without a confirmation; hide it on the
currently selected you member. Removal archives
the member; the UI calls this removed and shows only current members, without
a removed-member list or toggle.
Add member inserts a new row in edit mode with a focused Member name field
without confirm/cancel buttons. Omit visible labels in member edit rows; keep
accessible field names and a placeholder for a new name. Blur creates a member
when the draft is nonempty, or discards an empty draft. Failed edits retain the
draft and show inline feedback.
Adding and editing members stay in the group page on every screen size.
Keep the preferred member (you) first, followed by names currently used by
at least one active participant, then unclaimed names. Preserve the original
order within each set; online status does not affect this ordering.
Animate rows into their new positions when preferred-member choices change, without
remounting editors. Respect reduced-motion preferences.

On narrow screens and touch devices, group settings, creation, and joining use
pages with an explicit Back action. Keep draft fields mounted when the keyboard
changes the visible height, allow scrolling above it, and support keyboard
Next/Done actions. Forms fill the visible area above the keyboard, including
when the browser pans to the focused field, without leaving a blank gap.
Back leaves unsaved edits unapplied. Sharing and conflict
review may use compact drawers because they need no editable fields. Desktop
pointer layouts may continue to use a dialog for group settings.

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

- A fresh installation automatically creates an anonymous access identity and
  device credential. An identity belongs to one installation; there is no
  account sign-in or account linking.
- A fresh installation on another device creates a separate identity. Joining
  a group there grants access to that identity, so its actor handle and history
  are separate even if it chooses the same ledger member as the first device.
  The person needs a current invite link for each group they join on that
  device.
- An identity may revoke its own device credentials. Group participants cannot
  revoke another identity's device or group access.
- Each group assigns an identity a stable actor handle in join order, such as
  “User 1” or “User 6.” The handle remains usable when the identity has no
  preferred member.
- Device credentials are stored only as hashes on the server. The current
  group invite token is retained so every authorized participant can share it.

## Groups and access

- A group is created with a name and the creator's initial ledger
  member name. Creation gives the creator permanent access and makes that
  member the creator's preferred member. The same API request atomically creates
  the initial invite, ready to copy or share immediately.
- Clients generate group identifiers before creation. Repeating creation with
  the same normalized input is a retry; reusing the identifier with different
  input is a conflict. The creation request includes a client-generated invite
  id and token. Retries reuse them and cannot restore a link replaced later.
- A group can be renamed. It is never closed or deleted.
- Groups have no currency or currency setting. Currency is selected when an
  expense is added; there is no installation-wide currency preference.
- Leaving a group clears the identity's preferred member, hides the group from
  that identity, and stops its synchronization and realtime notifications.
  It does not revoke access or alter any ledger member.
- Rejoining unhides the group and selects or creates a preferred member.
- Any identity can create groups and join others' groups. Each identity has a
  list of the groups it can access that distinguishes joined groups from ones
  it left, which it can reopen and rejoin. The list may briefly show an old
  group name until that group next synchronizes.
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
- Joining or rejoining by entering a name that matches an active member after
  normalization selects that existing member, even when another identity uses
  it. No duplicate member is created. The proposed new member id becomes an
  alias of that existing member, matching the normal member-add behavior.
- App member rows show the preferred member through the selected person icon,
  without actor-handle subtitles. When an identity selects a member already
  preferred by someone else, the UI names those actor handles in a warning
  but allows the choice.
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

- Realtime revision messages announce that a newer group revision may exist.
- A client receiving an announcement synchronizes through the normal snapshot
  path. It never applies the announcement itself as authoritative state.
- Disconnects, duplicate messages, missed messages, and reordered messages must
  be harmless.
- A client that leaves or hides a group stops receiving its announcements.
- Every new connection first announces the current revision, so reconnecting
  is how a client catches up on anything it missed.
- Announcements follow applied changes. Synchronizations that apply nothing do
  not wake other clients.
- Separate presence messages list the identities with open live connections.
  Presence is transient, never persisted in ledger snapshots or audit history,
  and never advances the group revision. Initial connections and disconnects
  refresh the roster; an identity stays connected until its last tab disconnects.
  A lost local connection clears the roster to unknown. Abrupt remote network
  loss is reflected when the server detects the connection ending; this is
  connection status, not proof that someone is viewing the screen.

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

## Invitations

- An identity joins a group for the first time only through the group's
  reusable invite link. Individual or single-use member invitations are not
  part of the first version. Identities that left rejoin without a link,
  because their access is permanent.
- Every group has exactly one current link, initialized atomically during group
  creation. The link never expires. Any participant can regenerate it,
  atomically replacing the token and invalidating the previous link while
  retaining historical records for audit and retries. There is no standalone
  revocation action that leaves a group without a link.
- The HTTP API treats this as one resource: PUT /groups/{groupId}/invite replaces
  it, with a client-generated invite id and token reused for retries. Successful
  updates return 200 and current metadata. Retrying an old replacement never
  restores its token or overwrites a newer link, and returns the current link's
  metadata. Preview uses POST /groups/{groupId}/invite/preview.
- Redeeming a valid link atomically issues a permanent group access grant and
  lets the identity select an active member or create its preferred member.
- Regenerating a link never removes access already issued through it.
- Join URLs have the form `/join/{groupId}#{token}`. The token follows `#` so
  ordinary page requests and referrers omit it.
- The invite link belongs to the group. Every participant receives the same
  current token in authenticated creation, join, and synchronization responses
  and can copy or share it without regenerating it. Clients retain it with the
  group snapshot for offline sharing. Regeneration updates that shared resource
  for everyone through normal synchronization and realtime announcements.
- Clients generate tokens before creation and regeneration for retry safety.
  The server retains the current token and uses its hash to validate redemption.
  Public invite previews, audit history, and diagnostic logs omit tokens.
- Before joining, a link holder can preview the group name and its active
  members to choose who they are or join as someone new. The preview marks
  members whose names a current participant already uses (In use); choosing
  one is still allowed. Show available names first and In use names last,
  preserving their order within each set. Fade unselected In use choices
  slightly; selecting one restores the full selected highlight. Apply the
  same ordering and styling when rejoining.
- Opening an invite for a group this installation already actively participates
  in opens that group directly, preserving its preferred member and clearing
  the token from the URL. No preview or Open group confirmation is shown, and
  the token need not still be current because access is permanent. Leave the
  `/join/{groupId}` entry route available for future native app handoff.
  New participants and identities that left still choose a member before joining.
- Any participant can regenerate the link; there are no roles.

## Expenses and money (deferred)

- Each expense records its original amount, an explicit currency code, and
  allocations in that currency. A group may contain expenses in several
  currencies. Currency selection belongs in expense entry, not group setup.
- Expense entry may suggest a currency from an explicit device/browser locale
  region, then IP country when available, then EUR. Language alone is not a
  country; unknown regions fall through. The optional lookup never blocks entry,
  and the person can change the suggestion before saving the expense. A
  suggestion never changes an existing expense.
- Balances are calculated and shown separately for each member and currency.
  For example, if Santi is owed EUR 30 and owes USD 20, show both balances;
  never net them into a single number. Expenses in the same currency combine
  normally. There is no combined converted total or exchange-rate dependency.
- A recorded settlement includes its amount and currency and reduces only the
  corresponding currency balances. Settlement suggestions keep currencies
  separate, with no automatic cross-currency offset or conversion.
- The first expense version has one payer, but the persisted model and money
  module must be extendable to multiple payers without redefining an expense.
- An expense may include any subset of active ledger members.
- Allocation supports equal shares, unequal shares, exact amounts, and a mix of
  exact amounts and shares.
- All allocation, validation, and deterministic minor-unit rounding lives
  behind one pure money module. API routes, UI code, and persistence adapters do
  not reproduce that logic.
- Final integer-minor-unit allocations are persisted with the expense, using
  that currency's precision. Balances must sum to zero separately in each
  currency; currencies cannot share a rounding burden.
- Rounding should distribute unavoidable extra minor units fairly over time by
  tracking which members previously absorbed them in the same currency and
  preferring members with the lowest accumulated rounding burden there.
- Expense mutations follow the same offline command, outcome, audit, and
  compensating-reversal model as group and member mutations.
- Splitnext records a ledger for later external settlement. It does not move
  real money or integrate payment execution in the first version.

## Data and security boundaries

- End-to-end encryption is not planned. Server-side group state is readable by
  the service.
- Attachments and receipt files are outside the planned scope.
- Knowing a group identifier is not authorization; joining needs a current
  invite link.
- There is deliberately no participant-level access revocation or moderation
  role. The history-based group recovery path is the escape hatch for abuse.
