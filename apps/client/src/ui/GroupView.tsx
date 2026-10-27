import { useContext } from 'react';
import { Pressable, Text, View } from 'react-native';
import { attentionCount } from '../model/activity';
import { BalancesHold, GroupBalances, type BalancesLayout } from './BalancesPanel';
import { Button, ErrorMessage, ScreenHeader, colors, s } from './components';
import { CompactProgressContext } from './pageScroll';
import { ExpenseList } from './ExpenseList';
import { BellIcon, ChevronDownIcon, SettingsIcon } from './icons';
import type { MemberListApp } from './MemberList';
import { fontFamily, radius } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

type GroupViewProps = { app: MemberListApp };

/** The bell that opens Activity, with a count of new changes from others and changes to review. */
function ActivityBell(props: { app: MemberListApp }) {
  const open = useActionCall();
  const ui = useUiState();
  const replica = props.app.snapshot().group;
  const { fresh, review } = attentionCount(replica, replica ? ui.activitySeen[replica.group_id] : undefined);
  const count = fresh + review;

  const label = count
    ? `Activity: ${[fresh ? `${fresh} new ${fresh === 1 ? 'update' : 'updates'}` : '', review ? `${review} ${review === 1 ? 'change' : 'changes'} to review` : ''].filter(Boolean).join(', ')}`
    : 'Activity, no new updates';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!open.can('showActivity')}
      onPress={() => { void open.call('showActivity', {}); }}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, !open.can('showActivity') && s.dim]}
    >
      <BellIcon />
      {count ? (
        <View aria-hidden style={{ position: 'absolute', top: 4, right: 2, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.background, backgroundColor: colors.alert, alignItems: 'center', justifyContent: 'center' }}>
          <Text testID="activity-count" style={{ fontFamily, fontSize: 11, fontWeight: '700', color: colors.actionInk }}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The group screen's fixed top: the group name, which opens the group list,
 * the Activity bell, and group settings. Connection status belongs to Frame.
 */
export function GroupHeader(props: { app: MemberListApp; onLayout?: (height: number) => void }) {
  const compact = useContext(CompactProgressContext);
  const actions = useActions();
  const settings = useActionCall();
  const state = props.app.snapshot();
  const replica = state.group;
  const name = replica?.projected_snapshot?.group.name ?? '';
  const canLeave = actions.availability('showGroups', {}).available;
  const open = Boolean(replica && !replica.hidden);

  return (
    <View
      onLayout={(event) => {
        // The balances fit the room below the full header; shrinking it only adds room.
        if (!compact.get()) props.onLayout?.(event.nativeEvent.layout.height);
      }}
    >
      <ScreenHeader
        heading={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name}. Switch group`}
            accessibilityState={{ disabled: !canLeave }}
            disabled={!canLeave}
            onPress={() => { void actions.dispatch('showGroups', {}, { origin: 'ui' }); }}
            style={({ pressed }) => [{ alignSelf: 'flex-start', maxWidth: '100%', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && s.pressed, !canLeave && s.dim]}
          >
            <Text accessibilityRole="header" numberOfLines={1} style={[s.screenTitle, { flexShrink: 1 }]}>{name}</Text>
            <ChevronDownIcon size={20} color={colors.muted} />
          </Pressable>
        )}
        end={open ? (
          <>
            <ActivityBell app={props.app} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Group settings"
              accessibilityState={{ disabled: !settings.can('showSettings') }}
              disabled={!settings.can('showSettings')}
              onPress={() => { void settings.call('showSettings', {}); }}
              style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, !settings.can('showSettings') && s.dim]}
            >
              <SettingsIcon />
            </Pressable>
          </>
        ) : undefined}
      />
    </View>
  );
}

/**
 * The group screen's content, one scrolling page: the Balances section, then
 * expenses and repayments; or rejoining a group left here.
 */
export function GroupView(props: GroupViewProps & { layout: BalancesLayout }) {
  const action = useActionCall();
  const showAll = useUiState().balancesExpanded && Boolean(props.layout.plan?.truncated);
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;

  if (!snapshot || !replica) return null;

  if (replica.hidden)
    return (
      <View style={s.prompt}>
        <Text style={s.body}>You left this group.</Text>
        <Button disabled={!action.can('showRejoin')} onPress={() => { void action.call('showRejoin', {}); }}>
          Rejoin group
        </Button>
        <ErrorMessage message={action.error} />
      </View>
    );

  return (
    <View>
      <GroupBalances app={props.app} replica={replica} layout={props.layout} />
      <ExpenseList replica={replica} stickyTop={props.layout.plan?.minimal} onHeadingPress={() => props.layout.scrollToExpenses(showAll)} />
      <BalancesHold layout={props.layout} />
    </View>
  );
}
