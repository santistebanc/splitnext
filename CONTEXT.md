# Splitnext

Splitnext is an offline-first shared-expense ledger. Its language keeps access,
people represented in the ledger, synchronization, and history distinct.

## Access

**Access identity**:
The enduring actor behind one or more authenticated devices.
_Avoid_: Member, device, account

**Device credential**:
A secret held by one device that authenticates an access identity.
_Avoid_: Access grant, member token

**Group access grant**:
Permanent permission for an access identity to participate in a group.
_Avoid_: Membership, member access

**Actor handle**:
A stable, group-local label such as “User 6” assigned to an access identity.
_Avoid_: Username, member name

**Direct join**:
The temporary MVP mechanism that grants access to an authenticated identity
that knows a group identifier.

**Group invite**:
A temporary reusable credential that can issue a permanent group access grant.
_Avoid_: Access grant, individual invite

## Ledger

**Ledger member**:
A named person represented in expenses, balances, and settlements; it is not an
access identity or authorization record.
_Avoid_: User, account

**Preferred member**:
An access identity's nonexclusive choice of which active ledger member its UI
calls “you.”
_Avoid_: Claimed member, owned member

**Archived member**:
A ledger member no longer available for new activity but retained for history.
_Avoid_: Deleted member

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

**Audit event**:
An immutable historical record of an applied transition, including its actor,
time, target, and before and after state.
_Avoid_: Sync event
