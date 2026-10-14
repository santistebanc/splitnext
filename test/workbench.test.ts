import { describe, expect, it } from 'vitest';
import {
  defaultValues,
  defineStory,
  listValue,
  searchStories,
} from '../apps/client/src/workbench/stories';
import {
  addMember,
  fixtureIdentityId,
  projectChange,
  scenarioPresence,
  scenarioReplica,
  selectMember,
  type MemberListScenario,
} from '../apps/client/src/workbench/memberListFixture';

const button = defineStory({
  id: 'button',
  group: 'Inputs',
  title: 'Button',
  description: 'Primary and quiet actions.',
  controls: {
    label: { kind: 'text', default: 'Save' },
    disabled: { kind: 'boolean', default: false },
  },
  render: () => null,
});

const star = defineStory({
  id: 'presence-star',
  group: 'Members',
  title: 'PresenceStar',
  description: 'Presence marker.',
  controls: { status: { kind: 'select', options: ['online'], default: 'online' } },
  render: () => null,
});

const scenario: MemberListScenario = {
  members: ['Ana', 'Ben', 'Chloe'],
  you: 'ana',
  others: ['Ben', 'Nobody'],
  presence: 'realtime',
  othersOnline: false,
  connection: 'online',
};

describe('component workbench', () => {
  it('searches titles, groups, descriptions, and control names', () => {
    const stories = [button, star];

    expect(searchStories(stories, '')).toEqual(stories);
    expect(searchStories(stories, 'members')).toEqual([star]);
    expect(searchStories(stories, 'INPUTS disabled')).toEqual([button]);
    expect(searchStories(stories, 'button status')).toEqual([]);
  });

  it('seeds values from control defaults', () => {
    expect(defaultValues(button.controls)).toEqual({
      label: 'Save',
      disabled: false,
    });
    expect(listValue(' Ana, ,Ben ,')).toEqual(['Ana', 'Ben']);
  });

  it('builds a member list scenario with participants and presence', () => {
    const replica = scenarioReplica(scenario);
    const grants = replica.projected_snapshot?.access_grants ?? [];

    expect(grants.map((grant) => grant.preferred_member_id)).toEqual([
      'member-1',
      'member-2',
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

  it('projects local member edits', () => {
    const replica = projectChange(scenarioReplica(scenario), (snapshot) =>
      selectMember(addMember(snapshot, 'Dev'), 'member-4'),
    );

    expect(replica.projected_snapshot?.members.at(-1)?.display_name).toBe(
      'Dev',
    );
    expect(
      replica.projected_snapshot?.access_grants[0]?.preferred_member_id,
    ).toBe('member-4');
    expect(replica.confirmed_snapshot?.members).toHaveLength(3);
  });
});
