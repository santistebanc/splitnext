import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { View } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import { Button, Row, Stack, Text, layout } from '../design';
import { ActivityPanel } from '../ui/ActivityPanel';
import { LoadingGroups } from '../ui/AppScreen';
import { ConfirmSheet } from '../ui/ConfirmSheet';
import { SyncStatus } from '../ui/ConnectionStatus';
import { CreateGroup } from '../ui/CreateGroup';
import { Drawer } from '../ui/Drawer';
import { FooterDrawer } from '../ui/FooterDrawer';
import { GroupSettings } from '../ui/GroupSettings';
import { GroupsView } from '../ui/GroupsView';
import { GroupHeader, GroupView } from '../ui/GroupView';
import { InvitePanel } from '../ui/InvitePanel';
import { JoinGroup, JoinGroupFooter, type JoinCalls } from '../ui/JoinGroup';
import { BackButton, HeaderAction, ScreenHeader } from '../ui/ScreenHeader';
import { Toast } from '../ui/Toast';
import { ActionsProvider, useActionCall } from '../ui/useActionCall';
import { useFakeApp, useFakeDispatcher, type FakeApp, type FakeAppOptions } from '../workbench/fakeApp';
import { fixtureGroupId, fixtureGroups, renameNotice, type MemberListScenario } from '../workbench/memberListFixture';
import { Example, Props, Usage, type DocPage } from './doc';

function ScreenHeaderPage() {
  const [last, setLast] = useState('');

  return (
    <Stack gap={32}>
      <Usage code={'<ScreenHeader\n  start={<BackButton label="Back to groups" onPress={back} />}\n  end={<HeaderAction danger text="Delete" label="Delete Dinner" onPress={remove} />}\n  title="Dinner"\n/>'} />
      <Example title="Back, title, and an action" note="The title shrinks to 18 as the page scrolls under it; a hairline appears below.">
        <ScreenHeader start={<BackButton label="Back to groups" onPress={() => setLast('back')} />} end={<HeaderAction danger text="Delete" label="Delete" onPress={() => setLast('delete')} />} title="Lisbon weekend" />
      </Example>
      <Example title="Form header" note="Cancel at the start, quiet; nothing scrolls under it.">
        <ScreenHeader start={<HeaderAction quiet text="Cancel" label="Cancel" onPress={() => setLast('cancel')} />} scrollRule={false} />
      </Example>
      {last ? <Text variant="caption" tone="muted">Pressed {last}</Text> : null}
      <Props rows={[
        ['title?, heading?', 'string, ReactNode', 'A text title, or a heading that is more than text and styles itself with titleStyle(progress).'],
        ['start?, end?', 'ReactNode', 'The first row: back at the start, actions at the end.'],
        ['underRow?, below?', 'ReactNode', 'Right under the row, such as a field for one of its actions; and after the title.'],
        ['scrollRule?, flush?', 'boolean', 'Whether a hairline appears once scrolled, and whether the header ends at what is below.'],
        ['morph?', 'string', 'Flies the title to the same title on the next screen.'],
        ['BackButton: label, onPress, text?, disabled?', '', '“‹ Groups”: label is “Back to …”, and its name shows unless text says otherwise.'],
        ['HeaderAction: text, label, onPress, quiet?, danger?, disabled?', '', 'Cancel is quiet; Delete is danger.'],
      ]} />
    </Stack>
  );
}

function OverlaysPage() {
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [footer, setFooter] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);

    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <Stack gap={32}>
      <Usage code={'<Drawer title="Connection" onClose={close}>…</Drawer>\n<ConfirmSheet title="Leave this group?" message={message} confirmLabel="Leave group" busy={busy} onConfirm={leave} onCancel={cancel} />\n<Toast message="Ben removed." />'} />
      <Example title="Drawer, ConfirmSheet, and Toast" note="A drawer rises from the foot on phones and is a popup on wider screens.">
        <Row gap={12} wrap>
          <Button variant="secondary" onPress={() => setDrawer(true)}>Open drawer</Button>
          <Button variant="secondary" onPress={() => setConfirm(true)}>Ask to confirm</Button>
          <Button variant="secondary" onPress={() => setToast('Ben removed.')}>Show toast</Button>
        </Row>
      </Example>
      <Example title="FooterDrawer" note="Rises from a screen's main button, as New group does, and dims what is above it.">
        <FooterDrawer open={footer} title="New group" closeLabel="Close" onClose={() => setFooter(false)} footer={<Button onPress={() => setFooter(!footer)}>{footer ? 'Create group' : 'New group'}</Button>}>
          <Text variant="body">What the drawer holds.</Text>
        </FooterDrawer>
      </Example>
      <Example title="SyncStatus" note="A strip above every screen while disconnected; press it for details.">
        <View style={{ marginHorizontal: -24 }}>
          <SyncStatus online={false} reachable={false} pending={2} busy={false} onRetry={() => undefined} />
        </View>
      </Example>
      {drawer ? (
        <Drawer title="Connection" onClose={() => setDrawer(false)}>
          <Text variant="body">Changes saved here sync automatically when you reconnect.</Text>
          <Button onPress={() => setDrawer(false)}>Retry</Button>
        </Drawer>
      ) : null}
      {confirm ? <ConfirmSheet title="Leave this group?" message="You can rejoin it later from the groups you left." confirmLabel="Leave group" busy={false} onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} /> : null}
      <Toast message={toast} action={{ text: 'Undo', onPress: () => setToast(null) }} />
      <Props rows={[
        ['Drawer: title, onClose, full?, children', '', 'Tapping outside, Escape, or its close button dismisses it; full keeps its whole height.'],
        ['ConfirmSheet: title, message, confirmLabel, busy, onConfirm, onCancel', '', 'An action’s confirmation, with Cancel beside the button that confirms it.'],
        ['Toast: message, action?', 'string | null', 'A dark message at the foot, with one action such as Undo.'],
        ['FooterDrawer: open, title, closeLabel, closeText?, busy?, onClose, footer, children', '', 'The footer stays below; busy keeps it open.'],
        ['SyncStatus: online, reachable, pending, busy, onRetry, retryError?', '', 'Shows nothing while connected.'],
      ]} />
    </Stack>
  );
}

const noLog = () => undefined;

const scenario: MemberListScenario = {
  members: ['Ana', 'Ben', 'Chloe'],
  you: 'Ana',
  others: ['Ben'],
  presence: 'realtime',
  othersOnline: true,
  connection: 'online',
};

/** A screen over the real client and an in-memory server, seeded with one scenario. */
function ScreenDemo(props: { options?: Partial<Omit<FakeAppOptions, 'log'>>; initialAction?: 'showCreateGroup' | 'showSettings'; children: (app: FakeApp) => ReactNode }) {
  const app = useFakeApp({ scenario, connection: 'online', latency: 300, failure: 'none', ...props.options, log: noLog });
  const actions = useFakeDispatcher(app);

  useEffect(() => {
    if (props.initialAction && actions) void actions.dispatch(props.initialAction, {}, { origin: 'workbench' });
  }, [actions, props.initialAction]);

  if (!app || !actions) return <LoadingGroups />;

  return (
    <ActionsProvider value={actions}>
      <Stack gap={16} style={{ width: '100%', maxWidth: layout.column - 2 * layout.gutter }}>{props.children(app)}</Stack>
    </ActionsProvider>
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

/** A screen page: one live example, through the real client, that can be used as in the app. */
function screen(id: string, title: string, summary: string, source: string, demo: () => ReactNode): DocPage {
  return {
    id,
    section: 'Screens',
    title,
    summary,
    source,
    render: () => <Example title="Live" note="Runs on the production client over an in-memory server; it starts over when you leave the page.">{demo()}</Example>,
  };
}

export const chromePages: DocPage[] = [
  { id: 'screen-header', section: 'App chrome', title: 'ScreenHeader', summary: 'A screen’s fixed header: back, actions, and a title that shrinks as the page scrolls.', source: 'ui/ScreenHeader.tsx', render: () => <ScreenHeaderPage /> },
  { id: 'overlays', section: 'App chrome', title: 'Drawers and toasts', summary: 'What opens over a screen, and the offline strip above it.', source: 'ui/Drawer.tsx, ui/ConfirmSheet.tsx, ui/FooterDrawer.tsx, ui/Toast.tsx, ui/ConnectionStatus.tsx', render: () => <OverlaysPage /> },
];

export const screenPages: DocPage[] = [
  screen('loading', 'Loading', 'Shaped like the groups list while local storage opens.', 'ui/AppScreen.tsx · LoadingGroups', () => <LoadingGroups />),
  screen('groups', 'Groups', 'Your groups with your balance in each, and the groups you left.', 'ui/GroupsView.tsx', () => (
    <ScreenDemo options={{ groups: fixtureGroups(['Lisbon weekend', 'Berlin flat'], ['Old trip']) }}>{(app) => <GroupsView app={app} />}</ScreenDemo>
  )),
  screen('create-group', 'New group', 'The group’s name and your own name in it.', 'ui/CreateGroup.tsx', () => (
    <ScreenDemo initialAction="showCreateGroup" options={{ lastYouName: 'Ana' }}>{(app) => <CreateGroup app={app} />}</ScreenDemo>
  )),
  screen('group', 'Group', 'Everyone’s balance, then the expenses and repayments.', 'ui/GroupView.tsx', () => (
    <ScreenDemo>{(app) => (
      <>
        <SyncStatus online={app.snapshot().online} reachable={app.snapshot().reachable} pending={0} busy={false} onRetry={noLog} />
        <GroupHeader app={app} />
        <GroupView app={app} />
      </>
    )}</ScreenDemo>
  )),
  screen('invite', 'Invite', 'Copy, share, or replace the group’s invite link.', 'ui/InvitePanel.tsx', () => (
    <ScreenDemo>{(app) => <InvitePanel app={app} />}</ScreenDemo>
  )),
  screen('join', 'Join', 'An invite’s group, and choosing who you are in it. Names taken on other devices are marked.', 'ui/JoinGroup.tsx', () => (
    <ScreenDemo options={{ scenario: { ...scenario, you: '', others: ['Ana', 'Ben'] }, visitor: true, lastYouName: 'Dev' }}>
      {(app) => <JoinGroupDemo app={app} rejoining={false} initialLink={formatInviteLink('https://splitnext.example', fixtureGroupId, 'w'.repeat(43))} />}
    </ScreenDemo>
  )),
  screen('settings', 'Group settings', 'Renaming the group and leaving it on this device.', 'ui/GroupSettings.tsx', () => (
    <ScreenDemo initialAction="showSettings">{(app) => <GroupSettings app={app} />}</ScreenDemo>
  )),
  screen('activity', 'Activity', 'Changes needing review, then every change in the group by day.', 'ui/ActivityPanel.tsx', () => (
    <ScreenDemo options={{ notices: [renameNotice('member-2______________', 'Ben', 'Ana', 'rejected')] }}>
      {(app) => {
        const replica = app.snapshot().group;

        return replica ? <ActivityPanel replica={replica} /> : null;
      }}
    </ScreenDemo>
  )),
];
