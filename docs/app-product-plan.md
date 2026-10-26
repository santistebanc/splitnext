# App product direction

This document records where the product is heading and why. Screen-level
behavior lives in the [product specification](./product-spec.md), which is
authoritative wherever the two overlap; what exists today is in the
[README](../README.md).

## Initial audience

The first audience is friends traveling together. Onboarding, examples, and
public-site messaging should make shared trip expenses the recognizable use
case without limiting the product to trips.

## First open beta

Anyone can create groups through the homepage or app without an access gate
or a beta request form. The beta covers groups, invitations, ledger members,
expenses, balances, settling up with recorded repayments, and Activity with
undo. The homepage states that scope in one line; the app does not repeat it.
This is an open beta rather than a private invited-testers release.

## Platform sequence

Ship the public landing page, invite join flow, and responsive web app first.
Bring the proven user flows to the React Native mobile app afterward, from the
same Expo Router application.

## Identities and recovery

Use the accepted installation-scoped anonymous identity model. Account
sign-in and account linking are not planned, as recorded in the product
specification and ADR 0012. Losing or clearing an installation's credential
loses that installation's group access. A fresh installation creates a new
identity and needs a current invite link to join each group. Keep this
limitation documented here rather than repeating it in the app.

The installation remembers the last name it used for itself and prefills
Your name when creating or joining a group.

## Invite links

Opening an invite should hand off to the native app when it is installed.
Otherwise, the recipient previews and joins through the web flow; installing
the app is optional. The handoff must preserve the invite code. Existing
participants go straight to the linked group; new ones choose a name. Only
show native app controls once the handoff actually works.

## Repository and client structure

Keep the API, shared client SDK, public site, web app, and native app in one
repository as separate workspaces. Use one Expo Router application for the
responsive web client and native iOS and Android clients. Share the interface
where it fits while allowing platform-specific behavior; all clients use the
existing sync SDK and domain contracts.

## Public site and URLs

Use one domain with the homepage at `/`, the web app under `/app`, and group
invites under `/j#{code}`, with earlier links under `/join/{groupId}`. The
code stays in the fragment so it is not sent in ordinary HTTP requests.
Invite recipients arrive at the join flow, not marketing content.

## Delivery

A Cloudflare Worker renders the web entry pages and serves the API. The
interactive app keeps local persistent storage and the sync SDK for offline
behavior. Stay within Cloudflare's low-cost tiers.

## Visual direction

Calm and minimal: clean surfaces, restrained color, clear typography, and
animated view transitions that respect reduced-motion preferences. Mobile
screens stay compact with touch targets of at least 44 pixels. Labels,
selected states, and grouping explain the interface instead of explanatory
or promotional paragraphs; keep concise status and error feedback. Show
controls only for supported actions.

## Next

1. Deploy to a staging environment: create the D1 database, replace the
   placeholder id in `wrangler.jsonc`, and apply the remote migrations. Each
   step needs an explicit owner decision.
2. Validate the complete create, invite, join, expense, and settle-up flow
   across two real phones, including offline edits and reconnecting.
3. Open the beta on the production domain.
4. Build the native app: a SQLite storage adapter at the SDK's storage seam,
   the first iOS and Android builds, tests that drive them, and installed-app
   link handoff. Native push and update handling follow.
