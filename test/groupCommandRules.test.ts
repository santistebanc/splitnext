import { describe, expect, it } from 'vitest';
import { applyGroupCommand, type CommandServerState, type GroupCommand } from '../src/domain/commands';
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

function member(memberId: string, name: string, status: 'active' | 'archived' = 'active') {
  return { id: memberId, display_name: name, status, created_at: at, updated_at: at };
}

function grant(identityId: string, preferred: string | null, hiddenAt: string | null = null) {
  return { identity_id: identityId, actor_handle: identityId, preferred_member_id: preferred, granted_at: at, hidden_at: hiddenAt };
}

const snapshot: GroupSnapshot = {
  group: { id: id('group'), name: 'Trip', created_at: at },
  members: [member(ana, 'Ana'), member(ben, 'Ben'), member(old, 'Old', 'archived')],
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

const archive = (memberId: string): GroupCommand =>
  ({ command_id: commandId, type: 'member.archive', payload: { member_id: memberId } });

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

const rows: Row[] = [
  { situation: 'renames the group', command: rename('Lisbon'), status: 'applied', reason: null, state: { kind: 'group', group: { name: 'Lisbon' } } },
  { situation: 'keeps a name another device already chose', command: rename('Trip', 'Old trip'), status: 'no_effect', reason: null, state: { kind: 'group', group: { name: 'Trip' } } },
  { situation: 'supersedes a rename based on an old name', command: rename('Lisbon', 'Old trip'), status: 'superseded', reason: 'group_changed', state: { kind: 'group', group: { name: 'Trip' } } },
  { situation: 'adds a member', command: create(id('member-new'), 'Cy'), status: 'applied', reason: null, state: memberState({ id: id('member-new'), display_name: 'Cy' }) },
  { situation: 'merges an added name with an active member', command: create(id('member-new'), 'ana'), status: 'no_effect', reason: 'member_merged', state: memberState({ id: ana, display_name: 'Ana' }) },
  { situation: 'merges a name that differs only in width and case', command: create(id('member-new'), 'ＡＮＡ'), status: 'no_effect', reason: 'member_merged', state: memberState({ id: ana }) },
  { situation: 'reuses an archived member name', command: create(id('member-new'), 'Old'), status: 'applied', reason: null, state: memberState({ display_name: 'Old', status: 'active' }) },
  { situation: 'rejects an add with an existing member id', command: create(ben, 'Cy'), status: 'rejected', reason: 'member_id_exists', state: memberState({ id: ben, display_name: 'Ben' }) },
  { situation: 'renames a member', command: renameMember(ana, 'Anita', 'Ana'), status: 'applied', reason: null, state: memberState({ id: ana, display_name: 'Anita' }) },
  { situation: 'keeps a member name another device already chose', command: renameMember(ana, 'Ana', 'Annie'), status: 'no_effect', reason: null, state: memberState({ display_name: 'Ana' }) },
  { situation: 'supersedes a member rename based on an old name', command: renameMember(ana, 'Anita', 'Annie'), status: 'superseded', reason: 'member_changed', state: memberState({ display_name: 'Ana' }) },
  { situation: 'supersedes a rename to an active name', command: renameMember(ana, 'ben', 'Ana'), status: 'superseded', reason: 'member_name_taken', state: memberState({ display_name: 'Ana' }) },
  { situation: 'rejects renaming an archived member', command: renameMember(old, 'New', 'Old'), status: 'rejected', reason: 'member_archived', state: memberState({ status: 'archived' }) },
  { situation: 'rejects renaming an unknown member', command: renameMember(id('member-none'), 'New', 'X'), status: 'rejected', reason: 'member_not_found', state: null },
  { situation: 'archives a member', command: archive(ben), status: 'applied', reason: null, state: memberState({ id: ben, status: 'archived' }) },
  { situation: 'keeps an archived member archived', command: archive(old), status: 'no_effect', reason: null, state: memberState({ status: 'archived' }) },
  { situation: 'rejects archiving an unknown member', command: archive(id('member-none')), status: 'rejected', reason: 'member_not_found', state: null },
  { situation: 'chooses who is you', command: prefer(ben), status: 'applied', reason: null, state: { kind: 'access', access: { preferred_member_id: ben } } },
  { situation: 'keeps the current choice', command: prefer(ana), status: 'no_effect', reason: null, state: { kind: 'access', access: { preferred_member_id: ana } } },
  { situation: 'rejects choosing an archived member', command: prefer(old), status: 'rejected', reason: 'member_archived', state: null },
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

  it('records the merged member as an alias for later commands', () => {
    const transition = applyGroupCommand(snapshot, me, create(id('member-new'), 'ana'), later);

    expect(transition.memberAlias).toEqual({ alias_id: id('member-new'), member_id: ana });
  });

  it('clears every choice of an archived member and hides the group on leave', () => {
    const archived = applyGroupCommand(snapshot, me, archive(ana), later).snapshot;
    const left = applyGroupCommand(snapshot, me, leave, later).snapshot;

    expect(archived.access_grants.find((entry) => entry.identity_id === me)?.preferred_member_id).toBeNull();
    expect(left.access_grants.find((entry) => entry.identity_id === me)).toMatchObject({ hidden_at: later, preferred_member_id: null });
  });
});
