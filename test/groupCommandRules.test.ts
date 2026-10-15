import { describe, expect, it } from 'vitest';
import { applyGroupCommand, type GroupCommand } from '../src/domain/commands';
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

type Row = [situation: string, command: GroupCommand, status: string, reason: string | null, actor?: string];

const rows: Row[] = [
  ['renames the group', rename('Lisbon'), 'applied', null],
  ['keeps a name another device already chose', rename('Trip', 'Old trip'), 'no_effect', null],
  ['supersedes a rename based on an old name', rename('Lisbon', 'Old trip'), 'superseded', 'group_changed'],
  ['adds a member', create(id('member-new'), 'Cy'), 'applied', null],
  ['merges an added name with an active member', create(id('member-new'), 'ana'), 'no_effect', 'member_merged'],
  ['reuses an archived member name', create(id('member-new'), 'Old'), 'applied', null],
  ['rejects an add with an existing member id', create(ben, 'Cy'), 'rejected', 'member_id_exists'],
  ['renames a member', renameMember(ana, 'Anita', 'Ana'), 'applied', null],
  ['keeps a member name another device already chose', renameMember(ana, 'Ana', 'Annie'), 'no_effect', null],
  ['supersedes a member rename based on an old name', renameMember(ana, 'Anita', 'Annie'), 'superseded', 'member_changed'],
  ['supersedes a rename to an active name', renameMember(ana, 'ben', 'Ana'), 'superseded', 'member_name_taken'],
  ['rejects renaming an archived member', renameMember(old, 'New', 'Old'), 'rejected', 'member_archived'],
  ['rejects renaming an unknown member', renameMember(id('member-none'), 'New', 'X'), 'rejected', 'member_not_found'],
  ['archives a member', archive(ben), 'applied', null],
  ['keeps an archived member archived', archive(old), 'no_effect', null],
  ['rejects archiving an unknown member', archive(id('member-none')), 'rejected', 'member_not_found'],
  ['chooses who is you', prefer(ben), 'applied', null],
  ['keeps the current choice', prefer(ana), 'no_effect', null],
  ['rejects choosing an archived member', prefer(old), 'rejected', 'member_archived'],
  ['rejects choosing an unknown member', prefer(id('member-none')), 'rejected', 'member_not_found'],
  ['rejects a choice without access', prefer(ben), 'rejected', 'access_not_found', outsider],
  ['leaves the group', leave, 'applied', null],
  ['keeps a left group left', leave, 'no_effect', null, id('identity-left')],
  ['rejects leaving without access', leave, 'rejected', 'access_not_found', outsider],
];

describe('group command rules', () => {
  it.each(rows)('%s', (_, command, status, reason, actor = me) => {
    const transition = applyGroupCommand(snapshot, actor, command, later);

    expect({ status: transition.status, reason: transition.reason }).toEqual({ status, reason });

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
