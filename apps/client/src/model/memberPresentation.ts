import {
  activeMembers,
  joinedParticipants,
  participantsForMember,
  preferredMember,
  type ClientReplicaState,
} from '@splitnext/client';

export type ParticipantMarker = {
  identityId: string;
  label: string;
  you: boolean;
  status: 'online' | 'offline' | 'unknown';
};

export function orderedMembers(replica: ClientReplicaState) {
  const snapshot = replica.projected_snapshot;
  const you = preferredMember(snapshot, replica.session?.identity.id)?.id;
  const used = new Set(joinedParticipants(snapshot).map((grant) => grant.preferred_member_id));

  return activeMembers(snapshot).sort((left, right) =>
    Number(right.id === you) - Number(left.id === you) ||
    Number(used.has(right.id)) - Number(used.has(left.id)),
  );
}

export function participantMarkers(
  replica: ClientReplicaState,
  memberId: string,
  presence: string[] | null,
  connected: boolean,
): ParticipantMarker[] {
  return participantsForMember(replica.projected_snapshot, memberId).map((grant) => {
    const you = grant.identity_id === replica.session?.identity.id;

    return {
      identityId: grant.identity_id,
      label: `${grant.actor_handle}${you ? ' (you)' : ''}`,
      you,
      status: presence
        ? presence.includes(grant.identity_id) ? 'online' : 'offline'
        : you && !connected ? 'offline' : 'unknown',
    };
  });
}

/** Online when any participant is online; unknown only when all are unknown. */
export function memberStatus(participants: ParticipantMarker[]): ParticipantMarker['status'] {
  if (participants.some((participant) => participant.status === 'online')) return 'online';

  if (participants.every((participant) => participant.status === 'unknown')) return 'unknown';

  return 'offline';
}

/** A member's place in the group, in the order people were added, which picks their avatar tint. */
export function memberTint(snapshot: ClientReplicaState['projected_snapshot'] | undefined, memberId: string): number {
  return Math.max(0, snapshot?.members.findIndex((member) => member.id === memberId) ?? 0);
}
