import type { JoinGroupCommand, PreferredMemberChoice } from './access';
import type { CommandTransition, MemberAlias } from './commands/define';
import type { GroupAccessGrant } from './groups';
import { memberNameKey, type LedgerMember } from './members';
import type { GroupSnapshot } from './sync';

export type JoinTransition =
  | {
      ok: true;
      snapshot: GroupSnapshot;
      access: GroupAccessGrant;
      nextActorNumber: number;
      /** Null when the join changed nothing, such as a repeated choice. */
      audit: CommandTransition['audit'];
      memberAlias?: MemberAlias;
    }
  | {
      ok: false;
      error: 'member_not_found' | 'member_archived' | 'member_id_exists';
    };

type PreferredMemberResult =
  | {
      ok: true;
      member: LedgerMember;
      created: boolean;
      memberAlias?: MemberAlias;
    }
  | {
      ok: false;
      error: 'member_not_found' | 'member_archived' | 'member_id_exists';
    };

/**
 * Grants or restores access and chooses who the identity is: an existing
 * active member, or a new one, merged into an active member with the same
 * name. Rejoining keeps the identity's actor handle.
 */
export function applyGroupJoin(
  snapshot: GroupSnapshot,
  nextActorNumber: number,
  command: JoinGroupCommand,
): JoinTransition {
  const preferred = resolvePreferredMember(
    command.preferred_member,
    snapshot.members,
    command.joined_at,
  );

  if (!preferred.ok) return preferred;

  const previousAccess = snapshot.access_grants.find(
    (grant) => grant.identity_id === command.identity_id,
  );

  const access = previousAccess
    ? {
        ...previousAccess,
        preferred_member_id: preferred.member.id,
        hidden_at: null,
      }
    : {
        identity_id: command.identity_id,
        actor_handle: `User ${nextActorNumber}`,
        preferred_member_id: preferred.member.id,
        granted_at: command.joined_at,
        hidden_at: null,
      };

  const changed =
    preferred.created ||
    !previousAccess ||
    previousAccess.preferred_member_id !== access.preferred_member_id ||
    previousAccess.hidden_at !== null;

  const members = preferred.created
    ? [...snapshot.members, preferred.member]
    : snapshot.members;

  const accessGrants = previousAccess
    ? snapshot.access_grants.map((grant) =>
        grant.identity_id === access.identity_id ? access : grant,
      )
    : [...snapshot.access_grants, access];

  const transition: JoinTransition = {
    ok: true,
    snapshot: {
      ...snapshot,
      members,
      access_grants: accessGrants,
    },
    access,
    nextActorNumber: previousAccess ? nextActorNumber : nextActorNumber + 1,
    audit: !changed
      ? null
      : previousAccess
        ? {
            action: 'group.rejoined',
            before: previousAccess,
            after: {
              access,
              created_member: preferred.created ? preferred.member : null,
            },
          }
        : {
            action: 'group.joined',
            before: null,
            after: {
              access,
              created_member: preferred.created ? preferred.member : null,
            },
          },
  };

  if (preferred.memberAlias) transition.memberAlias = preferred.memberAlias;

  return transition;
}

function resolvePreferredMember(
  choice: PreferredMemberChoice,
  members: readonly LedgerMember[],
  joinedAt: string,
): PreferredMemberResult {
  if (choice.kind === 'existing') {
    const member = members.find(
      (candidate) => candidate.id === choice.member_id,
    );

    if (!member) return { ok: false, error: 'member_not_found' };

    return member.status === 'active'
      ? { ok: true, member, created: false }
      : { ok: false, error: 'member_archived' };
  }

  if (members.some((member) => member.id === choice.member_id)) {
    return { ok: false, error: 'member_id_exists' };
  }

  const requestedNameKey = memberNameKey(choice.display_name);

  const existing = members.find(
    (member) =>
      member.status === 'active' &&
      memberNameKey(member.display_name) === requestedNameKey,
  );

  if (existing)
    return {
      ok: true,
      member: existing,
      created: false,
      memberAlias: { alias_id: choice.member_id, member_id: existing.id },
    };

  return {
    ok: true,
    created: true,
    member: {
      id: choice.member_id,
      display_name: choice.display_name,
      status: 'active',
      created_at: joinedAt,
      updated_at: joinedAt,
    },
  };
}
