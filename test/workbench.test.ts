import { describe, expect, it } from 'vitest';
import {
  fixtureIdentityId,
  scenarioPresence,
  scenarioReplica,
  type MemberListScenario,
} from '../apps/client/src/workbench/memberListFixture';

const scenario: MemberListScenario = {
  members: ['Ana', 'Ben', 'Chloe'],
  you: 'ana',
  others: ['Ben', 'Nobody'],
  presence: 'realtime',
  othersOnline: false,
  connection: 'online',
};

describe('preview fixtures', () => {
  it('builds a member list scenario with participants and presence', () => {
    const replica = scenarioReplica(scenario);
    const grants = replica.projected_snapshot?.access_grants ?? [];

    expect(grants.map((grant) => grant.preferred_member_id)).toEqual([
      'member-1______________',
      'member-2______________',
      null,
    ]);
    expect(scenarioPresence(scenario, replica)).toEqual([fixtureIdentityId]);
    expect(
      scenarioPresence({ ...scenario, othersOnline: true }, replica),
    ).toHaveLength(3);
    expect(
      scenarioPresence({ ...scenario, connection: 'offline' }, replica),
    ).toBeNull();
  });
});
