import { describe, expect, it } from 'vitest';
import { activeMembers, memberLabel, nameOrdinals, preferredMember, previewFromSnapshot } from '../src/client';
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

    const removed = snapshot?.members[0];
    const left = snapshot?.access_grants[1];
    const self = snapshot?.access_grants[0];

    if (!snapshot || !removed || !left || !self) throw new Error('missing fixture');
    removed.status = 'hidden';
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

  it('numbers repeated names among shown members and drops the number once a name is unique', () => {
    const group = scenarioReplica({
      members: ['Ana', 'Ben', 'ana', 'Ana'], you: 'Ben', others: [],
      presence: 'realtime', othersOnline: true, connection: 'online',
    });

    const snapshot = group.projected_snapshot;
    const [first, ben, second, third] = snapshot?.members ?? [];

    if (!snapshot || !first || !ben || !second || !third) throw new Error('missing fixture');
    const label = (member: typeof first) => memberLabel(member.display_name, nameOrdinals(snapshot).get(member.id));

    expect([first, ben, second, third].map(label)).toEqual(['Ana (1)', 'Ben', 'ana (2)', 'Ana (3)']);

    // A hidden member can still show in balances, so it keeps its number.
    second.status = 'hidden';
    expect([first, second, third].map(label)).toEqual(['Ana (1)', 'ana (2)', 'Ana (3)']);
    expect(previewFromSnapshot(snapshot).members.map((member) => memberLabel(member.display_name, member.name_ordinal)))
      .toEqual(['Ana (1)', 'Ben', 'Ana (3)']);

    // A deleted member is never shown, so the others close up around it.
    first.status = 'deleted';
    third.status = 'deleted';
    expect(label(second)).toBe('ana');
  });
});
