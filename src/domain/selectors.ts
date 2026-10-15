import type { GroupAccessGrant } from './groups';
import type { LedgerMember } from './members';
import type { InvitePreview } from './invites';
import type { GroupSnapshot } from './sync';

/** Current ledger members, retaining snapshot order. */
export function activeMembers(snapshot: GroupSnapshot | null | undefined): LedgerMember[] {
  return snapshot?.members.filter((member) => member.status === 'active') ?? [];
}

/** Participants who have not left; permanent access remains separate. */
export function joinedParticipants(snapshot: GroupSnapshot | null | undefined): GroupAccessGrant[] {
  return snapshot?.access_grants.filter((grant) => !grant.hidden_at) ?? [];
}

export function participantsForMember(
  snapshot: GroupSnapshot | null | undefined,
  memberId: string,
): GroupAccessGrant[] {
  return joinedParticipants(snapshot).filter((grant) => grant.preferred_member_id === memberId);
}

export function preferredMember(
  snapshot: GroupSnapshot | null | undefined,
  identityId: string | undefined,
): LedgerMember | null {
  const memberId = joinedParticipants(snapshot).find((grant) => grant.identity_id === identityId)?.preferred_member_id;

  return activeMembers(snapshot).find((member) => member.id === memberId) ?? null;
}

/** The same member choices for invite preview and local rejoining. */
export function previewFromSnapshot(snapshot: GroupSnapshot): InvitePreview {
  return {
    group: { id: snapshot.group.id, name: snapshot.group.name },
    members: activeMembers(snapshot).map((member) => ({
      id: member.id,
      display_name: member.display_name,
      in_use: participantsForMember(snapshot, member.id).length > 0,
    })),
  };
}
