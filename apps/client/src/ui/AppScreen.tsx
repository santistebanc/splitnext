import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { router } from 'expo-router';
import { z } from 'zod';
import { clientErrorKind, parseInviteLink } from '@splitnext/client';
import { AppController } from '../model/controller';
import { createDispatcher } from '../model/actions';
import { browserActionPlatform } from './browserPlatform';
import { createBrowserApp } from '../model/browser';
import { ViewTransition } from './ViewTransition';
import { SyncStatus } from './ConnectionStatus';
import { CreateGroup, CreateGroupFooter } from './CreateGroup';
import { Frame } from './Frame';
import { ExpenseControls, ExpenseEditor, ExpenseEditorHeader } from './ExpenseEditor';
import { AddExpenseButton } from './ExpenseList';
import { ActivityHeader, ActivityPanel } from './ActivityPanel';
import { PersonDetails, PersonHeader } from './PersonView';
import { SettleUp, SettleUpHeader } from './SettleUp';
import { GroupSettings, GroupSettingsFooter } from './GroupSettings';
import { GroupsFooter, GroupsHeader, GroupsView, WelcomeView } from './GroupsView';
import { Toast } from './Toast';
import { useActivityFeed } from './useActivityFeed';
import { SettlementsHeader, SettlementsPanel } from './SettlementsPanel';
import { GroupHeader, GroupView } from './GroupView';
import { InviteSheet } from './InvitePanel';
import { useBalancesLayout } from './BalancesPanel';
import { CompactProgressContext, createCompactProgress } from './pageScroll';
import { JoinGroup, JoinGroupFooter, type JoinCalls } from './JoinGroup';
import { navigationSchema } from './navigation';
import { Devtools } from '../devtools/Devtools';
import { ActionsProvider, useActionCall, useActions, useUiState } from './useActionCall';
import { useCompactLayout } from './useVisibleViewport';
import { BackButton, Button, ErrorMessage, ScreenHeader, errorMessage, s, useAction } from './components';
import type { UiState } from '../model/uiState';

/** An invite link opened the app: a long link names its group, a short one only its code. */
type ScreenProps = { incomingGroupId?: string; invite?: boolean };

type AppProps = { controller: AppController; invite?: boolean };

/** What a screen shows: a fixed header, its content, and at most one main action. */
type Screen = { header?: ReactNode; body: ReactNode; footer?: ReactNode; ruledFooter?: boolean };

export function AppScreen(props: ScreenProps) {
  const [controller, setController] = useState<AppController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current: AppController | null = null;
    let cancelled = false;

    const initialize = async () => {
      try {
        current = await createBrowserApp();

        if (cancelled) {
          current.dispose();

          return;
        }

        await current.start(navigator.onLine);

        const code = props.invite ? parseInviteLink(window.location.href)?.token : undefined;
        const joined = props.incomingGroupId ?? (code ? await current.groupWithInvite(code) : null);

        if (!cancelled && joined && (await current.openJoinedGroup(joined))) {
          enterApp();

          return;
        }

        if (cancelled) current.dispose();
        else setController(current);
      } catch (cause) {
        if (!cancelled)
          setError(
            errorMessage(
              cause instanceof Error ? cause : new Error('storage_unavailable'),
            ),
          );
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      current?.dispose();
    };
  }, [attempt, props.incomingGroupId, props.invite]);

  if (!controller) {
    return (
      <Frame>
        {error ? (
          <View style={[s.stack, { paddingTop: 32 }]}>
            <Text style={s.heading}>Let’s try that again</Text>
            <ErrorMessage message={error} />
            <Button
              onPress={() => {
                setError(null);
                setAttempt(attempt + 1);
              }}
            >
              Try again
            </Button>
          </View>
        ) : (
          <LoadingGroups />
        )}
      </Frame>
    );
  }

  return <ReadyApp controller={controller} {...props} />;
}

/** A placeholder shaped like the groups list while local storage opens. */
export function LoadingGroups() {
  return (
    <View
      accessibilityLabel="Opening your groups…"
      accessibilityLiveRegion="polite"
      aria-busy
      style={{ gap: 10 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 20, paddingBottom: 8 }}>
        <View style={[s.skeleton, { width: 32, height: 32, borderRadius: 9 }]} />
        <View style={[s.skeleton, { width: 110, height: 22 }]} />
      </View>
      <View style={[s.skeleton, { width: 210, height: 36, marginTop: 20, marginBottom: 6 }]} />
      {[0, 1, 2].map((row) => (
        <View key={row} style={s.groupCard}>
          <View style={[s.skeleton, s.skeletonLine]} />
          <View style={[s.skeleton, s.skeletonShort]} />
        </View>
      ))}
    </View>
  );
}

/** The join screen's body and pinned button share these two calls' progress and errors. */
function WithJoinCalls(props: { children: (calls: JoinCalls) => ReactNode }) {
  const previewing = useActionCall();
  const joining = useActionCall();

  return <>{props.children({ previewing, joining })}</>;
}

function enterApp(): void {
  // Expo can preserve a fragment across route replacement. Remove it before
  // leaving the invite entry route, including links for existing participants.
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
  router.replace('/app');
}

/** Where the browser history entry for a screen leads back to. */
function historyEntry(ui: UiState, groupId: string | null) {
  return { splitnext: true, view: ui.view, trail: ui.trail, person: ui.person, groupId };
}

/** The undo offer for a member removed on this device; it closes itself after a while. */
function RemovalToast() {
  const ui = useUiState();
  const undo = useActionCall();
  const removal = ui.removal;
  const actions = useActions();

  useEffect(() => {
    if (!removal) return;
    const timer = setTimeout(() => { void actions.dispatch('dismissRemoval', {}, { origin: 'timer' }); }, 8000);

    return () => clearTimeout(timer);
  }, [removal?.id]);

  return (
    <Toast
      message={removal ? `${removal.name} ${removal.hidden ? 'hidden' : 'removed'}.` : null}
      action={removal && undo.can('restoreMember', { memberId: removal.memberId }) ? { text: 'Undo', onPress: () => { void undo.call('restoreMember', { memberId: removal.memberId }); } } : undefined}
    />
  );
}

function ReadyApp(props: AppProps) {
  const mobile = useCompactLayout();
  const app = props.controller;
  const state = useSyncExternalStore(app.subscribe, app.snapshot, app.snapshot);

  const actions = useMemo(
    () =>
      createDispatcher(app, {
        ...browserActionPlatform(),
        initialLink: props.invite ? window.location.href : '',
        seenStorage: browserSeenStorage,
      }),
    [app],
  );

  const ui = useSyncExternalStore(
    actions.ui.subscribe,
    actions.ui.snapshot,
    actions.ui.snapshot,
  );

  // Availability also changes when a running action finishes, without any UI
  // state change, so the header's navigation must follow executions too.
  useSyncExternalStore(
    actions.executions.subscribe,
    actions.executions.snapshot,
    actions.executions.snapshot,
  );

  useActivityFeed(app, state);
  const view = ui.view;
  const initialLink = ui.join.link;

  const action = useAction();
  const connection = useAction();

  useEffect(() => {
    const online = () => {
      void app.setOnline(navigator.onLine).catch((error) => app.reportSyncError(error));
    };

    const foreground = () => {
      if (document.visibilityState === 'visible' && navigator.onLine)
        void app.refresh().catch((error) => app.reportSyncError(error));
    };

    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    document.addEventListener('visibilitychange', foreground);

    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [app]);

  useEffect(() => {
    window.history.replaceState(historyEntry(ui, app.snapshot().group?.group_id ?? null), '');

    const back = (event: PopStateEvent) => {
      const parsed = navigationSchema.safeParse(event.state);

      if (!parsed.success) return;

      Keyboard.dismiss();

      const next = parsed.data;

      void action.run(async () => {
        const outcome = await actions.dispatch(
          'restoreNavigation',
          { view: next.view, trail: next.trail, person: next.person ?? undefined, groupId: next.groupId ?? undefined },
          { origin: 'history' },
        );

        if (outcome.status === 'failed') throw new Error(outcome.error);
      });
    };

    window.addEventListener('popstate', back);

    return () => window.removeEventListener('popstate', back);
  }, [app]);

  useEffect(() => {
    Keyboard.dismiss();

    const entry = historyEntry(ui, app.snapshot().group?.group_id ?? null);

    if (ui.navigation.mode === 'push')
      window.history.pushState(entry, '', window.location.href);
    else window.history.replaceState(entry, '', window.location.href);

    // Leaving the join page for a group or the groups list drops the invite URL.
    if (props.invite && ui.view === 'home') enterApp();
  }, [ui.navigation.revision]);

  const balances = useBalancesLayout();
  const compact = useMemo(createCompactProgress, []);

  const group = state.group;
  const open = Boolean(group?.projected_snapshot);

  const pending = state.groups.reduce(
    (count, entry) => count + entry.pending_commands,
    0,
  );

  // Connection failures belong to the header icon. Keep other background and
  // navigation failures visible, including storage and protocol errors.
  const backgroundError =
    action.error ?? (state.syncError && !['network', 'offline'].includes(clientErrorKind(state.syncError)) ? errorMessage(state.syncError) : null);

  const onGroupScreen = open && (view === 'home' || view === 'invite');
  const joined = Boolean(group && !group.hidden);
  const addsExpenses = open && view === 'home' && joined;

  function retry(): void {
    void connection.run(async () => {
      const outcome = await actions.dispatch('refreshGroups', {}, { origin: 'ui' });

      if (outcome.status === 'failed') throw new Error(outcome.error);
    });
  }

  function dispatch(name: 'closePanel' | 'showGroups'): void {
    void actions.dispatch(name, {}, { origin: 'ui' });
  }

  // Each screen has a fixed header, its content, and at most one main action.
  function screenFor(join: JoinCalls): Screen {
    if (view === 'create')
      return {
        header: <ScreenHeader title="New group" start={<BackButton label="Back to groups" disabled={!actions.availability('showGroups', {}).available} onPress={() => dispatch('showGroups')} />} />,
        body: <CreateGroup app={app} />,
        footer: <CreateGroupFooter app={app} />,
      };

    if (view === 'join' || view === 'rejoin') {
      const joinProps = { app, initialLink, rejoining: view === 'rejoin', ...join };

      return {
        header: <ScreenHeader start={<BackButton label="Back" disabled={!actions.availability('closePanel', {}).available} onPress={() => dispatch('closePanel')} />} />,
        body: <JoinGroup {...joinProps} />,
        footer: <JoinGroupFooter {...joinProps} />,
        ruledFooter: true,
      };
    }

    if ((!open || !group) && !state.groups.length) return { body: <WelcomeView /> };

    if (!open || !group)
      return {
        header: <GroupsHeader connectionStatus={<SyncStatus online={state.online} reachable={state.reachable} pending={pending} busy={connection.busy} onRetry={retry} retryError={connection.error} />} />,
        body: <GroupsView app={app} />,
        footer: <GroupsFooter />,
      };

    switch (view) {
      case 'expense':
        return {
          header: (
            <>
              <ExpenseEditorHeader app={app} />
              <ExpenseControls app={app} />
            </>
          ),
          body: <ExpenseEditor app={app} />,
        };
      case 'settlements':
        return { header: <SettlementsHeader />, body: <SettlementsPanel replica={group} /> };
      case 'person':
        return { header: <PersonHeader app={app} />, body: <PersonDetails app={app} /> };
      case 'settle':
        return { header: <SettleUpHeader app={app} />, body: <SettleUp app={app} /> };
      case 'activity':
        return { header: <ActivityHeader app={app} />, body: <ActivityPanel replica={group} /> };
      case 'settings':
        return {
          header: <ScreenHeader title="Group settings" context={group.projected_snapshot?.group.name} start={<BackButton label="Back to group" disabled={!actions.availability('closePanel', {}).available} onPress={() => dispatch('closePanel')} />} />,
          body: <GroupSettings app={app} />,
          footer: <GroupSettingsFooter />,
        };
      default:
        return {
          header: <GroupHeader app={app} pending={pending} busy={connection.busy} onRetry={retry} retryError={connection.error} onLayout={balances.measureHeader} />,
          body: (
            <>
              <GroupView app={app} layout={balances} />
              {view === 'invite' ? <InviteSheet app={app} /> : null}
            </>
          ),
          footer: addsExpenses ? <View pointerEvents="box-none" style={{ alignItems: 'flex-end' }}><AddExpenseButton /></View> : undefined,
        };
    }
  }

  const pageKey = onGroupScreen ? `group:${group?.group_id}` : `${view}:${group?.group_id ?? ''}:${ui.person ?? ''}`;

  return (
    <ActionsProvider value={actions}>
      <CompactProgressContext.Provider value={compact}>
        <WithJoinCalls>
          {(join) => {
            const screen = screenFor(join);

            return (
              <View style={s.page}>
                <Frame
                  header={screen.header}
                  footer={screen.footer}
                  floatingFooter={addsExpenses}
                  ruledFooter={screen.ruledFooter}
                  scrollKey={pageKey}
                  onScroll={(y) => {
                    compact.follow(y);

                    if (onGroupScreen) balances.scroll.set(y);
                  }}
                  scrollControl={onGroupScreen ? balances.scrollControl : undefined}
                >
                  <ViewTransition key={pageKey} mobile={mobile}>
                    <ErrorMessage message={backgroundError} />
                    {screen.body}
                  </ViewTransition>
                </Frame>
                <RemovalToast />
                <Devtools />
              </View>
            );
          }}
        </WithJoinCalls>
      </CompactProgressContext.Provider>
    </ActionsProvider>
  );
}

/** How far this installation has seen each group's Activity, kept in localStorage. */
const browserSeenStorage = {
  read(): Record<string, number> {
    try {
      const parsed = seenSchema.safeParse(JSON.parse(localStorage.getItem(activitySeenKey) ?? '{}'));

      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  },
  write(seen: Record<string, number>): void {
    try {
      localStorage.setItem(activitySeenKey, JSON.stringify(seen));
    } catch {
      // Seen markers are a convenience; a full store only shows items as new again.
    }
  },
};

const activitySeenKey = 'splitnext.activity-seen.v1';

const seenSchema = z.record(z.string(), z.number().int());
