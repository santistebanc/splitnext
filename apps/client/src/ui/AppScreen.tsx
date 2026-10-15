import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Keyboard, Modal, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppController } from '../model/controller';
import { createDispatcher } from '../model/actions';
import { workflowBusy } from '../model/workflow';
import { browserActionPlatform } from './browserPlatform';
import { createBrowserApp } from '../model/browser';
import { ViewTransition } from './ViewTransition';
import { CreateGroup } from './CreateGroup';
import { Frame } from './Frame';
import { GroupSettings } from './GroupSettings';
import { GroupsView } from './GroupsView';
import { GroupView } from './GroupView';
import { InvitePanel } from './InvitePanel';
import { JoinGroup } from './JoinGroup';
import { NoticesPanel } from './NoticesPanel';
import { Sheet } from './Sheet';
import { navigationSchema } from './navigation';
import { Devtools } from '../devtools/Devtools';
import { ActionsProvider } from './useActionCall';
import { useSheetKeyboard } from './useSheetKeyboard';
import { useCompactLayout, useTouchInput } from './useVisibleViewport';
import { Button, ErrorMessage, errorMessage, s, useAction } from './components';

type ScreenProps = { incomingGroupId?: string };

type AppProps = { controller: AppController; incomingGroupId?: string };

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

        if (
          !cancelled &&
          props.incomingGroupId &&
          (await current.openJoinedGroup(props.incomingGroupId))
        ) {
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
  }, [attempt, props.incomingGroupId]);

  if (!controller) {
    return (
      <Frame>
        {error ? (
          <View style={s.main}>
            <Text style={s.heading}>Letâ€™s try that again</Text>
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
      accessibilityLabel="Opening your groupsâ€¦"
      accessibilityLiveRegion="polite"
      aria-busy
      style={s.stack}
    >
      <View style={[s.skeleton, s.skeletonTitle]} />
      <View style={[s.card, s.listCard]}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={s.person}>
            <View style={[s.avatar, s.skeleton]} />
            <View style={s.personText}>
              <View style={[s.skeleton, s.skeletonLine]} />
              <View style={[s.skeleton, s.skeletonShort]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
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

function ReadyApp(props: AppProps) {
  const mobile = useCompactLayout();
  const touch = useTouchInput();
  const app = props.controller;
  const state = useSyncExternalStore(app.subscribe, app.snapshot, app.snapshot);

  const actions = useMemo(
    () =>
      createDispatcher(app, {
        ...browserActionPlatform(),
        initialLink: props.incomingGroupId ? window.location.href : '',
      }),
    [app],
  );

  const ui = useSyncExternalStore(
    actions.ui.subscribe,
    actions.ui.snapshot,
    actions.ui.snapshot,
  );

  const navigation = { view: ui.view };
  const noticeSummary = ui.showNoticeSummary;
  const initialLink = ui.join.link;

  const noticeKey =
    state.group?.notices.map((notice) => notice.command.command_id).join(',') ??
    '';

  const action = useAction();

  useEffect(() => {
    void actions.dispatch(
      'setNoticeSummaryVisible',
      { visible: true },
      { origin: 'lifecycle' },
    );
  }, [noticeKey]);

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
    window.history.replaceState(
      {
        splitnext: true,
        view: ui.view,
        groupId: app.snapshot().group?.group_id ?? null,
      },
      '',
    );

    const back = (event: PopStateEvent) => {
      const parsed = navigationSchema.safeParse(event.state);

      if (!parsed.success) return;

      Keyboard.dismiss();

      const next = parsed.data;

      void action.run(async () => {
        const outcome = await actions.dispatch(
          'restoreNavigation',
          { view: next.view, groupId: next.groupId ?? undefined },
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

    const entry = {
      splitnext: true,
      view: ui.view,
      groupId: app.snapshot().group?.group_id ?? null,
    };

    if (ui.navigation.mode === 'push')
      window.history.pushState(entry, '', window.location.href);
    else window.history.replaceState(entry, '', window.location.href);

    if (
      props.incomingGroupId &&
      ui.view === 'home' &&
      app.snapshot().group &&
      !app.snapshot().group?.hidden
    )
      enterApp();
  }, [ui.navigation.revision]);

  function close(): void {
    void actions.dispatch('closePanel', {}, { origin: 'ui' });
  }

  const group = state.group;

  const pending = state.groups.reduce(
    (count, entry) => count + entry.pending_commands,
    0,
  );

  const notices = group?.notices.length ?? 0;

  // Background refreshes and history navigation have no button to sit beside,
  // so their failures join the connection status at the top of the page.
  const backgroundError =
    action.error ?? (state.syncError ? errorMessage(state.syncError) : null);

  const isFormPage = (mobile || touch) && navigation.view === 'settings';

  const isSheet =
    !isFormPage && ['invite', 'settings', 'notices'].includes(navigation.view);

  useSheetKeyboard(isSheet, close);

  const pageKey =
    isFormPage || ['create', 'join', 'rejoin'].includes(navigation.view)
      ? navigation.view
      : (group?.group_id ?? 'groups');

  return (
    <ActionsProvider value={actions}>
      <View style={s.page}>
        <Frame
          navigationDisabled={workflowBusy(ui)}
          onHomepage={() => {
            void actions.dispatch('showHomepage', {}, { origin: 'ui' });
          }}
          onGroups={
            // Create and join pages have their own Back action.
            !['create', 'join', 'rejoin'].includes(navigation.view) &&
            !isFormPage &&
            (group || navigation.view !== 'home')
              ? () => {
                  void actions.dispatch('showGroups', {}, { origin: 'ui' });
                }
              : undefined
          }
        >
          <ViewTransition key={pageKey} mobile={mobile}>
            {!state.online || !state.reachable || pending > 0 ? (
              <View
                accessibilityLiveRegion="polite"
                style={[s.banner, s.between]}
              >
                <Text style={s.body}>
                  {!state.online
                    ? 'Offline'
                    : !state.reachable
                      ? 'Connection unavailable'
                      : 'Syncingâ€¦'}
                  {pending > 0 ? ` Â· ${pending} pending` : ''}
                </Text>
                {state.online && !state.reachable ? (
                  <Button
                    quiet
                    disabled={action.busy}
                    onPress={() => {
                      void action.run(async () => {
                        const outcome = await actions.dispatch(
                          'refreshGroups',
                          {},
                          { origin: 'ui' },
                        );

                        if (outcome.status === 'failed')
                          throw new Error(outcome.error);
                      });
                    }}
                  >
                    Retry
                  </Button>
                ) : null}
              </View>
            ) : null}
            {backgroundError ? (
              <View style={[s.banner, s.errorBanner]}>
                <ErrorMessage message={backgroundError} />
              </View>
            ) : null}
            {notices > 0 && noticeSummary ? (
              <View style={s.banner}>
                <View style={s.row}>
                  <Button
                    secondary
                    onPress={() => {
                      void actions.dispatch(
                        'showNotices',
                        {},
                        { origin: 'ui' },
                      );
                    }}
                  >
                    Review changes Â· {notices}
                  </Button>
                  <Button
                    quiet
                    onPress={() => {
                      void actions.dispatch(
                        'setNoticeSummaryVisible',
                        { visible: false },
                        { origin: 'ui' },
                      );
                    }}
                  >
                    Hide
                  </Button>
                </View>
              </View>
            ) : null}
            {navigation.view === 'create' ? (
              <CreateGroup app={app} />
            ) : navigation.view === 'join' || navigation.view === 'rejoin' ? (
              <JoinGroup
                app={app}
                initialLink={initialLink}
                rejoining={navigation.view === 'rejoin'}
              />
            ) : isFormPage && navigation.view === 'settings' ? (
              <GroupSettings app={app} fullPage />
            ) : group?.projected_snapshot ? (
              <GroupView app={app} showReview={!noticeSummary} />
            ) : (
              <GroupsView app={app} />
            )}
          </ViewTransition>
          <Modal
            visible={isSheet}
            transparent
            animationType="fade"
            onRequestClose={close}
          >
            <View style={[s.overlay, mobile && s.mobileOverlay]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close popup"
                onPress={close}
                style={s.backdrop}
              />
              <Sheet mobile={mobile}>
                {navigation.view === 'invite' ? (
                  <InvitePanel app={app} />
                ) : navigation.view === 'settings' ? (
                  <GroupSettings app={app} />
                ) : navigation.view === 'notices' ? (
                  <NoticesPanel app={app} />
                ) : null}
              </Sheet>
            </View>
          </Modal>
        </Frame>
        <Devtools />
      </View>
    </ActionsProvider>
  );
}
