import { describe, expect, it } from 'vitest';
import { activeMembers, preferredMember, previewFromSnapshot } from '../src/client';
import { orderedMembers, participantMarkers, memberStatus } from '../apps/client/src/model/memberPresentation';
import { scenarioReplica } from '../apps/client/src/workbench/memberListFixture';

function replica() {
  return scenarioReplica({
    members: ['Ana', 'Ben', 'Chloe', 'Dev'], you: 'Chloe', others: ['Ben', 'Ben'],
    presence: 'realtime', othersOnline: true, connection: 'online',
  });
}

describe('shared member queries and presentation', () => {
  it('uses current participants and active members for ordering and join choices', () => {
    const group = replica();
    const snapshot = group.projected_snapshot;

    const archived = snapshot?.members[0];
    const left = snapshot?.access_grants[1];
    const self = snapshot?.access_grants[0];

    if (!snapshot || !archived || !left || !self) throw new Error('missing fixture');
    archived.status = 'archived';
    left.hidden_at = '2026-01-02T00:00:00.000Z';

    expect(activeMembers(snapshot).map((member) => member.display_name)).toEqual(['Ben', 'Chloe', 'Dev']);
    expect(orderedMembers(group).map((member) => member.display_name)).toEqual(['Chloe', 'Ben', 'Dev']);
    expect(previewFromSnapshot(snapshot).members).toMatchObject([
      { display_name: 'Ben', in_use: true }, { display_name: 'Chloe', in_use: true },
      { display_name: 'Dev', in_use: false },
    ]);
    expect(snapshot.members.map((member) => member.display_name)).toEqual(['Ana', 'Ben', 'Chloe', 'Dev']);
    self.hidden_at = '2026-01-02T00:00:00.000Z';
    expect(preferredMember(snapshot, group.session?.identity.id)).toBeNull();
  });

  it('combines presence while showing a known local outage as offline', () => {
    const group = replica();
    const others = participantMarkers(group, 'member-2______________', ['wb-participant-2______'], true);

    expect(others.map((participant) => participant.status)).toEqual(['offline', 'online']);
    expect(memberStatus(others)).toBe('online');
    expect(memberStatus(participantMarkers(group, 'member-2______________', null, false))).toBe('unknown');
    expect(participantMarkers(group, 'member-3______________', null, false)).toMatchObject([{ you: true, status: 'offline' }]);
  });
});
