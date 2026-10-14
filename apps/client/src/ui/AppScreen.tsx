import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Keyboard, Modal, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppController } from '../model/controller';
import { createDispatcher } from '../model/actions';
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
import { navigationSchema, type ViewName } from './navigation';
import { ActionsProvider } from './useActionCall';
import { useSheetKeyboard } from './useSheetKeyboard';
import { useCompactLayout, useTouchInput } from './useVisibleViewport';
import { Button, ErrorMessage, errorMessage, s, useAction } from './components';

type ScreenProps = { incomingGroupId?: string };

type Navigation = { view: ViewName };

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
  const actions = useMemo(() => createDispatcher(app), [app]);

  const [navigation, setNavigation] = useState<Navigation>({
    view: props.incomingGroupId ? 'join' : 'home',
  });

  const [initialLink] = useState(() =>
    props.incomingGroupId ? window.location.href : '',
  );

  const [noticeSummary, setNoticeSummary] = useState(true);

  const noticeKey =
    state.group?.notices.map((notice) => notice.command.command_id).join(',') ??
    '';

  const action = useAction();

  useEffect(() => {
    setNoticeSummary(true);
  }, [noticeKey]);

  useEffect(() => {
    const online = () => {
      void action.run(() => app.setOnline(navigator.onLine));
    };

    const foreground = () => {
      if (document.visibilityState === 'visible' && navigator.onLine)
        void action.run(() => app.refresh());
    };

    const timer = setInterval(() => {
      const current = app.snapshot();

      if (
        current.online &&
        (!current.reachable ||
          current.groups.some((group) => group.pending_commands > 0))
      )
        void action.run(() => app.refresh());
    }, 10000);

    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    document.addEventListener('visibilitychange', foreground);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [app]);

  useEffect(() => {
    window.history.replaceState(
      {
        splitnext: true,
        view: navigation.view,
        groupId: state.group?.group_id ?? null,
      },
      '',
    );

    const back = (event: PopStateEvent) => {
      const parsed = navigationSchema.safeParse(event.state);

      if (!parsed.success) return;

      Keyboard.dismiss();

      const next = parsed.data;

      void action.run(async () => {
        const outcome = next.groupId
          ? await actions.dispatch(
              'openGroup',
              { groupId: next.groupId },
              { origin: 'history' },
            )
          : await actions.dispatch('closeGroup', {}, { origin: 'history' });

        if (outcome.status === 'failed') throw new Error(outcome.error);

        setNavigation({ view: next.view });
      });
    };

    window.addEventListener('popstate', back);

    return () => window.removeEventListener('popstate', back);
  }, [app]);

  function navigate(view: ViewName): void {
    Keyboard.dismiss();

    const next = { view };

    window.history.pushState(
      {
        splitnext: true,
        ...next,
        groupId: app.snapshot().group?.group_id ?? null,
      },
      '',
    );
    setNavigation(next);
  }

  function close(): void {
    if (
      props.incomingGroupId &&
      !app.snapshot().group?.hidden &&
      app.snapshot().group
    ) {
      enterApp();
    } else navigate('home');
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
      <Frame
        onGroups={
          // Create and join pages have their own Back action.
          !['create', 'join', 'rejoin'].includes(navigation.view) &&
          !isFormPage &&
          (group || navigation.view !== 'home')
            ? () => {
                void actions.dispatch('closeGroup', {}, { origin: 'ui' });
                navigate('home');
              }
            : undefined
        }
      >
        <ViewTransition key={pageKey} mobile={mobile}>
          {!state.online || !state.reachable || pending > 0 ? (
            <View accessibilityLiveRegion="polite" style={[s.banner, s.between]}>
              <Text style={s.body}>
                {!state.online
                  ? 'Offline'
                  : !state.reachable
                    ? 'Connection unavailable'
                    : 'Syncing…'}
                {pending > 0 ? ` · ${pending} pending` : ''}
              </Text>
              {state.online && !state.reachable ? (
                <Button
                  quiet
                  disabled={action.busy}
                  onPress={() => {
                    void action.run(() => app.refresh());
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
                <Button secondary onPress={() => navigate('notices')}>
                  Review changes · {notices}
                </Button>
                <Button quiet onPress={() => setNoticeSummary(false)}>
                  Hide
                </Button>
              </View>
            </View>
          ) : null}
          {navigation.view === 'create' ? (
            <CreateGroup app={app} close={close} />
          ) : navigation.view === 'join' || navigation.view === 'rejoin' ? (
            <JoinGroup
              app={app}
              close={close}
              initialLink={initialLink}
              rejoining={navigation.view === 'rejoin'}
            />
          ) : isFormPage && navigation.view === 'settings' ? (
            <GroupSettings app={app} close={close} fullPage />
          ) : group?.projected_snapshot ? (
            <GroupView
              app={app}
              navigate={navigate}
              showReview={!noticeSummary}
            />
          ) : (
            <GroupsView app={app} navigate={navigate} />
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
                <InvitePanel app={app} close={close} />
              ) : navigation.view === 'settings' ? (
                <GroupSettings app={app} close={close} />
              ) : navigation.view === 'notices' ? (
                <NoticesPanel app={app} close={close} />
              ) : null}
            </Sheet>
          </View>
        </Modal>
      </Frame>
    </ActionsProvider>
  );
}
