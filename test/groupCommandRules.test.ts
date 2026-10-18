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

const rows: Row[] = [
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
