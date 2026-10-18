import type { GroupAccessGrant } from './groups';
import { memberNameKey, type LedgerMember } from './members';
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

/**
 * Each member's name ordinal: its position among the active and hidden
 * members sharing its name, in creation order, or null while its name is
 * unique. Deleted members are never shown, so they never count.
 */
export function nameOrdinals(snapshot: GroupSnapshot | null | undefined): Map<string, number | null> {
  const shown = snapshot?.members.filter((member) => member.status !== 'deleted') ?? [];

  const sharing = (member: LedgerMember) =>
    shown.filter((other) => memberNameKey(other.display_name) === memberNameKey(member.display_name));

  return new Map(
    shown.map((member): [string, number | null] => {
      const same = sharing(member);

      return [member.id, same.length > 1 ? same.indexOf(member) + 1 : null];
    }),
  );
}

/** A name as people see it, such as "Ana (2)" while another member is also Ana. */
export function memberLabel(displayName: string, ordinal: number | null | undefined): string {
  return ordinal ? `${displayName} (${ordinal})` : displayName;
}

/** The same member choices for invite preview and local rejoining. */
export function previewFromSnapshot(snapshot: GroupSnapshot): InvitePreview {
  const ordinals = nameOrdinals(snapshot);

  return {
    group: { id: snapshot.group.id, name: snapshot.group.name },
    members: activeMembers(snapshot).map((member) => ({
      id: member.id,
      display_name: member.display_name,
      name_ordinal: ordinals.get(member.id) ?? null,
      in_use: participantsForMember(snapshot, member.id).length > 0,
    })),
  };
}
