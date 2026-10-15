# App product direction

## Initial audience

The first audience is friends traveling together. Onboarding, examples, and
public-site messaging should make shared trip expenses the recognizable use
case without limiting the product to trips.

## First open beta

Anyone can create groups through the homepage or app without an access gate
or a beta request form. The beta focuses on creating groups, managing ledger
members, and sharing invite links so others can preview and join. Expense
recording and balances are outside this beta's scope. Present this limitation
briefly on the homepage; do not repeat it throughout the app. This is an open
beta rather than a private invited-testers release.

## Platform sequence

Ship the public landing page, invite join flow, and responsive web app first.
Bring the proven user flows to the React Native mobile app afterward.

## Identities and recovery

Remember the last active preferred member name used on this installation in
localStorage. Prefill the editable Your name field when creating a group or
joining/rejoining as someone new. Selection and renaming of the current
preferred member update that local default; leaving does not clear it.

Use the accepted installation-scoped anonymous identity model. Account
sign-in and account linking are not planned, as recorded in the current
product specification and ADR 0012. Losing or clearing an installation's
credential loses that installation's group access. A fresh installation
creates a new identity and needs a current invite link to join each group.
Keep this limitation documented here rather than repeating it in app sheets.

## Invite links

Opening an invite should hand off to the native app when it is installed.
Otherwise, the recipient can preview and join through the web flow; app
installation is optional. The handoff must preserve the invite token.
Keep the invite entry route for that handoff. In the web app, existing active
participants go directly to the linked group without a preview confirmation;
new participants continue to see the member chooser. Only show native app
controls when the handoff actually works.

## Repository and client structure

Keep the API, shared client SDK, public site, web app, and native app in one
repository as separate workspaces. Use one Expo Router application for the
responsive web client and native iOS and Android clients. Share the interface
where it fits while allowing platform-specific behavior; all clients use the
existing sync SDK and domain contracts.

## Public site and URLs

The public site has a concise product homepage and a distinct, direct join
route. Invite recipients should arrive at the join flow, not have to navigate
through marketing content first. Use one domain with the homepage at `/`, the
web app under `/app`, and group invites under `/join/{groupId}`. Invite URLs
retain the existing token fragment format so the token is not sent in ordinary
HTTP requests.

## Navigation and delivery

Use animated state-driven views within the app, with URL handling for incoming
join links and browser back/forward navigation. The saved delivery choice is
to render web entry pages on a Cloudflare Worker. The interactive app still
uses local persistent storage and the sync SDK for offline behavior.
Start each new page's entrance animation from its initial hidden state before
displaying its content. Keep the app header stable, and leave the underlying
page visible when opening or closing a sheet. Cancel an outgoing page's animation
when it unmounts, and respect reduced-motion preferences.
Tapping or clicking a sheet's backdrop dismisses it, just like Done. Interactions
inside the sheet do not dismiss it. Closing an edit sheet leaves unsaved edits
unapplied.

Member management stays in the group page as a compact editable Members list.
Use Add member at the end to insert a draft row already in edit mode, with a
focused name field. Blur saves a nonempty draft or discards an empty one. Tap
an existing name to edit in place; blur commits the change, while an empty
name restores the saved name. Enter/Done blurs to commit. Use no confirm/cancel
buttons for name edits. Keep the textbox at the exact name position with the
same row height and surrounding icons. Give the input 10px padding, a subtle
border, and matching inset space on the displayed name so text stays aligned. Retain drafts and inline feedback when
saving fails. Omit visible labels
on these self-explanatory fields while retaining accessible names. A person icon in
each row, left of the name, selects who is you, replacing the text button and
You badge. Tapping the name edits it without an edit icon. Omit actor-handle
subtitles such as User 1; retain those handles in shared-selection warnings.
Overlay one dot per identity currently selecting the name along the person icon's
right edge, with a white YOU badge in place of this installation's dot.
Keep the person artwork compact with a 44px tap target. Start one horizontal
row at the first dot's position, 26px from the icon's left edge and 2px below
its bottom. YOU comes first; other dots extend to its right with 2px gaps.
The row never wraps or truncates and may overflow freely to the right.
Dots are 12px; YOU is 30px wide and 16px tall, with bold text and a presence-colored
outline, aligned with the dots' bottom edges. Dot fills and outlines are
concentric with a narrow white gap. Green shows online, lightly filled gray shows
offline, and hollow shows unknown presence when the live connection is unavailable.
Give you a slightly larger filled green person silhouette on a pale rounded
background, within the same icon and tap-target dimensions. This highlight
identifies the preferred member independently of connection status; the badge
continues to show presence. Keep other selected names dark-filled and unused
names outlined.
Use accessible labels,
pressed state, and a 44px tap target. Omit member avatars and the heading count.
Keep you at the top, with smooth row movement when the selection changes;
show other claimed names next, then unclaimed names, retaining their order
within each set and honoring reduced-motion settings.
Use dark filled icons for other names currently selected by a joined participant,
and outlined icons for names no participant currently selects. Include the
joined status in the icon's accessible label without adding text to the row.
Include each participant's presence and which marker is you in that label.
A cross icon at the end of each row except the current you member removes it immediately without
confirmation. Call members removed in status messages and retain their ledger
history. Show only current members; omit the removed-member list and toggle. Keep shared-selection warnings and conflict
feedback beside the affected row.

On narrow screens and touch devices (including landscape phones), group
settings use a page with Back to group; creation and joining also use pages.
Keep drafts intact as the keyboard resizes the visible area, scroll focused
fields into view, and keep save controls in the scrollable content. Keyboard
Next moves from group name to your name during creation; Done submits supported
edits. Back dismisses the keyboard and leaves edits unapplied. Desktop pointer
layouts retain the group settings dialog. Sharing and conflict review remain
compact sheets with no editable inputs.

## App entry, creation, and appearance

Returning users reopen the last group they used, with a readily available
group switcher. If there is no accessible last group, fall back to the groups
list; if there are no groups, offer Create a group and Join with a link.
Omit a separate groups title and empty-list placeholder. Keep the group list
and its Create/Join actions together, with evenly sized actions on mobile.

Create groups in one view with Group name and Your name visible
together. Use one Create group submission and a Back to groups action; omit
step indicators, Continue buttons, and a duplicate group switcher. Currency
selection belongs in future expense entry; omit currency fields and settings
from group setup. Keep entered values after failed requests.
Submit the complete form once. Treat the group as
created only after a successful online server decision.

Use a calm, minimal visual direction: clean surfaces, restrained color, and
clear typography, with the animated view transitions already chosen.
Use restrained corners throughout: 4px for controls and fields, 6px for avatars
and status surfaces, and 8px for cards and sheets. Keep badges and the brand
mark similarly subtle.
Keep mobile screens compact, with readable inputs and touch targets of at least
44 pixels. Let field labels, action names, selected states, and grouping explain
the interface. Avoid explanatory, instructional, or promotional paragraphs in
app views and sheets. Retain concise error/status feedback and short
action confirmations. Show
controls only for supported actions; show rename saves only after edits, and
offer native sharing only where the browser supports it.
Align app navigation with the content width. Group related content closely:
group name in the header, and member rows in a continuous list. Size
sections to their contents rather than reserving empty panels or large gaps.

## Group setup and invitation experience

After creation, open the actual group with its name and a compact,
visible Members list. Initially the list contains
the creator, marked You. Keep Add member inline and Invite friends prominent.
Adding names and sharing an invitation can happen in either order; neither is
a required setup step. Ledger members can participate in future expenses
without using the app. Invite recipients can choose a previously added name.

The group-creation API creates the initial invite in the same transaction.
Tapping Invite opens a sharing sheet with the copy
icon inline with the invite-link field, Share link where supported, and Done.
Show New link, confirmed with Replace link, to regenerate the group's single
permanent invite resource;
omit creation and revoke actions. The initial link comes with group creation.
Every participant can copy or share the same current link. Regeneration updates
the shared link for everyone through group synchronization.
Use an accessible label and a checkmark to confirm copying. Links have no time
limit. Regeneration
invalidates the previous link while preserving existing access.
Done returns to the same group, with Share invite still
available. Creating or copying an invite does not mean anyone has joined.
Update group state through the existing synchronization and realtime behavior
as people join. Avoid a waiting screen or a forced continuation wizard.

Do not add the optional Who's coming creation step in the first build; revisit
it if testing shows that creators commonly want to enter a whole roster.

Keep Add expense absent while expenses are unsupported. When expense creation
is implemented in a later slice, make it the primary action from the first
group view without requiring invitation sharing or acceptance. Let that flow
help add missing ledger members. Keep the Members component compact enough to
move into the group header when expenses become the main content.

## Synchronization feedback

Show a contextual banner while the installation is offline, the server is
unreachable, or supported changes are waiting to synchronize. Hide it after
synchronization succeeds. Keep supported edits usable offline. Rejected or
superseded changes show one summary and local notices on the affected items,
as required by the existing product specification. Use a compact status line
with a pending count; show manual Retry only when the server is unreachable.

Creating, joining, leaving, and managing invitations require an online server
decision. Show their offline state in context while preserving entered
values when a request fails.

## Existing product behavior

The current product specification remains authoritative for group rename,
member add/rename/archive, preferred-member selection, duplicate-selection
warnings, leaving/rejoining, and invite regeneration. The app and dashboard
use the singular invite API through the shared SDK; the identity model stays
the same.
The dashboard remains the synchronization lab.

## Implementation sequence

Build small, reviewable vertical slices and leave changes uncommitted.

1. Add the shared app shell and /app entry, connect the existing sync SDK with
   persistent browser storage, and implement guided group creation plus the
   initial group view. Returning users reopen their last active group.
2. Add invitation creation/sharing and the public /join/{groupId} preview and
   member-selection flow, preserving the token fragment and entered values.
3. Complete group switching, group/member management, leaving/rejoining, and
   the offline/pending/conflict experience.
4. Finish the honest beta landing page, responsive polish, and view transitions.
   Validate the complete create/invite/join flow across two installations.

Run npm run check after each slice. Native builds follow the web release;
platform-specific storage and installed-app link handoff are validated then.
