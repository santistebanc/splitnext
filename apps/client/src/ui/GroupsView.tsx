import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { parseInviteLink, type ClientGroupSummary } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { BrandMark } from './BrandMark';
import { CreateGroup, useSubmitCreate } from './CreateGroup';
import { between, useCompactProgress } from './pageScroll';
import { Reveal } from './Reveal';
import { morph } from './ScreenMorph';
import { BalanceBar, Button, ErrorMessage, FooterButton, Notice, ScreenHeader, balanceColor, s, signedFigure, titleStyle } from './components';
import { ArrowRightIcon, TrashIcon } from './icons';
import { colors, fontFamily, monoFamily, withTransition } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type GroupsViewApp = Pick<AppController, 'snapshot'>;

type GroupsViewProps = { app: GroupsViewApp };

/** The groups list's main action, pinned at the foot of the screen. */
export function GroupsFooter(props: { app: GroupsViewApp }) {
  const ui = useUiState();
  const actions = useActions();
  const action = useActionCall();
  const { action: create, submit } = useSubmitCreate();
  const creating = ui.view === 'create';
  const busy = ui.phase === 'creating' || create.busy;
  const { online, reachable } = props.app.snapshot();

  function close(): void {
    void actions.dispatch('showGroups', {}, { origin: 'ui' });
  }

  return (
    // A drawer: while New group is open, the list above dims and a tap on it
    // closes the drawer. The footer's own top padding belongs to the drawer.
    <View style={{ gap: 10, marginTop: -10, paddingTop: 10, zIndex: 10 }}>
      <Pressable
        accessibilityLabel="Close New group"
        aria-hidden={!creating}
        tabIndex={-1}
        disabled={!creating || busy}
        onPress={close}
        style={withTransition({ position: 'absolute', bottom: '100%', top: -4000, left: -4000, right: -4000, backgroundColor: 'rgba(20, 20, 19, 0.32)', opacity: creating ? 1 : 0, pointerEvents: creating ? 'auto' : 'none' }, 'opacity', creating ? 340 : 260)}
      />
      <Reveal upward>
        {creating ? (
          <View role="region" aria-label="New group" style={{ paddingBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text accessibilityRole="header" style={[s.headerActionText, { fontSize: 17, fontWeight: '700' }]}>New group</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to groups"
                disabled={busy}
                onPress={close}
                style={({ pressed }) => [{ height: 44, justifyContent: 'center', paddingLeft: 16 }, pressed && s.pressed]}
              >
                <Text style={[s.headerActionText, { color: colors.muted }]}>Cancel</Text>
              </Pressable>
            </View>
            <CreateGroup app={props.app} />
            {!online || !reachable ? (
              <Notice
                tone="danger"
                role="alert"
                message={`Can’t create the group. ${!online ? 'You’re offline.' : 'Splitnext can’t be reached.'} Nothing you typed was lost.`}
              />
            ) : null}
            <ErrorMessage message={create.error} />
          </View>
        ) : null}
      </Reveal>
      <ErrorMessage message={action.error} />
      <FooterButton
        morph="newgroup"
        busy={creating && busy}
        disabled={creating ? !create.can('submitCreateGroup') : !action.can('showCreateGroup')}
        onPress={() => {
          if (creating) submit();
          else void action.call('showCreateGroup', {});
        }}
      >
        {creating ? (busy ? 'Creating…' : create.error ? 'Try again' : 'Create group') : 'New group'}
      </FooterButton>
    </View>
  );
}

/**
 * The name and Join with a link above the large mark. Join opens a link
 * field directly under it; Open checks the link on the join screen.
 */
export function GroupsHeader() {
  const progress = useCompactProgress();
  const join = useActionCall();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [invalid, setInvalid] = useState(false);
  const field = useRef<TextInput>(null);
  const joinToggle = useRef<View>(null);

  function submit(): void {
    if (!parseInviteLink(link.trim())) {
      setInvalid(true);

      return;
    }

    void join.call('showJoinGroup', { link: link.trim() });
  }

  return (
    <>
      <ScreenHeader
        end={(
          <Pressable
            ref={joinToggle}
            accessibilityRole="button"
            accessibilityLabel="Join with an invite link"
            accessibilityState={{ expanded: open }}
            disabled={!join.can('showJoinGroup', {})}
            onPress={() => {
              setOpen(!open);
              setInvalid(false);
            }}
            style={({ pressed }) => [{ height: 44, justifyContent: 'center', paddingLeft: 16, paddingRight: 24, marginRight: -12 }, pressed && s.pressed]}
          >
            <Text style={[s.headerActionText, s.link]}>Join with a link</Text>
          </Pressable>
        )}
        underRow={(
          <Reveal toggle={joinToggle} onOutsidePress={() => { setOpen(false); setInvalid(false); }}>
            {open ? (
              <View style={{ gap: 8, paddingTop: 4 }}>
                <View style={[s.fieldRow, invalid && { borderColor: colors.owes }]}>
                  <TextInput
                    ref={field}
                    autoFocus
                    accessibilityLabel="Invite link"
                    value={link}
                    onChangeText={(value) => {
                      setLink(value);
                      setInvalid(false);
                    }}
                    onSubmitEditing={submit}
                    placeholder="Paste invite link"
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    style={[s.input, { height: 40, fontFamily: monoFamily, fontSize: 13 }]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open"
                    onPress={submit}
                    hitSlop={6}
                    style={({ pressed }) => [{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.action }, pressed && s.pressed]}
                  >
                    <ArrowRightIcon size={16} color={colors.actionInk} />
                  </Pressable>
                </View>
                {invalid ? <Text style={[s.caption, { color: colors.owes }]}>That isn’t a splitnext invite link.</Text> : null}
              </View>
            ) : null}
          </Reveal>
        )}
        heading={(
          // The mark and the name stand where a title would be, as large and
          // shrinking the same way; together they are still the screen's heading.
          <View accessibilityRole="header" accessibilityLabel="Your groups" style={{ flexDirection: 'row', alignItems: 'center', gap: between(10, 7, progress) }}>
            <BrandMark size={between(34, 22, progress)} />
            <Text numberOfLines={1} style={titleStyle(progress)}>splitnext</Text>
          </View>
        )}
      />
      <ErrorMessage message={join.error} />
    </>
  );
}

/** The first screen, before any group: the same list, empty, with how to begin. */
export function WelcomeView() {
  return (
    <View style={s.emptyState}>
      <Text style={s.emptyTitle}>No groups yet</Text>
      <Text style={s.emptyText}>Start a group for a trip or a shared home, or join one with an invite link.</Text>
    </View>
  );
}

/** Your balance and how it compares with your other groups, or why there is none. */
function GroupBalance(props: { group: ClientGroupSummary }) {
  const balances = props.group.stored_locally ? props.group.you_balances : undefined;

  if (balances === null) return <Text style={[s.amount, { color: colors.muted }]}>choose who you are</Text>;

  if (balances === undefined) return <Text style={[s.amount, { color: colors.muted }]}>—</Text>;

  if (!balances.length) return <Text style={[s.amount, { color: colors.muted }]}>settled</Text>;

  return (
    <View style={{ alignItems: 'flex-end', gap: 6 }}>
      {balances.map(({ currency, amount }) => (
        <Text key={currency} ref={morph(`gamt-${props.group.group_id}-${currency}`)} style={[s.amount, { color: balanceColor(amount) }]}>{signedFigure(amount, currency)}</Text>
      ))}
    </View>
  );
}

/** Your groups as ruled rows with your balance as a bar, then the groups you left. */
export function GroupsView(props: GroupsViewProps) {
  const state = props.app.snapshot();
  const showLeft = useUiState().showLeftGroups;
  const actions = useActions();
  // The row last pressed, so a failure appears beside that row.
  const [target, setTarget] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  // The open confirmation's own trash button, which toggles it.
  const leaveToggle = useRef<View>(null);
  const action = useActionCall();
  const active = state.groups.filter((group) => group.status === 'active');
  const left = state.groups.filter((group) => group.status === 'left');
  const firstBalance = (group: ClientGroupSummary) => (group.stored_locally ? group.you_balances?.[0]?.amount ?? 0 : 0);
  const firstCurrency = (group: ClientGroupSummary) => (group.stored_locally ? group.you_balances?.[0]?.currency : undefined);
  // Your bar flies to your row on the group screen.
  const barMorph = (group: ClientGroupSummary) => (firstCurrency(group) ? `gbar-${group.group_id}-${firstCurrency(group)}` : null);
  const max = Math.max(1, ...active.map((group) => Math.abs(firstBalance(group))));

  function open(group: ClientGroupSummary): void {
    setTarget(group.group_id);
    void action.call('openGroup', { groupId: group.group_id });
  }

  // Leaving waits for the group to open: a call made from inside another's
  // callback would find the control still busy and be dropped.
  async function leave(group: ClientGroupSummary): Promise<void> {
    let opened = false;

    setTarget(group.group_id);
    await action.call('openGroup', { groupId: group.group_id }, () => { opened = true; });

    if (opened) await action.call('leaveGroup', {}, () => setLeaving(null), true);
  }

  function row(group: ClientGroupSummary) {
    const people = group.member_count === null ? null : group.member_count === 1 ? '1 person' : `${group.member_count} people`;
    const meta = [people, group.you_name ? `You’re ${group.you_name}` : null].filter(Boolean).join(' · ');
    const review = state.reviewGroups.includes(group.group_id);

    return (
      <View key={group.group_id}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${group.name}`}
          disabled={action.busy}
          onPress={() => open(group)}
          style={({ pressed }) => [s.groupCard, pressed && s.pressed]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
              <Text ref={morph(`gname-${group.group_id}`)} numberOfLines={2} style={{ maxWidth: '100%', fontFamily, fontSize: 20, lineHeight: 25, fontWeight: '600', color: colors.ink }}>{group.name}</Text>
            </View>
            <Pressable
              ref={leaving === group.group_id ? leaveToggle : undefined}
              accessibilityRole="button"
              accessibilityLabel={`Leave ${group.name}`}
              onPress={() => setLeaving(leaving === group.group_id ? null : group.group_id)}
              style={({ pressed }) => [{ width: 44, height: 44, marginVertical: -10, marginRight: -12, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed]}
            >
              <TrashIcon size={18} color={colors.muted} />
            </Pressable>
          </View>
          <BalanceBar track amount={firstBalance(group)} max={max} morph={barMorph(group)} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={s.caption}>{meta || ' '}</Text>
              {group.pending_commands ? <Text style={s.caption}>{group.pending_commands === 1 ? '1 change waiting' : `${group.pending_commands} changes waiting`}</Text> : null}
              {review ? <Text style={[s.caption, { fontWeight: '600', color: colors.warningInk }]}>A change needs review</Text> : null}
            </View>
            <GroupBalance group={group} />
          </View>
        </Pressable>
        <Reveal toggle={leaveToggle} onOutsidePress={() => setLeaving(null)}>
          {leaving === group.group_id ? (
            <View style={{ gap: 10, paddingBottom: 18 }}>
              <Text style={s.body}>Leave {group.name} on this device? You can rejoin it later.</Text>
              <View style={s.actions}>
                <Button grow secondary disabled={action.busy} onPress={() => setLeaving(null)}>Cancel</Button>
                <Button grow disabled={action.busy || !state.online} onPress={() => { void leave(group); }}>Leave</Button>
              </View>
              {!state.online ? <Text style={s.caption}>You’re offline. Connect to leave.</Text> : null}
            </View>
          ) : null}
        </Reveal>
        {target === group.group_id ? <ErrorMessage message={action.error} /> : null}
      </View>
    );
  }

  function leftRow(group: ClientGroupSummary) {
    return (
      <View key={group.group_id}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rejoin ${group.name}`}
          disabled={action.busy}
          onPress={() => open(group)}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18 }, s.ruled, pressed && s.pressed]}
        >
          <Text numberOfLines={2} style={{ flex: 1, fontFamily, fontSize: 20, lineHeight: 25, fontWeight: '600', color: colors.faint }}>{group.name}</Text>
          <Text style={s.rowAction}>Rejoin</Text>
        </Pressable>
        {target === group.group_id ? <ErrorMessage message={action.error} /> : null}
      </View>
    );
  }

  return (
    <View>
      {active.length ? active.map(row) : <WelcomeView />}
      {left.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showLeft }}
          onPress={() => {
            void actions.dispatch('setLeftGroupsVisible', { visible: !showLeft }, { origin: 'ui' });
          }}
          style={({ pressed }) => [{ minHeight: 52, justifyContent: 'center' }, s.ruled, pressed && s.pressed]}
        >
          <Text style={[s.caption, s.link, { fontSize: 14 }]}>{`${showLeft ? 'Hide' : 'Show'} ${left.length === 1 ? '1 group' : `${left.length} groups`} you left`}</Text>
        </Pressable>
      ) : null}
      <Reveal>{showLeft && left.length ? <View>{left.map(leftRow)}</View> : null}</Reveal>
      <View style={s.ruled} />
    </View>
  );
}
