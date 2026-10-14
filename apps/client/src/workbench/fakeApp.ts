import { useRef, useState } from 'react';
import type {
  ClientGroupSummary,
  ClientReplicaState,
  InvitePreview,
} from '@splitnext/client';
import {
  createDispatcher,
  type ActionHost,
  type Dispatcher,
} from '../model/actions';
import type { CreateGroupApp } from '../ui/CreateGroup';
import type { GroupSettingsApp } from '../ui/GroupSettings';
import type { GroupsViewApp } from '../ui/GroupsView';
import type { InvitePanelApp } from '../ui/InvitePanel';
import type { JoinGroupApp } from '../ui/JoinGroup';
import type { MemberListApp } from '../ui/MemberList';
import type { NoticesPanelApp } from '../ui/NoticesPanel';
import {
  addMember,
  fixtureState,
  projectChange,
  scenarioPresence,
  scenarioReplica,
  selectMember,
  updateMember,
  type Connection,
  type MemberListScenario,
} from './memberListFixture';
import type { Log } from './stories';

/** Every controller surface the app's screens use, so one fake serves all. */
export type FakeApp = ActionHost &
  GroupsViewApp &
  CreateGroupApp &
  MemberListApp &
  InvitePanelApp &
  GroupSettingsApp &
  JoinGroupApp &
  NoticesPanelApp;

type Snapshot = NonNullable<ClientReplicaState['projected_snapshot']>;

type Notice = ClientReplicaState['notices'][number];

export type FakeAppOptions = {
  scenario: MemberListScenario;
  connection: Connection;
  /** Milliseconds before each command settles. */
  latency: number;
  /** An error code every command rejects with, or 'none'. */
  failure: string;
  log: Log;
  groups?: ClientGroupSummary[];
  notices?: Notice[];
  hidden?: boolean;
  lastYouName?: string;
};

/**
 * An in-memory group behind the app's controller surface. Member, name, and
 * notice changes apply locally; other commands only log and settle.
 */
export function useFakeApp(options: FakeAppOptions): FakeApp {
  const [replica, setReplica] = useState(
    (): ClientReplicaState => ({
      ...scenarioReplica(options.scenario),
      notices: options.notices ?? [],
      hidden: options.hidden ?? false,
    }),
  );

  const state = fixtureState(options.connection, replica, options.groups);

  async function command(
    name: string,
    detail: string,
    change?: (snapshot: Snapshot) => Snapshot,
  ): Promise<void> {
    options.log(name, detail);
    await new Promise((resolve) => setTimeout(resolve, options.latency));

    if (options.failure !== 'none') {
      options.log(`${name} rejected`, options.failure);
      throw new Error(options.failure);
    }

    if (change) setReplica((current) => projectChange(current, change));
  }

  async function resolveNotice(name: string, commandId: string): Promise<void> {
    await command(name, commandId);
    setReplica((current) => ({
      ...current,
      notices: current.notices.filter(
        (notice) => notice.command.command_id !== commandId,
      ),
    }));
  }

  const preview: InvitePreview = {
    group: {
      id: replica.group_id,
      name: replica.projected_snapshot?.group.name ?? '',
    },
    members: (replica.projected_snapshot?.members ?? []).map((member) => ({
      id: member.id,
      display_name: member.display_name,
      in_use: (replica.projected_snapshot?.access_grants ?? []).some(
        (grant) => grant.preferred_member_id === member.id && !grant.hidden_at,
      ),
    })),
  };

  return {
    snapshot: () => state,
    lastYouName: () => options.lastYouName ?? null,
    showGroups: () => options.log('showGroups'),
    client: {
      presence: () =>
        scenarioPresence(
          {
            ...options.scenario,
            connection:
              options.connection === 'online' ? 'online' : 'offline',
          },
          replica,
        ),
      previewInvite: async (groupId) => {
        await command('previewInvite', groupId);

        return preview;
      },
    },
    openGroup: (groupId) => command('openGroup', groupId),
    openJoinedGroup: async (groupId) => {
      await command('openJoinedGroup', groupId);

      return false;
    },
    createGroup: (input) =>
      command('createGroup', `${input.name} as ${input.creator_member_name}`),
    joinGroup: (groupId, choice) =>
      command(
        'joinGroup',
        choice.kind === 'new' ? choice.display_name : choice.member_id,
      ),
    addPerson: (name) =>
      command('addPerson', name, (snapshot) => addMember(snapshot, name)),
    renamePerson: (memberId, name) =>
      command('renamePerson', `${memberId} → ${name}`, (snapshot) =>
        updateMember(snapshot, memberId, { display_name: name }),
      ),
    archivePerson: (memberId) =>
      command('archivePerson', memberId, (snapshot) =>
        updateMember(snapshot, memberId, { status: 'archived' }),
      ),
    selectPerson: (memberId) =>
      command('selectPerson', memberId, (snapshot) =>
        selectMember(snapshot, memberId),
      ),
    renameGroup: (name) =>
      command('renameGroup', name, (snapshot) => ({
        ...snapshot,
        group: { ...snapshot.group, name },
      })),
    regenerateInvite: () => command('regenerateInvite', replica.group_id),
    leaveGroup: () => command('leaveGroup', replica.group_id),
    applyAgain: (commandId) => resolveNotice('applyAgain', commandId),
    dismissNotice: (commandId) => resolveNotice('dismissNotice', commandId),
  };
}

/**
 * A dispatcher over the fake that stays the same across renders, so observers
 * persist, while every call reaches the fake's latest state.
 */
export function useFakeDispatcher(app: FakeApp): Dispatcher {
  const latest = useRef(app);

  latest.current = app;

  const [dispatcher] = useState(() =>
    createDispatcher({
      snapshot: () => latest.current.snapshot(),
      createGroup: (input) => latest.current.createGroup(input),
      joinGroup: (groupId, choice, token) =>
        latest.current.joinGroup(groupId, choice, token),
      openGroup: (groupId) => latest.current.openGroup(groupId),
      openJoinedGroup: (groupId) => latest.current.openJoinedGroup(groupId),
      showGroups: () => latest.current.showGroups(),
      renameGroup: (name, observed) =>
        latest.current.renameGroup(name, observed),
      addPerson: (name) => latest.current.addPerson(name),
      renamePerson: (memberId, name, observed) =>
        latest.current.renamePerson(memberId, name, observed),
      archivePerson: (memberId) => latest.current.archivePerson(memberId),
      selectPerson: (memberId) => latest.current.selectPerson(memberId),
      regenerateInvite: () => latest.current.regenerateInvite(),
      leaveGroup: () => latest.current.leaveGroup(),
      applyAgain: (commandId) => latest.current.applyAgain(commandId),
      dismissNotice: (commandId) => latest.current.dismissNotice(commandId),
      client: {
        previewInvite: (groupId, token) =>
          latest.current.client.previewInvite(groupId, token),
      },
    }),
  );

  return dispatcher;
}
