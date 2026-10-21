# Splitnext

Splitnext is an offline-first shared-expense ledger. Its language keeps access,
people represented in the ledger, synchronization, and history distinct.

## Access

**Access identity**:
The server-side actor created for one installation, used for authorization and
group history.
_Avoid_: Member, device, account

**Device credential**:
A secret held by an installation that authenticates its access identity.
_Avoid_: Access grant, member token

**Group access grant**:
Permanent permission for an access identity to participate in a group.
_Avoid_: Membership, member access

**Actor handle**:
A stable, group-local label such as “User 6” assigned to an access identity.
_Avoid_: Username, member name

**Participant presence**:
Whether an access identity is currently connected to a group, independent of
its permanent access or preferred-member choice.
_Avoid_: Membership, attendance, ownership

**Group invite**:
A group's single reusable link that issues permanent group access grants.
Every participant can copy or share the same current link.
It has no time limit; changing it replaces the token and invalidates the old
link while leaving previously granted access intact. Its link carries only a
short invite code, which identifies the group.
_Avoid_: Access grant, individual invite

**Invite preview**:
What a link holder sees before joining: the group and its active members.
_Avoid_: Group snapshot

## Ledger

**Ledger member**:
A named person represented in expenses, balances, and settlements; it is not an
access identity or authorization record.
_Avoid_: User, account

**Name ordinal**:
The number, such as “(2)”, shown after a ledger member's name while another
member has the same name; it is never part of the name.
_Avoid_: Member number, suffix

**Preferred member**:
An access identity's nonexclusive choice of which active ledger member its UI
calls “you.”
_Avoid_: Claimed member, owned member

**Hidden member**:
A ledger member with expense records, no longer offered for new expenses but
kept for history and restorable.
_Avoid_: Archived member, removed member

**Deleted member**:
A ledger member removed while it had no expense records; it is no longer shown
or offered for restoring, but the group still keeps it.
_Avoid_: Hidden member, archived member

## Money

**Expense**:
A described amount one or more ledger members paid in one currency, with the
allocation of who owes what for it.
_Avoid_: Transaction, bill, payment

**Removed expense**:
An expense excluded from balances but kept, and restorable, in the group.
_Avoid_: Deleted expense

**Expense currency**:
The currency in which an expense's original amount and allocations are recorded.
A group may contain expenses in several currencies.
_Avoid_: Group currency, global currency, display currency

**Minor unit**:
The smallest amount a currency records, such as a euro cent; amounts are whole
numbers of it.
_Avoid_: Decimal amount, float

**Allocation**:
The whole number of minor units each member owes for one expense, fixed when
the expense is recorded: exact amounts first, then the rest split by shares.
_Avoid_: Split ratio, percentage

**Rounding burden**:
The extra minor units a member has absorbed in one currency because a split
could not be exact; later splits give extras to members with less of it.
_Avoid_: Rounding error, remainder

**Currency balance**:
A ledger member's net amount owed or owing in one currency, after expenses and
recorded settlements in that currency.
_Avoid_: Converted balance, combined balance

**Settlement**:
A recorded repayment between ledger members in a specified currency.
_Avoid_: Payment execution, currency conversion

**Settle-up plan**:
The fewest payments that bring every balance in one currency to zero; it may
skip people in the middle. A person's Settle up shows the plan's payments that
involve them.
_Avoid_: Suggestions, pairwise debts

**Settled member**:
A ledger member whose current expenses and settlements cancel out, leaving a
zero balance in every currency. A member that no current expense or
settlement names has no expenses yet, rather than being settled.
_Avoid_: Inactive, empty

**Balance breakdown**:
The current expenses and settlements behind one member's balance in a
currency, each with its signed effect; they add up exactly to the balance.
_Avoid_: Statement, history

## Synchronization and history

**Command**:
A retry-safe statement of user intent submitted by a client.
_Avoid_: Event

**Group revision**:
A monotonically increasing marker for the current authoritative group state.
_Avoid_: Member version, audit sequence

**Snapshot**:
The complete current state of one group at a particular revision.
_Avoid_: Event log

**Client replica**:
A device's durable local view of one group, including its confirmed snapshot,
pending outbox, and conflict notices.
_Avoid_: Server state, cache

**Outbox**:
A client's ordered collection of commands not yet acknowledged by the server.

**Command outcome**:
The server's permanent result for a command: applied, no effect, superseded, or
rejected.

**Conflict notice**:
A local, dismissible record of a rejected or superseded command and the server
state that prevented it.

**Revision announcement**:
A realtime hint that a group may have a newer revision; the client
synchronizes in response and never treats it as state.
_Avoid_: Push update, realtime event

**Audit event**:
An immutable historical record of an applied transition, including its actor,
time, target, and before and after state.
_Avoid_: Sync event

**Activity**:
The group's audit events shown to people, from which undoable actions can be
reversed.
_Avoid_: History record, log

**New activity**:
Activity events from other identities after the sequence this installation
last marked seen for the group. The bell counts them together with conflict
notices.
_Avoid_: Notification, unread message

## App interaction

**App action**:
A named thing a person can do in the app, such as adding a member or replacing
the invite link, invoked the same way by any caller. An app action may submit a
command, make a direct request, or only change what this installation shows.
_Avoid_: Command (for this sense), handler, intent

**Confirmation**:
A person's explicit approval of an app action whose effects others notice or
cannot easily undo, given before it runs.
_Avoid_: Prompt, dialog

**Reversal**:
An attributed compensating action that safely undoes an earlier Activity action while leaving the original history intact.
_Avoid_: History deletion, force overwrite
