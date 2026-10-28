# Splitnext product specification

This document records the product behavior agreed during design discussions.
It is the durable source for what Splitnext should become. The
[README](../README.md) describes what exists today, while
[architecture decisions](./adr/) explain why the important technical choices
were made.

## Status and scope

The current MVP establishes identities, groups, ledger members, offline
synchronization, realtime revision announcements, invite links, and
expenses, repayments, Activity, safe undo and an Activity bell.
Group recovery remains accepted future behavior. Account sign-in is not planned.

## First user-facing app beta

The first app beta exposes the existing groups, ledger members, and invitations
to friends traveling together. Anyone can create a group without a beta access
gate. Ship the responsive web app, public homepage, and invite join flow first;
native releases follow. Expense entry and per-currency balances are now
available, together with repayments, cached Activity, safe undo and an
Activity bell.

Returning visitors reopen their last active group. Creation uses one view with
group name and the creator's ledger member name,
with one submission and a Back to groups action. Prefill Your name from the
last active preferred member name used on this
installation, saved in localStorage. The default stays editable and survives
reloads and leaving groups. Creating, joining, selecting a different member,
or renaming the current preferred member updates this local default.
Use the same default in the name field when joining or rejoining as someone new.
After creation, open the group screen. Its balances end with an inline Add a
person row, and Invite in the balances heading opens the invite link in a
bottom sheet, so adding names and inviting can happen in either order. The
groups list shows each locally stored group's people count and the member this
installation uses. The invite sheet shows the link in the monospaced face;
tapping it selects and copies it. Below sit native Share where supported and
Regenerate, side by side. Regenerate first
asks for confirmation titled “Regenerate invite link?” in the same sheet, explaining that it creates a new link and the old link will stop
working while everyone already in the group keeps their access, with Cancel and
Regenerate actions.
Show link actions directly without a Manage link disclosure. Under the link,
Tap the link to copy it changes to Copied with a checkmark after copying.
Creating a link does not imply anyone has joined.

Use a calm visual direction and animated state-driven views. Use compact mobile
layouts with clear labels and usable touch targets.
Drawers share the currency picker's compact scale: 15px body and action text,
48px rows and buttons. Screen headers, standalone page titles, drawer titles,
and confirmation titles share one 18px title style. Titles keep the same size
when scrolling; header spacing and context labels can still compact.
Draw textbox keyboard focus
outlines inside the field's edge so scroll containers and inline actions cannot
clip them. Avoid repeated explanatory text, duplicate actions, unsupported controls, and rename
save actions before a name changes. Use precise control labels rather than
static explanatory paragraphs in app screens. Keep access-recovery
details in the product documentation and the current beta scope on the homepage. Keep URL handling
for public entry points and browser navigation. While offline, or while the
server cannot be reached, show a thin, neutral strip above the header in
every view. It stays outside the scrolling content, showing Offline or
Can’t reach splitnext and the number of changes saved here. Tapping it opens
connection details with that status and Retry when the network is available.
Close the details and hide the strip on reconnect. Background connection failures do not show a second banner;
keep failures of actions requiring a connection beside those actions, and
keep storage, protocol, and other background errors visible.
Keep rejected/superseded changes for review as described below. Add expense is
the primary group action and does not require invitation acceptance. See
[the app plan](./app-product-plan.md) for product direction.

The balances list everyone in the group with their balance per currency, you
first on a tinted row with a blue You label, then everyone else from most
negative to most positive balance (owing first, then settled, then owed; in
several currencies, a debt in any currency sorts first), then people in no
current expense or repayment yet, and a last Add a person row. Typing a name there and ending
the typing (leaving the field, Enter, or Done) adds the person without a
confirm step; an empty draft is discarded, and a failed add keeps the draft
with inline feedback. Keep rows compact without avatars. Show a settled zero,
such as 0.00 EUR, in green for each currency the person has current records in;
leave the amount blank only when no current expense or repayment names them.
A presence marker beside each name shows a filled green dot when at least one
identity selecting the name is connected, a gray ring when they are known to be
disconnected, and a dashed ring when no identity selects the name. Person
details spell it out, such as Online · taken on 2 devices or Not taken on any
device. This follows current preferred-member choices, not a permanent
ownership or historical attendance record. Multiple tabs for one identity count
once.

Tapping a person opens their details: their name and presence, their balance in
each currency (Owes or Gets back), or a numeric zero labelled Settled when their expenses and
repayments cancel out in that currency, or No expenses yet when no current expense or
repayment names them, Settle up with the number of payments in the
group's plan that involve them, and Rename, I’m [name], and Remove. Settle up is
hidden for a settled person. Rename edits the name in place, committing on
leaving the field or Done; an empty name restores the saved name. I’m [name]
makes that member you on this device without asking first; when another device
already has the name taken, an inline warning says so afterward. Only someone with a
zero balance in every currency can be taken out; otherwise the action is
disabled with Settle up first. It is called Hide when any expense or repayment
has named them, removed ones included, since they are kept for history, and
Remove otherwise. Either is immediate, without a confirmation, including the
current you member. A toast names the person, hidden or removed, without Undo,
and Activity can restore them later. A hidden member who has a balance again,
such as from an offline change, stays in the balances marked removed, with
Restore in their details. Below the actions, the details list every current expense and
repayment behind the balance, one row each, newest first, grouped by currency,
and end each currency with a Balance row; the rows add up exactly to it.

Every app screen is a page on every device: a fixed header with Back or Cancel,
an optional compact title or a matching page title below it, an optional end
action such as Save, and at most one main action pinned at the foot of the
screen. The invite link and the confirmation of leaving a group open as bottom
sheets over the page. Keep draft fields mounted when the keyboard
changes the visible height, allow scrolling above it, and support keyboard
Next/Done actions. Forms fill the visible area above the keyboard, including
when the browser pans to the focused field, without leaving a blank gap.
Back and Cancel leave unsaved edits unapplied.

Pending member saves protect their draft and target across UI, devtools, and
other callers. While saving, prevent repeated saves, changing or closing that
editor, navigation that discards it, and competing mutations of that member.
Unrelated ledger edits remain available. Success or failure releases the
protection; failures retain the draft. Devtools includes a live state/actions
map derived from the same workflow and catalog used for dispatch.

Confirmations apply to the group and navigation context in which they were
requested. Later navigation takes precedence over a completed leave. Connection
events update immediately during pending requests. Only connection failures use
offline fallback; protocol, server and storage failures stay visible with saved
intent retained. Background refreshes share pending work and back off retries.
Devtools traces connect action invocation, workflow changes, queued commands,
requests and outcomes without logging credentials, invite links or draft inputs.

## Agreed feature port from the earlier app

These decisions extend the accepted product behavior. Appearance, group summaries,
repayments, Activity, safe undo and the Activity bell are implemented. The
earlier app is a feature reference; this repository's existing decisions
continue to govern identity, invitations, member removal, money, and sync.

### Appearance

Use one fixed light theme, which replaced the earlier Calm receipt theme:
white cards with a hairline edge on a cool grey page (`#F2F4F6`) with near-black
ink (`#10161D`). Body text uses IBM Plex Sans, amounts, currency codes and
invite links use IBM Plex Mono, and page titles, group names and empty-state
titles use Bricolage Grotesque. One blue (`#1B5FC1`) marks the main action on
each page and links. Blue figures mean someone gets money back and orange
(`#A9470C`) means someone owes it; green means settled or online. A brighter
orange (`#C2410C`) marks the Activity badge and changes waiting for review. Do
not add theme settings, light/dark switching, or system appearance
switching.

Reuse the earlier app's original blue split-S logo, preserving its artwork
and `#60A5FA` blue. Show the logo on the groups list and the join screen, not on
group, expense, repayment, creation, or settings screens.

### Screens and navigation

Follow the agreed phone design. App screens use one narrow column on every
device.

The groups list has the logo, the name and a Join button in its header, a
large Your groups title, and one card per group showing its name, people
count, You’re and the member name, and your balance per currency as a signed
amount, Settled with a check when every balance is zero, or Choose who you are.
Show N groups you left expands the left groups, and New group is pinned at the
foot. New group is a page with a large title, Group name and Your name in this
group, a note that the invite link comes right away, and a pinned Create group
action that shows Creating… with a spinner while it works.

A group opens on one screen, without tabs. Its fixed header has the group name,
which opens the groups list, and a bell opening
Activity, and a gear button beside the bell opening Group settings. Settings
contains the Group name field and Leave group, with Save group name shown only
after the name changes. Back discards unsaved edits; leaving keeps its
confirmation sheet. Below the group header, the page is one scroll area with two sections styled
alike, each a heading over one card of rows: Balances, with Invite people at the end
of its heading, then Expenses. While there are no active expenses, Invite people
is solid brand blue with white text, and Add expense uses a quieter blue fill.
Once an expense exists, Invite people becomes the quieter button and Add
expense takes the solid fill. Both keep the same label, position, and size.
While the group's plan has any payment, a quieter Settle up button sits before
Invite people in the Balances heading and opens Settle up for the whole group.
No list scrolls on its own. The balances card
lists people and ends with an Add a person line. It has three levels. By
default it shows everyone, unless that would leave no room for the Expenses
heading and the first two expenses; then it shows the people who fit,
followed by a faded, centered “···”, which jumps back to the top and shows everyone, and the Add a
person line waits until everyone shows. Expenses follow the card with only
the disclosure button's lower half and normal section spacing below it;
unused viewport room is not reserved. Scrolling shrinks
the card along with the scroll, so the expenses stay right below: the Add a
person line goes first, then a person who would be partly cut gives way to
the “···” item, which shrinks with it, until only
the Balances heading is left, pinned at the top. People always show whole.
The Expenses heading pins right under it while the expenses scroll; tapping
it scrolls until the expenses start there. Tapping the heading scrolls
smoothly back to the top. Showing everyone lists them in the page with a
faded “···” as the last item, which scrolls back to the top and shows fewer again, and the heading stays pinned once it
reaches the top.
Expenses and recorded repayments are listed newest first, each opening their
editor, with + Add expense floating at the foot, including before the first
expense and after the last one is removed. Keep the same label and position;
show no empty-expenses illustration or message. An unassigned installation is asked
to tap its name in the balances.

Tapping a person opens their details (see above), and their Settle up opens the
payments in the group's plan that involve them, per currency, each From → To
with its amount and Record, plus Record a different payment. Tapping a payment
opens the repayment form filled in. The repayment form is a page with Cancel and
Record (Save when changing one), then a sentence, “Jonas paid you”, whose names
open the people in place, a large amount with its currency, a caption saying
whether it is the full amount owed, and earlier repayments, each opening in the
form. Editing a saved repayment shows a short Delete action beside Save in
the header, with no second delete action in the body. New repayments have no
Delete action. Cancel and Record return to where the form was
opened, such as Settle up.

The expense editor follows the original Splitnext form: Cancel, Add (Edit
expense when changing one), and Save in the header; Paid by opening the names
in place; a large centered monospaced amount with its currency symbol and an
editable currency code; Split between; then Occasion. The amount accepts
digits and a decimal dot or comma, displaying a dot and fixed decimal places
after each keystroke (two for EUR/USD, the currency's minor-unit precision
otherwise). Keep the caret usable for insertion, replacement, and deletion.
Reject ambiguous or over-precise pasted amounts. Show the member's actual
name with a You badge rather than replacing it with You. While the total is
empty or zero, split rows show only the vertically centered name, You badge,
and participation checkbox. Share arrows and per-person amounts appear once
a positive total is entered, preserving any existing shares or fixed amounts.
Each split row then shows
the person's name and calculated amount, an increase arrow, and a checkbox at
one share or a decrease arrow above one share or for a fixed amount. Share
arrows and selected checkboxes use the same soft solid blue fill and darker
blue icons. Keep names, up arrows, right-aligned amounts, and down arrows or
checkboxes in consistent columns, including excluded people. Excluded
people stay in place with an empty checkbox. Arrows adjust whole shares and
reduce equivalent share counts together. Tapping a person's amount edits a
fixed value, shown in blue; everybody else divides the remainder by their
shares. Clearing the fixed value restores one share; increasing a fixed person's
share returns it to the next whole proportional share, while decreasing it
excludes them. Keep one person sharing the remainder. Show the equal split
caption, such as 28.20 each · 5 people, or Custom split · 5 people when amounts are fixed
or weights differ. Preserve both fixed amounts and weights when reopening and
saving an expense. Invalid precision or amounts above the total retain their
input and prevent saving. Do not show a bottom-of-page prompt asking for a
description; Save remains unavailable until the required fields are filled.
Changing an expense adds Remove expense below.
Expense rows have no inline remove action.

Activity is one chronological list grouped by day, without filters, below a
Needs your review block (see Conflict-notice experience). Each entry names who
did what, with Undo or, for removals, Restore where safe.

Details, Settle up, forms and Activity are pages with Back to where they were
opened. Every screen is in browser Back/Forward history, and repayment drafts
survive screen changes. Opening or switching groups starts on the group screen
with the balances expanded.

### Group summaries

Each group row shows the preferred member's nonzero balances separately by
currency. Show Settled only when every currency balance is zero. When the
identity has no preferred member, show Choose who you are rather than a zero
balance or Settled. Retain member counts, preferred-member labels, offline
access, and left-group/rejoin behavior.

### Settlements

Explicitly identify a settlement as a recorded repayment. Do not infer one
from an ordinary expense's payer and allocation. Settlements affect balances
but do not count as spending. They record money already paid outside the app;
recording requires no recipient approval and never executes a payment.

Settle up plans the fewest payments that settle the whole group, separately
within each currency, and may skip people in the middle: if Ana owes Ben EUR 20
and Ben owes Cara EUR 20, Ana pays Cara EUR 20. The plan is exact for up to 14
people with a balance in a currency and falls back to a deterministic greedy
plan above that. A person's Settle up shows only the plan's payments involving
them; the group's Settle up, opened from the Balances heading, shows every
payment in the plan. The payments themselves are not listed on the group screen.

Picking a payment opens the repayment form with payer, recipient, amount, and
currency filled in and the amount editable for a partial payment. Record a
different payment opens the same form for any other repayment. A repayment may
be any positive amount between two distinct ledger members, including partial
repayments and overpayments. An overpayment reverses the remaining balance
normally. A removed member with an outstanding balance remains available for
repayment without being restored to the active member list; this is an
exception to excluding removed members from new activity, not permission to
add new expenses for them.

Any participant can record, edit, remove, or restore any settlement, including
offline. Apply the expense lifecycle's intent and conflict rules: edit against
the version opened, reject editing a removed record, remove without silently
discarding history, and restore exactly the recorded repayment. Balance and
history references to removed members remain valid. Settlement arithmetic uses
the existing currency precision and pure money boundary, without conversion
or silently forgiving small balances.

### Activity and safe undo

Activity shows expense and settlement changes, member additions, removals and
renames, group creation and renames, participants joining or leaving, and invite
replacement. Presence and preferred-member selections do not appear in the
feed. Existing append-only audit attribution remains authoritative.

Any participant may undo another participant's reversible action, without a
time limit, while it remains safe. Member additions, renames, removals,
restorations, and earlier member reversals have no Undo, in either Activity
or the member-removal toast. These simple changes can be corrected manually.
Group creation, joining, leaving, and invite replacement also have no Undo.
Expenses, repayments, and group renames retain safe Undo.

An undo cannot overwrite a later change to the affected information. Explain
why an action cannot currently be undone. Unrelated changes elsewhere in the
group do not make an undo stale. Recheck safety on the server when applying
the compensating command; an offline undo that becomes stale uses the normal
conflict-notice experience.

An undo creates a new visible Activity entry identifying who reversed which
action. The reversal can itself be undone while safe. Never delete, rewrite,
or hide the original audit event as the implementation of undo.

### Activity bell

Changes from other people never pop up. The bell in the group header shows a
count of new Activity entries from other access identities plus this device's
changes waiting for review. Compare identities, not preferred-member names, when
leaving out this installation's own actions. The first time a group's Activity
loads on an installation, everything already there counts as seen.

Opening Activity highlights new entries with a New tag; Mark all seen clears
them and the count. Seen positions are kept per group on the installation.
Pending, offline, failed-sync and review feedback stay independently visible.
Background push is deferred to native releases.

### Replacement scope

Implement in this v4 repository, using the earlier app at `code/splitnext` as
the reference. Existing development and earlier-app data may be replaced; no
migration or compatibility layer is required. This is authorization for future
replacement work, not an instruction to wipe data as part of writing specs.
Native releases, native push, native storage, and native update handling remain
later work. History-based group recovery remains accepted future work outside
this feature port.

## Product principles

Every user-initiated change in the app, including navigation, opening and
closing panels, editing drafts, selecting join names, showing left groups,
copy/share, retry, and confirmation decisions, goes through the same action
catalog as domain operations. These UI actions update shared local screen
state so devtools and other callers operate the visible app. Organize the
devtools catalog into UI, Ledger changes, and Access & sync by primary
purpose; open UI by default and browse actions by tab without a search field.
Member selectors for removing a member or choosing who is you default to
another member when available while keeping the current you selectable.
Omit secondary categories and an All tab. Use a single navigation row
with an active underline for these tabs, visually distinct from the outlined
action buttons. Let the row scroll horizontally on narrow screens. Place available
actions first and fade unavailable actions at the bottom of the same list,
without a separate section, keeping them
selectable for inspection; disable dispatch with a short
reason and update availability as state or inputs change. Use the same
preconditions for discovery and execution, retaining offline ledger edits.
Keep the devtools widget and panel above app dialogs and popups, with working
pointer and keyboard controls while a dialog is open.
Keep automatic synchronization and animation
outside user actions. Draft changes do not submit ledger commands.

Use explicit local workflow phases for creation, joining, invite checking,
and settings saves. Availability and dispatch share the same transition rules.
While creating, joining, or saving, disable repeated submissions, draft edits,
and navigation until the operation settles. Failures retain the draft and
restore the editable phase. Keep fields mounted when the phase changes.
Invite checks may be abandoned or superseded by editing the link; obsolete
responses cannot change the current view, preview, or selected group.
Connection status stays independent of workflow state, and direct ledger
operations remain available without opening an editor, including offline.

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
  It does not revoke access or alter any ledger member. A preferred-member
  choice that reaches the server after leaving is rejected (`group_left`).
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
- Member names may repeat. Each added member is its own member, even when
  two devices add the same name while offline (ADR 0020). Wherever a name is
  shown and another active or hidden member shares it after normalization, the
  app adds a name ordinal, such as “Ana (2)”, numbered in creation order. The
  ordinal is never part of the name and disappears once the name is unique.
- Any participant may add or rename a member.
- Removing a member hides it when any expense names it, removed expenses
  included, and deletes it otherwise (ADR 0018). The app offers it only once
  the member's balance is zero in every currency, calling it Hide or Remove
  accordingly. Both are kept in the group:
  historical references remain valid, and neither is offered for new activity.
  A hidden member still appears in a currency's balances while it is not zero.
- An expense that arrives after its member was removed still applies; a
  deleted member it names becomes hidden.
- Restoring a hidden or deleted member makes it active again.
- Removing a member clears it as the preferred member of every identity that
  selected it. Those identities remain authorized but become unassigned, and
  restoring the member does not bring the choice back.
- Each identity may change only its own preferred member. It may select any
  active member or create a new one.
- Preferred-member selection is nonexclusive. Several identities may select the
  same member.
- Joining or rejoining as someone new adds a new member, even when an
  existing member has the same name; choosing an existing member is a
  separate choice in the join flow. Label the new-member option Someone else,
  with a dashed outline and a plus icon to distinguish it from existing names.
  Keep it a radio choice; selecting it reveals Your name.
- App member rows show the preferred member with a You label, without
  actor-handle subtitles. Selecting a member already preferred by someone else
  needs no confirmation; the UI warns afterward that the name is already taken
  on another device. Use Taken consistently for preferred-member choices in
  app labels, presence captions, and warnings; the choice stays nonexclusive.
- Joining normally requires selecting an active member or creating one, so the
  new identity initially has a preferred member. Being unassigned remains valid
  after leaving or after that member is removed.

## Offline client model

- A client keeps a durable local snapshot, its last confirmed group revision,
  an ordered command outbox, and local conflict notices.
- Production PWA clients should be able to use IndexedDB and React Native
  clients should be able to use SQLite. Synchronization logic must depend on a
  storage interface rather than either database.
- Ordinary group, member, expense, and repayment edits may be queued offline and
  projected optimistically with the same deterministic rules used by the
  server.
- Actions that establish or deliberately stop authority require an online
  server decision. These include creating or joining a group, leaving/hiding a
  group, managing invites, and revoking a device credential. Leaving starts only
  online; if the connection drops before the server answers, the group shows as
  left and the queued leave completes on reconnect instead of reporting a
  failure.
- Reconnecting sends the ordered outbox as one synchronization batch. Transport
  failure leaves the outbox intact for retry.
- Joining or rejoining first delivers the group's outbox, so intent reaches the
  server in the order it was made. Rejoining keeps unreviewed notices.
- An unreachable server is treated like being offline: ordinary edits still
  queue and project locally, and are delivered once the server responds.
- Local storage implementations and Cloudflare persistence are adapters; their
  details are not shared between clients and the server.

Retrying a conflict notice atomically retains fresh intent in the outbox and
retires the old notice. A storage failure preserves the old notice. Retry
uses the current projected rename preconditions and fresh command identifiers;
a later rejection produces a new notice.

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
- Changes waiting for review count on the group's Activity bell and appear
  first in Activity under Needs your review, each resolved there with Apply
  again or Dismiss. An affected expense or repayment shows a small orange dot.
  No other review status shows elsewhere. With nothing left to review, omit
  this section and show the Activity history directly.
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
  metadata. Preview uses POST /invites/preview with the code alone, or
  POST /groups/{groupId}/invite/preview for an earlier link.
- Redeeming a valid link atomically issues a permanent group access grant and
  lets the identity select an active member or create its preferred member.
- Regenerating a link never removes access already issued through it.
- Join URLs have the form `/j#{code}`, where the code is 12 random letters and
  digits (about 71 bits) that alone identify the group (ADR 0024). The code
  follows `#` so ordinary page requests and referrers omit it. Links made
  earlier, `/join/{groupId}#{token}` with a 43-character token, keep working
  until the link is replaced.
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
  members whose names are already taken on another device (Taken); choosing
  one is still allowed. Show available names first and Taken names last,
  preserving their order within each set. Fade unselected Taken choices
  slightly; selecting one restores the full selected highlight. Apply the
  same ordering and styling when rejoining.
- Opening an invite for a group this installation already actively participates
  in opens that group directly, preserving its preferred member and clearing
  the token from the URL. No preview or Open group confirmation is shown, and
  the token need not still be current because access is permanent. A short
  link is matched against the groups stored on the installation, so it opens a
  joined group offline too. Leave the `/j` and `/join/{groupId}` entry routes
  available for future native app handoff.
  New participants and identities that left still choose a member before joining.
- Any participant can regenerate the link; there are no roles.

## Expenses and money

Expenses and settlements are accepted behavior.

- Each expense records a required description, its original amount, an
  explicit currency code, its payer, and allocations in that currency. It has
  no expense date; the list shows expenses newest recorded first. A group may
  contain expenses in several currencies. Currency selection belongs in
  expense entry, not group setup.
- Expense entry suggests the currency used most often among the group's last
  ten current expenses, ties going to the most recent; then the currency of an
  explicit device/browser locale region; then EUR. Language alone is not a
  country; unknown regions fall through. The person can change the suggestion
  before saving, and a suggestion never changes an existing expense.
- Entry starts with the person's you member as payer, when they have one, and
  every active member sharing equally.
- Any participant may record, edit, remove, or restore any expense.
- Editing replaces everything entered for an expense and is superseded when
  someone changed it after the version the person saw. Editing a removed
  expense is rejected.
- Removing an expense takes it out of balances whatever version the person
  saw, since restoring undoes it. A removed expense is kept and can be
  restored exactly as recorded, with its original allocation. Restoring will
  be offered through the group's Activity; there is no removed-expense list.
- Balances are calculated and shown separately for each member and currency.
  For example, if Santi is owed EUR 30 and owes USD 20, show both balances;
  never net them into a single number. Expenses in the same currency combine
  normally. There is no combined converted total or exchange-rate dependency.
- A recorded settlement includes its amount and currency and reduces only the
  corresponding currency balances. The settle-up plan keeps currencies
  separate, with no automatic cross-currency offset or conversion.
- The first expense version has one payer, but the persisted model and money
  module must be extendable to multiple payers without redefining an expense.
- An expense may include any subset of active ledger members, and its payer
  need not be one of them. Entry offers only active members, but an expense
  that arrives after a member it names was removed still applies.
- Allocation supports equal shares, unequal shares, exact amounts, and a mix of
  exact amounts and shares.
- All allocation, validation, and deterministic minor-unit rounding lives
  behind one pure money module. API routes, UI code, and persistence adapters do
  not reproduce that logic.
- Final integer-minor-unit allocations are persisted with the expense, using
  that currency's precision. Balances must sum to zero separately in each
  currency; currencies cannot share a rounding burden.
- Rounding distributes unavoidable extra minor units fairly over time:
  each expense records which members absorbed one, a member's burden in a
  currency counts those across that currency's current expenses, and new
  extras go to members with the lowest burden there (ADR 0019). Removing,
  restoring, or editing an expense therefore changes the burden exactly.
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
