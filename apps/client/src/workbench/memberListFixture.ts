import type {
  ClientGroupSummary,
  ClientReplicaState,
} from '@splitnext/client';
import type { AppState } from '../model/controller';

type Snapshot = NonNullable<ClientReplicaState['projected_snapshot']>;

type Notice = ClientReplicaState['notices'][number];

export type Connection = 'online' | 'offline' | 'unreachable';

type Member = Snapshot['members'][number];

/** The group situation a member list preview starts from. */
export type MemberListScenario = {
  members: string[];
  /** The member name this installation uses, or blank for nobody. */
  you: string;
  /** One member name per other participant who joined the group. */
  others: string[];
  presence: 'realtime' | 'unavailable';
  othersOnline: boolean;
  connection: 'online' | 'offline';
};

const at = '2026-01-01T00:00:00.000Z';

// A well-formed identifier, so invite links built from it parse.
export const fixtureGroupId = 'wbGroupFixture00000000';

export function fixtureId(label: string): string {
  return label.padEnd(22, '_').slice(0, 22);
}

export const fixtureIdentityId = fixtureId('workbench-you');

export function scenarioReplica(
  scenario: MemberListScenario,
): ClientReplicaState {
  const members = scenario.members.map(
    (name, index): Member => ({
      id: fixtureId(`member-${index + 1}`),
      display_name: name,
      status: 'active',
      created_at: at,
      updated_at: at,
    }),
  );

  const memberId = (name: string): string | null =>
    members.find(
      (member) => member.display_name.toLowerCase() === name.toLowerCase(),
    )?.id ?? null;

  const snapshot: Snapshot = {
    group: { id: fixtureGroupId, name: 'Workbench trip', created_at: at },
    members,
    expenses: [],
          settlements: [],
    access_grants: [
      {
        identity_id: fixtureIdentityId,
        actor_handle: 'This device',
        preferred_member_id: memberId(scenario.you),
        granted_at: at,
        hidden_at: null,
      },
      ...scenario.others.map((name, index) => ({
        identity_id: fixtureId(`wb-participant-${index + 1}`),
        actor_handle: `Participant ${index + 1}`,
        preferred_member_id: memberId(name),
        granted_at: at,
        hidden_at: null,
      })),
    ],
    invite: {
      id: fixtureId('workbench-invite'),
      created_by_identity_id: fixtureIdentityId,
      created_at: at,
      token: 'w'.repeat(43),
    },
  };

  return {
    online: scenario.connection === 'online',
    session: {
      identity: { id: fixtureIdentityId, created_at: at },
      device: { id: fixtureId('workbench-device'), created_at: at },
    },
    group_id: fixtureGroupId,
    revision: 1,
    confirmed_snapshot: snapshot,
    projected_snapshot: snapshot,
    outbox: [],
    notices: [],
    hidden: false,
    activity: [],
    last_synced_at: at,
  };
}

/** Identities the realtime channel reports as connected, or null without one. */
export function scenarioPresence(
  scenario: MemberListScenario,
  replica: ClientReplicaState,
): string[] | null {
  if (scenario.presence === 'unavailable' || scenario.connection === 'offline')
    return null;

  const grants = replica.projected_snapshot?.access_grants ?? [];

  return grants
    .map((grant) => grant.identity_id)
    .filter((id) => id === fixtureIdentityId || scenario.othersOnline);
}

/** Group list entries for names, the left ones marked as left. */
export function fixtureGroups(
  active: string[],
  left: string[],
): ClientGroupSummary[] {
  return [
    ...active.map((name, index) => ({ name, left: false, index })),
    ...left.map((name, index) => ({ name, left: true, index })),
  ].map(
    (entry): ClientGroupSummary => ({
      group_id: fixtureId(`${entry.left ? 'left' : 'group'}-${entry.index + 1}`),
      name: entry.name,
      status: entry.left ? 'left' : 'active',
      stored_locally: true,
      pending_commands: 0,
      member_count: entry.index + 2,
      you_name: entry.left ? null : 'Ana',
      you_balances: entry.left ? null : [],
    }),
  );
}

/** The controller state the app's screens read, for a given connection. */
export function fixtureState(
  connection: Connection,
  group: ClientReplicaState | null,
  groups: ClientGroupSummary[] = [],
): AppState {
  return {
    ready: true,
    online: connection !== 'offline',
    reachable: connection === 'online',
    groups,
    group,
    reviewGroups: [],
    syncError: null,
  };
}

/** A local rename the server rejected or superseded, for the review panel. */
export function renameNotice(
  memberId: string,
  from: string,
  to: string,
  status: 'rejected' | 'superseded',
): Notice {
  const commandId = fixtureId(`notice-${memberId.slice(0, 8)}-${status.slice(0, 3)}`);

  return {
    command: {
      command_id: commandId,
      type: 'member.rename',
      payload: {
        member_id: memberId,
        expected_display_name: from,
        display_name: to,
      },
    },
    outcome: {
      command_id: commandId,
      command_type: 'member.rename',
      status,
      reason: status === 'rejected' ? 'member_removed' : null,
      audit_id: null,
      target: { kind: 'member', id: memberId },
      server_state: {
        kind: 'member',
        member: {
          id: memberId,
          display_name: from,
          status: 'active',
          created_at: at,
          updated_at: at,
        },
      },
    },
    recorded_at: at,
  };
}
