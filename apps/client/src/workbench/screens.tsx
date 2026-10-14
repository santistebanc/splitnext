import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import { LoadingGroups } from '../ui/AppScreen';
import { CreateGroup } from '../ui/CreateGroup';
import { GroupSettings } from '../ui/GroupSettings';
import { GroupsView } from '../ui/GroupsView';
import { GroupView } from '../ui/GroupView';
import { InvitePanel } from '../ui/InvitePanel';
import { JoinGroup } from '../ui/JoinGroup';
import { NoticesPanel } from '../ui/NoticesPanel';
import { Sheet } from '../ui/Sheet';
import { s } from '../ui/components';
import { ActionsProvider } from '../ui/useActionCall';
import { useCompactLayout } from '../ui/useVisibleViewport';
import { ActionConsole } from './ActionConsole';
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
  'member_name_taken',
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
    hint: 'Every command rejects with this error.',
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
  sheet?: boolean;
  children: (app: FakeApp) => ReactNode;
};

/** Renders a screen against an in-memory group, optionally inside a sheet. */
function ScreenDemo(props: ScreenDemoProps) {
  const app = useFakeApp({ scenario: defaultScenario, ...props.options });
  const actions = useFakeDispatcher(app);
  const mobile = useCompactLayout();

  // Sheets sit on the app's dimmed overlay at a fixed height, so their height
  // limit and scrolling behave as they do over a page.
  return (
    <ActionsProvider value={actions}>
      {props.sheet ? (
        <View style={[s.overlay, mobile && s.mobileOverlay, ws.backdrop]}>
          <Sheet mobile={mobile}>{props.children(app)}</Sheet>
        </View>
      ) : (
        <View style={[s.stack, ws.page]}>{props.children(app)}</View>
      )}
    </ActionsProvider>
  );
}

export const screenStories: Story[] = [
  defineStory({
    id: 'action-console',
    group: 'Actions',
    title: 'Action console',
    description:
      'Every app action, called by name with JSON input as RPC or an ' +
      'assistant would, against an in-memory group.',
    controls: {
      you: { kind: 'text', default: 'Ana' },
      others: {
        kind: 'text',
        default: 'Ben',
        hint: 'Member names other participants use; try selectYou on one.',
      },
      ...commandControls,
    },
    render: (values, log) => (
      <ActionConsole
        options={{
          scenario: {
            ...defaultScenario,
            you: values.you.trim(),
            others: listValue(values.others),
          },
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
        }}
      />
    ),
  }),
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
          groups: fixtureGroups(listValue(values.active), listValue(values.left)),
        }}
      >
        {(app) => (
          <GroupsView app={app} navigate={(view) => log('navigate', view)} />
        )}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'create-group',
    group: 'Screens',
    title: 'CreateGroup',
    description: 'Group creation, including its offline and unreachable states.',
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
      'An open group. Share invite is primary until someone else joins.',
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
        hint: 'Member names other participants use; any makes invite secondary.',
      },
      left: { kind: 'boolean', default: false, hint: 'This installation left.' },
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
            ? [renameNotice('member-2', 'Ben', 'Benji', 'superseded')]
            : [],
        }}
      >
        {(app) => (
          <GroupView
            app={app}
            navigate={(view) => log('navigate', view)}
            showReview
          />
        )}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'invite-panel',
    group: 'Sheets',
    title: 'InvitePanel',
    description: 'Copy, share, and replace the invite link, with confirmation.',
    controls: { ...commandControls },
    render: (values, log) => (
      <ScreenDemo
        sheet
        options={{
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
        }}
      >
        {(app) => <InvitePanel app={app} close={() => log('close')} />}
      </ScreenDemo>
    ),
  }),
  defineStory({
    id: 'group-settings',
    group: 'Sheets',
    title: 'GroupSettings',
    description: 'Rename or leave the group, as a sheet or a full page.',
    controls: {
      fullPage: { kind: 'boolean', default: false },
      ...commandControls,
    },
    render: (values, log) => (
      <ScreenDemo
        sheet={!values.fullPage}
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
            fullPage={values.fullPage}
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
      'Joining from a link or rejoining a left group. Names a participant ' +
      'uses are marked In use.',
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
        hint: 'Names current participants use.',
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
        }}
      >
        {(app) => (
          <JoinGroup
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
    id: 'notices-panel',
    group: 'Sheets',
    title: 'NoticesPanel',
    description: 'Rejected or superseded changes to apply again or dismiss.',
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
        sheet
        options={{
          connection: values.connection,
          latency: values.latency,
          failure: values.failure,
          log,
          notices: [
            ...(values.notices === 'rejected' || values.notices === 'both'
              ? [renameNotice('member-2', 'Ben', 'Ana', 'rejected')]
              : []),
            ...(values.notices === 'superseded' || values.notices === 'both'
              ? [renameNotice('member-3', 'Chloe', 'Clo', 'superseded')]
              : []),
          ],
        }}
      >
        {(app) => <NoticesPanel app={app} close={() => log('close')} />}
      </ScreenDemo>
    ),
  }),
];

const ws = StyleSheet.create({
  backdrop: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    alignSelf: 'stretch',
    height: 600,
    borderRadius: 8,
  },
  page: { width: '100%', maxWidth: 680 },
});
