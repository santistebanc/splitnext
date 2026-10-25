import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import { LoadingGroups } from '../ui/AppScreen';
import { CreateGroup } from '../ui/CreateGroup';
import { GroupSettings } from '../ui/GroupSettings';
import { GroupsView } from '../ui/GroupsView';
import { GroupHeader, GroupView } from '../ui/GroupView';
import { useBalancesLayout } from '../ui/BalancesPanel';
import { SyncStatus } from '../ui/ConnectionStatus';
import { InviteSheet } from '../ui/InvitePanel';
import { JoinGroup, JoinGroupFooter, type JoinCalls } from '../ui/JoinGroup';
import { ActivityPanel } from '../ui/ActivityPanel';
import { s } from '../ui/components';
import { ActionsProvider, useActionCall } from '../ui/useActionCall';
import {
  useFakeApp,
  useFakeDispatcher,
  type FakeApp,
  type FakeAppOptions,
} from './fakeApp';
import {
  fixtureGroupId,
  fixtureGroups,
  renameNotice,
  type MemberListScenario,
} from './memberListFixture';
import { defineStory, listValue, type Story } from './stories';

const connections = ['online', 'offline', 'unreachable'] as const;

const failures = [
  'none',
  'client_offline',
  'request_failed',
  'member_removed',
  'invite_invalid',
  'invite_replaced',
] as const;

const commandControls = {
  connection: { kind: 'select', options: connections, default: 'online' },
  latency: {
    kind: 'number',
    default: 400,
    min: 0,
    max: 5000,
    step: 100,
    hint: 'Milliseconds before a command settles.',
  },
  failure: {
    kind: 'select',
    options: failures,
    default: 'none',
    hint: 'Connected requests fail with this error; offline edits still queue.',
  },
} as const;

const defaultScenario: MemberListScenario = {
  members: ['Ana', 'Ben', 'Chloe'],
  you: 'Ana',
  others: ['Ben'],
  presence: 'realtime',
  othersOnline: true,
  connection: 'online',
};

type ScreenDemoProps = {
  options: Omit<FakeAppOptions, 'scenario'> &
    Partial<Pick<FakeAppOptions, 'scenario'>>;
  initialAction?: 'showCreateGroup' | 'showSettings';
  children: (app: FakeApp) => ReactNode;
};

/** Renders a screen's content against an in-memory group. */
function ScreenDemo(props: ScreenDemoProps) {
  const app = useFakeApp({ scenario: defaultScenario, ...props.options });
  const actions = useFakeDispatcher(app);

  useEffect(() => {
    if (props.initialAction && actions)
      void actions.dispatch(props.initialAction, {}, { origin: 'workbench' });
  }, [actions, props.initialAction]);

  if (!app || !actions) return <LoadingGroups />;

  return (
    <ActionsProvider value={actions}>
      <View style={[s.stack, ws.page]}>{props.children(app)}</View>
    </ActionsProvider>
  );
}

/** The group screen's header and content, sharing the balances layout as the app does. */
function GroupScreenDemo(props: { app: FakeApp; onRetry: () => void }) {
  const layout = useBalancesLayout();
  const state = props.app.snapshot();

  return (
    <>
      <View onLayout={(event) => layout.measureStatus(event.nativeEvent.layout.height)}>
        <SyncStatus online={state.online} reachable={state.reachable} pending={0} busy={false} onRetry={props.onRetry} />
      </View>
      <GroupHeader app={props.app} onLayout={layout.measureHeader} />
      <GroupView app={props.app} layout={layout} />
    </>
  );
}

/** The join screen's body and its pinned button, sharing their calls as the app does. */
function JoinGroupDemo(props: Omit<ComponentProps<typeof JoinGroup>, keyof JoinCalls>) {
  const previewing = useActionCall();
  const joining = useActionCall();

  return (
    <>
      <JoinGroup {...props} previewing={previewing} joining={joining} />
      <JoinGroupFooter {...props} previewing={previewing} joining={joining} />
    </>
  );
}

export const screenStories: Story[] = [
  defineStory({
    id: 'loading-groups',
    group: 'Screens',
    title: 'LoadingGroups',
    description: 'Placeholder shown while local storage opens.',
    controls: {},
    render: () => (
      <View style={{ width: '100%', maxWidth: 680 }}>
        <LoadingGroups />
      </View>
    ),
  }),
  defineStory({
    id: 'groups-view',
    group: 'Screens',
    title: 'GroupsView',
    description:
      'The groups list, its empty state, and left groups. Failures show ' +
      'beside the pressed row.',
    controls: {
      active: { kind: 'text', default: 'Lisbon weekend, Berlin flat' },
      left: { kind: 'text', default: 'Old trip' },
      ...commandControls,
    },
    render: (values, log) => (
      <ScreenDemo
        options={{
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
          groups: fixtureGroups(
            listValue(values.active),
            listValue(values.left),
          ),
        }}
      >
        {(app) => <GroupsView app={app} />}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'create-group',
    group: 'Screens',
    title: 'CreateGroup',
    description:
      'Group creation, including its offline and unreachable states.',
    controls: {
      lastYouName: {
        kind: 'text',
        default: 'Ana',
        hint: 'The remembered name that prefills Your name.',
      },
      ...commandControls,
    },
    render: (values, log) => (
      <ScreenDemo
        initialAction="showCreateGroup"
        options={{
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
          lastYouName: values.lastYouName,
        }}
      >
        {(app) => <CreateGroup app={app} close={() => log('close')} />}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'group-view',
    group: 'Screens',
    title: 'GroupView',
    description:
      'An open group: the header with the Activity bell, the balances, and ' +
      'the expenses and repayments.',
    controls: {
      members: { kind: 'text', default: 'Ana, Ben, Chloe' },
      you: {
        kind: 'text',
        default: 'Ana',
        hint: 'Blank shows the prompt to choose who you are.',
      },
      others: {
        kind: 'text',
        default: '',
        hint: 'Names taken by other participants; any makes invite secondary.',
      },
      left: {
        kind: 'boolean',
        default: false,
        hint: 'This installation left.',
      },
      notices: { kind: 'boolean', default: false },
      ...commandControls,
    },
    render: (values, log) => (
      <ScreenDemo
        options={{
          scenario: {
            members: listValue(values.members),
            you: values.you.trim(),
            others: listValue(values.others),
            presence: 'realtime',
            othersOnline: true,
            connection: values.connection === 'online' ? 'online' : 'offline',
          },
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
          hidden: values.left,
          notices: values.notices
            ? [renameNotice('member-2______________', 'Ben', 'Benji', 'superseded')]
            : [],
        }}
      >
        {(app) => <GroupScreenDemo app={app} onRetry={() => log('retry')} />}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'invite-sheet',
    group: 'Screens',
    title: 'InviteSheet',
    description: 'Copy, share, and replace the invite link, with confirmation.',
    controls: { ...commandControls },
    render: (values, log) => (
      <ScreenDemo
        options={{
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
        }}
      >
        {(app) => <InviteSheet app={app} />}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'group-settings',
    group: 'Screens',
    title: 'GroupSettings',
    description: 'Renaming the group and leaving it on this device.',
    controls: {
      ...commandControls,
    },
    render: (values, log) => (
      <ScreenDemo
        initialAction="showSettings"
        options={{
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
        }}
      >
        {(app) => (
          <GroupSettings
            app={app}
            close={() => log('close')}
          />
        )}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'join-group',
    group: 'Screens',
    title: 'JoinGroup',
    description:
      'Joining from a link or rejoining a left group. Names taken on other ' +
      'devices are marked Taken.',
    controls: {
      mode: {
        kind: 'select',
        options: ['enter link', 'invite preview', 'rejoin'],
        default: 'invite preview',
      },
      members: { kind: 'text', default: 'Ana, Ben, Chloe' },
      inUse: {
        kind: 'text',
        default: 'Ana, Ben',
        hint: 'Names taken by current participants.',
      },
      lastYouName: { kind: 'text', default: 'Dev' },
      ...commandControls,
    },
    render: (values, log) => (
      <ScreenDemo
        options={{
          scenario: {
            members: listValue(values.members),
            // The previewing installation has not chosen anyone yet.
            you: '',
            others: listValue(values.inUse),
            presence: 'realtime',
            othersOnline: true,
            connection: 'online',
          },
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
          lastYouName: values.lastYouName,
          hidden: values.mode === 'rejoin',
          visitor: values.mode !== 'rejoin',
        }}
      >
        {(app) => (
          <JoinGroupDemo
            app={app}
            close={() => log('close')}
            rejoining={values.mode === 'rejoin'}
            initialLink={
              values.mode === 'invite preview'
                ? formatInviteLink(
                    'https://splitnext.example',
                    fixtureGroupId,
                    'w'.repeat(43),
                  )
                : ''
            }
          />
        )}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'activity-panel',
    group: 'Screens',
    title: 'ActivityPanel',
    description:
      'Changes needing review, to apply again or dismiss, above every change ' +
      'in the group.',
    controls: {
      notices: {
        kind: 'select',
        options: ['none', 'rejected', 'superseded', 'both'],
        default: 'both',
      },
      ...commandControls,
    },
    render: (values, log) => (
      <ScreenDemo
        options={{
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
          notices: [
            ...(values.notices === 'rejected' || values.notices === 'both'
              ? [renameNotice('member-2______________', 'Ben', 'Ana', 'rejected')]
              : []),
            ...(values.notices === 'superseded' || values.notices === 'both'
              ? [renameNotice('member-3______________', 'Chloe', 'Clo', 'superseded')]
              : []),
          ],
        }}
      >
        {(app) => {
          const replica = app.snapshot().group;

          return replica ? <ActivityPanel replica={replica} /> : null;
        }}
      </ScreenDemo>
    ),
  }),
];

const ws = StyleSheet.create({
  page: { width: '100%', maxWidth: 560 },
});
