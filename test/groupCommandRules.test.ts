import { auditEventSchema } from '../src/domain/audit';
import { describe, expect, it } from 'vitest';
import { applyGroupCommand, type CommandServerState, type GroupCommand } from '../src/domain/commands';
import type { Expense } from '../src/domain/expenses';
import type { LedgerMember } from '../src/domain/members';
import type { GroupSnapshot } from '../src/domain/sync';

/**
 * The pure rules both the server and every client projection run. Each row is
 * one situation and the outcome it must produce; HTTP and sync tests cover
 * delivery, so these stay fast and exhaustive.
 */

const at = '2026-01-01T00:00:00.000Z';

const later = '2026-01-02T00:00:00.000Z';

const id = (label: string) => label.padEnd(22, '_');

const me = id('identity-me');

const other = id('identity-other');

const outsider = id('identity-outsider');

const ana = id('member-ana');

const ben = id('member-ben');

const old = id('member-old');

const gone = id('member-gone');

const cy = id('member-cy');

const dinner = id('expense-dinner');

const taxi = id('expense-taxi');

function member(memberId: string, name: string, status: LedgerMember['status'] = 'active') {
  return { id: memberId, display_name: name, status, created_at: at, updated_at: at };
}

function expense(expenseId: string, detail: Partial<Expense>): Expense {
  return {
    id: expenseId, description: 'Dinner', currency: 'EUR', total: 1000,
    paid: [{ member_id: ana, amount: 1000 }],
    parts: [{ kind: 'shares', member_id: ana, shares: 1 }, { kind: 'shares', member_id: ben, shares: 1 }],
    allocations: [{ member_id: ana, amount: 500 }, { member_id: ben, amount: 500 }],
    extras: [], status: 'active', version: 2, created_at: at, updated_at: at, ...detail,
  };
}

function grant(identityId: string, preferred: string | null, hiddenAt: string | null = null) {
  return { identity_id: identityId, actor_handle: identityId, preferred_member_id: preferred, granted_at: at, hidden_at: hiddenAt };
}

const snapshot: GroupSnapshot = {
  group: { id: id('group'), name: 'Trip', created_at: at },
  members: [member(ana, 'Ana'), member(ben, 'Ben'), member(old, 'Old', 'hidden'), member(gone, 'Gone', 'deleted'), member(cy, 'Cy')],
  settlements: [],
  expenses: [
    expense(dinner, {}),
    expense(taxi, {
      description: 'Taxi', total: 300, paid: [{ member_id: old, amount: 300 }],
      parts: [{ kind: 'shares', member_id: old, shares: 1 }], allocations: [{ member_id: old, amount: 300 }],
      status: 'removed', version: 3,
    }),
  ],
  access_grants: [grant(me, ana), grant(other, ben), grant(id('identity-left'), null, at)],
  invite: { id: id('invite'), created_by_identity_id: me, created_at: at, token: 't'.repeat(43) },
};

const commandId = id('command');

const rename = (name: string, expected = 'Trip'): GroupCommand =>
  ({ command_id: commandId, type: 'group.rename', payload: { name, expected_name: expected } });

const create = (memberId: string, name: string): GroupCommand =>
  ({ command_id: commandId, type: 'member.create', payload: { member_id: memberId, display_name: name } });

const renameMember = (memberId: string, name: string, expected: string): GroupCommand =>
  ({ command_id: commandId, type: 'member.rename', payload: { member_id: memberId, display_name: name, expected_display_name: expected } });

const remove = (memberId: string): GroupCommand =>
  ({ command_id: commandId, type: 'member.remove', payload: { member_id: memberId } });

const restore = (memberId: string): GroupCommand =>
  ({ command_id: commandId, type: 'member.restore', payload: { member_id: memberId } });

/** Ana pays, shared equally by the given members. */
const entry = (total: number, members: string[], description = 'Dinner') => ({
  description, currency: 'EUR', total, paid_by: ana,
  parts: members.map((memberId) => ({ kind: 'shares' as const, member_id: memberId, shares: 1 })),
});

const record = (expenseId: string, total: number, members: string[]): GroupCommand =>
  ({ command_id: commandId, type: 'expense.record', payload: { expense_id: expenseId, ...entry(total, members) } });

const edit = (expenseId: string, total: number, version: number, description = 'Dinner'): GroupCommand =>
  ({ command_id: commandId, type: 'expense.edit', payload: { expense_id: expenseId, expected_version: version, ...entry(total, [ana, ben], description) } });

const removeExpense = (expenseId: string): GroupCommand =>
  ({ command_id: commandId, type: 'expense.remove', payload: { expense_id: expenseId } });

const restoreExpense = (expenseId: string): GroupCommand =>
  ({ command_id: commandId, type: 'expense.restore', payload: { expense_id: expenseId } });

const prefer = (memberId: string): GroupCommand =>
  ({ command_id: commandId, type: 'preference.set', payload: { member_id: memberId } });

const leave: GroupCommand = { command_id: commandId, type: 'group.leave', payload: {} };

/** A command's reported server state with each of its parts matched partially. */
type ServerState =
  | (CommandServerState extends infer State
      ? State extends CommandServerState
        ? { [Key in keyof State]: Key extends 'kind' ? State[Key] : Partial<State[Key]> }
        : never
      : never)
  | null;

type Row = {
  situation: string;
  command: GroupCommand;
  status: string;
  reason: string | null;
  /** The authoritative state the outcome reports, matched partially. */
  state: ServerState;
  actor?: string;
};

const memberState = (detail: Partial<LedgerMember>): ServerState => ({ kind: 'member', member: detail });

const expenseState = (detail: Partial<Expense>): ServerState => ({ kind: 'expense', expense: detail });

const repayment = (from: string, to: string): GroupCommand => ({ command_id: commandId, type: 'settlement.record', payload: { settlement_id: id('repayment'), from_member_id: from, to_member_id: to, currency: 'EUR', amount: 300 } });

const rows: Row[] = [
  { situation: 'records a separate repayment', command: repayment(ben, ana), status: 'applied', reason: null, state: { kind: 'settlement', settlement: { amount: 300 } } },
  { situation: 'rejects repayment to self', command: repayment(ana, ana), status: 'rejected', reason: 'settlement_invalid', state: null },
  { situation: 'rejects repayment with unknown member', command: repayment(ana, id('unknown')), status: 'rejected', reason: 'member_not_found', state: null },
  { situation: 'renames the group', command: rename('Lisbon'), status: 'applied', reason: null, state: { kind: 'group', group: { name: 'Lisbon' } } },
  { situation: 'keeps a name another device already chose', command: rename('Trip', 'Old trip'), status: 'no_effect', reason: null, state: { kind: 'group', group: { name: 'Trip' } } },
  { situation: 'supersedes a rename based on an old name', command: rename('Lisbon', 'Old trip'), status: 'superseded', reason: 'group_changed', state: { kind: 'group', group: { name: 'Trip' } } },
  { situation: 'adds a member', command: create(id('member-new'), 'Cy'), status: 'applied', reason: null, state: memberState({ id: id('member-new'), display_name: 'Cy' }) },
  { situation: 'adds a member whose name another member has', command: create(id('member-new'), 'ana'), status: 'applied', reason: null, state: memberState({ id: id('member-new'), display_name: 'ana' }) },
  { situation: 'reuses a hidden member name', command: create(id('member-new'), 'Old'), status: 'applied', reason: null, state: memberState({ display_name: 'Old', status: 'active' }) },
  { situation: 'rejects an add with an existing member id', command: create(ben, 'Cy'), status: 'rejected', reason: 'member_id_exists', state: memberState({ id: ben, display_name: 'Ben' }) },
  { situation: 'renames a member', command: renameMember(ana, 'Anita', 'Ana'), status: 'applied', reason: null, state: memberState({ id: ana, display_name: 'Anita' }) },
  { situation: 'keeps a member name another device already chose', command: renameMember(ana, 'Ana', 'Annie'), status: 'no_effect', reason: null, state: memberState({ display_name: 'Ana' }) },
  { situation: 'supersedes a member rename based on an old name', command: renameMember(ana, 'Anita', 'Annie'), status: 'superseded', reason: 'member_changed', state: memberState({ display_name: 'Ana' }) },
  { situation: 'renames a member to a name another member has', command: renameMember(ana, 'ben', 'Ana'), status: 'applied', reason: null, state: memberState({ display_name: 'ben' }) },
  { situation: 'rejects renaming a hidden member', command: renameMember(old, 'New', 'Old'), status: 'rejected', reason: 'member_removed', state: memberState({ status: 'hidden' }) },
  { situation: 'rejects renaming a deleted member', command: renameMember(gone, 'New', 'Gone'), status: 'rejected', reason: 'member_removed', state: memberState({ status: 'deleted' }) },
  { situation: 'rejects renaming an unknown member', command: renameMember(id('member-none'), 'New', 'X'), status: 'rejected', reason: 'member_not_found', state: null },
  { situation: 'deletes a member that no expense names', command: remove(cy), status: 'applied', reason: null, state: memberState({ id: cy, status: 'deleted' }) },
  { situation: 'hides a member an expense names', command: remove(ben), status: 'applied', reason: null, state: memberState({ id: ben, status: 'hidden' }) },
  { situation: 'keeps a hidden member hidden', command: remove(old), status: 'no_effect', reason: null, state: memberState({ status: 'hidden' }) },
  { situation: 'keeps a deleted member deleted', command: remove(gone), status: 'no_effect', reason: null, state: memberState({ status: 'deleted' }) },
  { situation: 'rejects removing an unknown member', command: remove(id('member-none')), status: 'rejected', reason: 'member_not_found', state: null },
  { situation: 'restores a hidden member', command: restore(old), status: 'applied', reason: null, state: memberState({ id: old, status: 'active' }) },
  { situation: 'restores a deleted member', command: restore(gone), status: 'applied', reason: null, state: memberState({ id: gone, status: 'active' }) },
  { situation: 'keeps an active member active', command: restore(ana), status: 'no_effect', reason: null, state: memberState({ status: 'active' }) },
  { situation: 'rejects restoring an unknown member', command: restore(id('member-none')), status: 'rejected', reason: 'member_not_found', state: null },
  { situation: 'records an expense', command: record(id('expense-new'), 301, [ana, ben, cy]), status: 'applied', reason: null, state: expenseState({ total: 301, status: 'active', version: 1 }) },
  { situation: 'records an expense naming a removed member', command: record(id('expense-new'), 300, [ana, old, gone]), status: 'applied', reason: null, state: expenseState({ total: 300 }) },
  { situation: 'rejects an expense with an existing id', command: record(dinner, 100, [ana]), status: 'rejected', reason: 'expense_id_exists', state: expenseState({ id: dinner, total: 1000 }) },
  { situation: 'rejects an expense naming an unknown member', command: record(id('expense-new'), 100, [id('member-none')]), status: 'rejected', reason: 'member_not_found', state: null },
  { situation: 'rejects an expense whose exact amounts exceed its total', command: { command_id: commandId, type: 'expense.record', payload: { expense_id: id('expense-new'), ...entry(100, []), parts: [{ kind: 'exact', member_id: ana, amount: 101 }] } }, status: 'rejected', reason: 'expense_invalid', state: null },
  { situation: 'edits an expense', command: edit(dinner, 1200, 2), status: 'applied', reason: null, state: expenseState({ total: 1200, version: 3 }) },
  { situation: 'keeps an edit another device already made', command: edit(dinner, 1000, 1), status: 'no_effect', reason: null, state: expenseState({ total: 1000, version: 2 }) },
  { situation: 'supersedes an edit based on an old version', command: edit(dinner, 1200, 1), status: 'superseded', reason: 'expense_changed', state: expenseState({ total: 1000, version: 2 }) },
  { situation: 'rejects editing a removed expense', command: edit(taxi, 400, 3, 'Taxi'), status: 'rejected', reason: 'expense_removed', state: expenseState({ status: 'removed' }) },
  { situation: 'rejects editing an unknown expense', command: edit(id('expense-none'), 400, 1), status: 'rejected', reason: 'expense_not_found', state: null },
  { situation: 'removes an expense whatever version was seen', command: removeExpense(dinner), status: 'applied', reason: null, state: expenseState({ status: 'removed', version: 3 }) },
  { situation: 'keeps a removed expense removed', command: removeExpense(taxi), status: 'no_effect', reason: null, state: expenseState({ status: 'removed' }) },
  { situation: 'rejects removing an unknown expense', command: removeExpense(id('expense-none')), status: 'rejected', reason: 'expense_not_found', state: null },
  { situation: 'restores a removed expense', command: restoreExpense(taxi), status: 'applied', reason: null, state: expenseState({ status: 'active', version: 4, total: 300 }) },
  { situation: 'keeps a current expense current', command: restoreExpense(dinner), status: 'no_effect', reason: null, state: expenseState({ status: 'active' }) },
  { situation: 'rejects restoring an unknown expense', command: restoreExpense(id('expense-none')), status: 'rejected', reason: 'expense_not_found', state: null },
  { situation: 'chooses who is you', command: prefer(ben), status: 'applied', reason: null, state: { kind: 'access', access: { preferred_member_id: ben } } },
  { situation: 'keeps the current choice', command: prefer(ana), status: 'no_effect', reason: null, state: { kind: 'access', access: { preferred_member_id: ana } } },
  { situation: 'rejects choosing a hidden member', command: prefer(old), status: 'rejected', reason: 'member_removed', state: null },
  { situation: 'rejects choosing a deleted member', command: prefer(gone), status: 'rejected', reason: 'member_removed', state: null },
  { situation: 'rejects choosing an unknown member', command: prefer(id('member-none')), status: 'rejected', reason: 'member_not_found', state: null },
  { situation: 'rejects a choice without access', command: prefer(ben), status: 'rejected', reason: 'access_not_found', state: null, actor: outsider },
  { situation: 'rejects a choice after leaving', command: prefer(ben), status: 'rejected', reason: 'group_left', state: null, actor: id('identity-left') },
  { situation: 'leaves the group', command: leave, status: 'applied', reason: null, state: { kind: 'access', access: { hidden_at: later, preferred_member_id: null } } },
  { situation: 'keeps a left group left', command: leave, status: 'no_effect', reason: null, state: { kind: 'access', access: { hidden_at: at } }, actor: id('identity-left') },
  { situation: 'rejects leaving without access', command: leave, status: 'rejected', reason: 'access_not_found', state: null, actor: outsider },
];

describe('group command rules', () => {
  it.each(rows)('$situation', ({ command, status, reason, state, actor = me }) => {
    const transition = applyGroupCommand(snapshot, actor, command, later);

    expect({ status: transition.status, reason: transition.reason }).toEqual({ status, reason });

    if (state === null) expect(transition.serverState).toBeNull();
    else expect(transition.serverState).toMatchObject(state);

    // Only an applied command changes state or writes history.
    if (status === 'applied') {
      expect(transition.snapshot).not.toEqual(snapshot);
      expect(transition.audit).not.toBeNull();
    } else {
      expect(transition.snapshot).toBe(snapshot);
      expect(transition.audit).toBeNull();
    }
  });

  it('clears every choice of a removed member, keeps them cleared on restore, and hides the group on leave', () => {
    const removed = applyGroupCommand(snapshot, me, remove(ana), later).snapshot;
    const restored = applyGroupCommand(removed, me, restore(ana), later).snapshot;
    const left = applyGroupCommand(snapshot, me, leave, later).snapshot;

    expect(removed.access_grants.find((entry) => entry.identity_id === me)?.preferred_member_id).toBeNull();
    expect(restored.access_grants.find((entry) => entry.identity_id === me)?.preferred_member_id).toBeNull();
    expect(left.access_grants.find((entry) => entry.identity_id === me)).toMatchObject({ hidden_at: later, preferred_member_id: null });
  });
});

const settlementFixture = { ...snapshot, settlements: [
  { id: id('repayment-active'), from_member_id: ben, to_member_id: ana, currency: 'EUR', amount: 300, status: 'active' as const, version: 2, created_at: at, updated_at: at },
  { id: id('repayment-removed'), from_member_id: ben, to_member_id: ana, currency: 'EUR', amount: 300, status: 'removed' as const, version: 3, created_at: at, updated_at: at },
] };

const settlementRows: { type: 'settlement.edit' | 'settlement.remove' | 'settlement.restore'; record: string; version?: number; amount?: number; status: string; reason: string | null }[] = [
  { type: 'settlement.edit', record: 'active', version: 2, amount: 200, status: 'applied', reason: null },
  { type: 'settlement.edit', record: 'active', version: 1, amount: 200, status: 'superseded', reason: 'settlement_changed' },
  { type: 'settlement.edit', record: 'active', version: 1, amount: 300, status: 'no_effect', reason: null },
  { type: 'settlement.edit', record: 'removed', version: 3, amount: 200, status: 'rejected', reason: 'settlement_removed' },
  { type: 'settlement.edit', record: 'missing', version: 1, amount: 200, status: 'rejected', reason: 'settlement_not_found' },
  { type: 'settlement.remove', record: 'active', status: 'applied', reason: null },
  { type: 'settlement.remove', record: 'removed', status: 'no_effect', reason: null },
  { type: 'settlement.remove', record: 'missing', status: 'rejected', reason: 'settlement_not_found' },
  { type: 'settlement.restore', record: 'removed', status: 'applied', reason: null },
  { type: 'settlement.restore', record: 'active', status: 'no_effect', reason: null },
  { type: 'settlement.restore', record: 'missing', status: 'rejected', reason: 'settlement_not_found' },
];

it.each(settlementRows)('$type $record version $version amount $amount produces $status', (row) => {
  const payload = { settlement_id: id(`repayment-${row.record}`) };
  const command: GroupCommand = row.type === 'settlement.edit' ? { command_id: commandId, type: row.type, payload: { ...payload, from_member_id: ben, to_member_id: ana, currency: 'EUR', amount: row.amount ?? 200, expected_version: row.version ?? 1 } } : { command_id: commandId, type: row.type, payload };
  const result = applyGroupCommand(settlementFixture, me, command, later);
  expect({ status: result.status, reason: result.reason }).toEqual({ status: row.status, reason: row.reason });
});

const editedEvent = auditEventSchema.parse({ id: id('audit-edit'), sequence: 1, revision: 2, command_id: commandId, actor_identity_id: other, actor_handle: 'User 2', actor_member_name: 'Ben', occurred_at: at, target: { kind: 'expense', id: dinner }, change: { action: 'expense.edited', before: expense(dinner, { total: 600, version: 1 }), after: { expense: snapshot.expenses[0], hidden_members: [] } } });

const undoRows = [
  { situation: 'undoes another participant edit', eventId: editedEvent.id, history: [editedEvent], version: 2, status: 'applied', reason: null },
  { situation: 'does not overwrite a later expense version', eventId: editedEvent.id, history: [editedEvent], version: 3, status: 'superseded', reason: 'undo_changed' },
  { situation: 'rejects an unknown audit event', eventId: id('missing-event'), history: [], version: 2, status: 'rejected', reason: 'undo_not_found' },
];

it.each(undoRows)('$situation', (row) => {
  const group = { ...snapshot, expenses: snapshot.expenses.map((entry) => entry.id === dinner ? { ...entry, version: row.version } : entry) };
  const result = applyGroupCommand(group, me, { command_id: commandId, type: 'change.undo', payload: { event_id: row.eventId } }, later, row.history);
  expect({ status: result.status, reason: result.reason }).toEqual({ status: row.status, reason: row.reason });

  if (result.status === 'applied') expect(result.snapshot.expenses[0]).toMatchObject({ total: 600, version: 3 });
});

it('can reverse a reversal while preserving immutable events and an unrelated group rename', () => {
  const renamed = { ...snapshot, group: { ...snapshot.group, name: 'New group name' } };
  const first = applyGroupCommand(renamed, me, { command_id: commandId, type: 'change.undo', payload: { event_id: editedEvent.id } }, later, [editedEvent]);
  const reversed = auditEventSchema.parse({ ...editedEvent, id: id('audit-reversal'), sequence: 2, revision: 3, change: first.audit });
  const second = applyGroupCommand(first.snapshot, other, { command_id: id('another-command'), type: 'change.undo', payload: { event_id: reversed.id } }, later, [editedEvent, reversed]);
  expect(second.status).toBe('applied');
  expect(second.snapshot.expenses[0]).toMatchObject({ total: 1000, version: 4 });
  expect(second.snapshot.group.name).toBe('New group name');
  expect(editedEvent.change.action).toBe('expense.edited');
  expect(second.audit).toMatchObject({ action: 'change.undone', reverses_event_id: reversed.id });
});


function reversibleEvent(change: import('../src/domain/audit').AuditChange | null, target: import('../src/domain/audit').AuditEvent['target'], label: string, sequence = 1) {
  return auditEventSchema.parse({ ...editedEvent, id: id(label), sequence, target, change });
}

it('undoes member removal without restoring preferred-member selections', () => {
  const removed = applyGroupCommand(snapshot, me, remove(ana), later);
  const event = reversibleEvent(removed.audit, { kind: 'member', id: ana }, 'removed-ana');
  const result = applyGroupCommand(removed.snapshot, other, { command_id: commandId, type: 'change.undo', payload: { event_id: event.id } }, later, [event]);
  expect(result.status).toBe('applied');
  expect(result.snapshot.members.find((member) => member.id === ana)?.status).toBe('active');
  expect(result.snapshot.access_grants.find((grant) => grant.identity_id === me)?.preferred_member_id).toBeNull();
});

const memberAddition = reversibleEvent({ action: 'member.created', before: null, after: member(cy, 'Cy') }, { kind: 'member', id: cy }, 'added-cy');

const referenceRows = [
  { situation: 'undoes an unreferenced member addition', kind: 'none', status: 'applied', reason: null },
  { situation: 'blocks undo of a member named by a removed expense', kind: 'expense', status: 'superseded', reason: 'undo_member_referenced' },
  { situation: 'blocks undo of a member named by a removed repayment', kind: 'settlement', status: 'superseded', reason: 'undo_member_referenced' },
];

it.each(referenceRows)('$situation', (row) => {
  const group = { ...snapshot, expenses: row.kind === 'expense' ? [...snapshot.expenses, expense(id('cy-expense'), { status: 'removed', paid: [{ member_id: cy, amount: 1000 }] })] : snapshot.expenses,
    settlements: row.kind === 'settlement' ? [{ ...settlementFixture.settlements[0]!, id: id('cy-repayment'), from_member_id: cy, to_member_id: ana, status: 'removed' as const }] : [] };

  const result = applyGroupCommand(group, me, { command_id: commandId, type: 'change.undo', payload: { event_id: memberAddition.id } }, later, [memberAddition]);
  expect({ status: result.status, reason: result.reason }).toEqual({ status: row.status, reason: row.reason });
});

it('detects later group and member changes even when their visible value returns to the earlier result', () => {
  const first = reversibleEvent({ action: 'group.renamed', before: { ...snapshot.group, name: 'Before' }, after: snapshot.group }, { kind: 'group', id: snapshot.group.id }, 'group-rename');
  const laterEvent = reversibleEvent({ action: 'group.renamed', before: { ...snapshot.group, name: 'Elsewhere' }, after: snapshot.group }, first.target, 'later-rename', 2);
  const result = applyGroupCommand(snapshot, me, { command_id: commandId, type: 'change.undo', payload: { event_id: first.id } }, later, [first, laterEvent]);
  expect(result.status).toBe('superseded');
  expect(result.reason).toBe('undo_changed');
});

it('never offers reversal of creation, access changes or invite replacement', () => {
  const unsupported = reversibleEvent({ action: 'group.left', before: grant(me, ana), after: grant(me, null, later) }, { kind: 'group', id: snapshot.group.id }, 'left-group');
  const result = applyGroupCommand(snapshot, me, { command_id: commandId, type: 'change.undo', payload: { event_id: unsupported.id } }, later, [unsupported]);
  expect(result.reason).toBe('undo_not_supported');
});


it('rejects duplicate repayment identifiers and invalid edited member references', () => {
  const existing = settlementFixture.settlements[0];

  if (!existing) throw new Error('missing fixture');
  const recorded = applyGroupCommand(settlementFixture, me, { command_id: commandId, type: 'settlement.record', payload: { settlement_id: existing.id, from_member_id: ben, to_member_id: ana, amount: 300, currency: 'EUR' } }, later);
  expect(recorded.reason).toBe('settlement_id_exists');

  for (const [recipient, reason] of [[ben, 'settlement_invalid'], [id('unknown-member'), 'member_not_found']] as const) {
    const edited = applyGroupCommand(settlementFixture, me, { command_id: commandId, type: 'settlement.edit', payload: { settlement_id: existing.id, expected_version: existing.version, from_member_id: ben, to_member_id: recipient, amount: 200, currency: 'EUR' } }, later);
    expect(edited.status).toBe('rejected');
    expect(edited.reason).toBe(reason);
  }
});
