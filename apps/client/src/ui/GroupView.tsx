import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { groupNameSchema, memberHasRecords, preferredMember, repaymentMembers } from '@splitnext/client';
import { attentionCount } from '../model/activity';
import { hasRecords } from '../model/breakdown';
import { balanceRows, memberName, moneyLabel } from '../model/expenses';
import { participantMarkers } from '../model/memberPresentation';
import { BackButton, BalanceBar, Button, ErrorMessage, ScreenHeader, balanceColor, colors, s, signedFigure, titleStyle } from './components';
import { ExpenseList } from './ExpenseList';
import { BellIcon, CloseIcon, PencilIcon } from './icons';
import { InvitePanel } from './InvitePanel';
import { AddPersonRow, MemberIcon, type MemberListApp, type Replica } from './MemberList';
import { between, useCompactProgress } from './pageScroll';
import { Reveal } from './Reveal';
import { EditCover } from './EditCover';
import { TitleField } from './TitleField';
import { morph } from './ScreenMorph';
import { fontFamily } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';
import { YouBadge } from './YouBadge';

type GroupViewProps = { app: MemberListApp };

/** Activity, with a count of new changes from others and changes to review; on the group and a person's page. */
export function ActivityLink(props: { app: MemberListApp }) {
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
      <BellIcon size={22} />
      {/* The count sits on the bell's shoulder. */}
      {count ? (
        <View aria-hidden style={{ position: 'absolute', top: 4, left: 23, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 2, borderColor: colors.background, backgroundColor: colors.alert }}>
          <Text testID="activity-count" style={{ fontFamily, fontSize: 10, lineHeight: 12, fontWeight: '700', color: '#ffffff' }}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** The group's name, large; the pencil turns it into a field that saves on leaving it. */
function GroupName(props: { name: string; groupId: string }) {
  const progress = useCompactProgress();
  const rename = useActionCall();
  const [draft, setDraft] = useState<string | null>(null);
  // A saved name shows until the group's own catches up, so the old one never flashes back.
  const [saved, setSaved] = useState<{ from: string; to: string } | null>(null);
  const [fullTitleHeight, setFullTitleHeight] = useState(0);
  const input = useRef<TextInput>(null);

  if (saved && saved.from !== props.name) setSaved(null);

  const name = saved?.to ?? props.name;

  function save(): void {
    const next = draft?.trim() ?? '';

    setDraft(null);

    if (next && next !== props.name && groupNameSchema.safeParse(next).success) {
      let done = false;

      setSaved({ from: props.name, to: next });
      void rename
        .call('renameGroup', { name: next, expectedName: props.name }, () => { done = true; })
        .finally(() => { if (!done) setSaved(null); });
    }
  }

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {/* While editing, the field sets the height, growing as the name wraps. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, height: fullTitleHeight && draft === null ? between(Math.max(44, fullTitleHeight), 44, progress) : undefined }}>
        {/* Measure the expanded title independently of wrapping during collapse.
            Its second line releases space continuously rather than all at once. */}
        <Text aria-hidden pointerEvents="none" numberOfLines={2} onLayout={(event) => setFullTitleHeight(event.nativeEvent.layout.height)} style={[titleStyle(0), { position: 'absolute', left: 0, right: 34, top: 0, opacity: 0 }]}>{name}</Text>
        {draft === null ? (
          <>
            <Text ref={morph(`gname-${props.groupId}`)} accessibilityRole="header" numberOfLines={2} style={[titleStyle(progress), { flexShrink: 1, alignSelf: 'flex-start' }]}>{name}</Text>
            {progress <= 0.5 ? <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rename group"
              disabled={!rename.can('renameGroup', { name })}
              onPress={() => setDraft(name)}
              style={({ pressed }) => [{ marginLeft: 'auto', marginRight: -10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: Math.max(0, 1 - 2 * progress) }, pressed && s.pressed, !rename.can('renameGroup', { name }) && s.dim]}
            >
              <PencilIcon size={18} color={colors.ink} />
            </Pressable> : null}
          </>
        ) : (
          <TitleField
            inputRef={input}
            accessibilityLabel="Group name"
            value={draft}
            onChangeText={setDraft}
            maxLength={100}
            onBlur={save}
            onEscape={() => setDraft(null)}
            // The pencil's share of the row: 44 wide, 10 of it past the edge.
            inset={34}
            style={{ ...titleStyle(progress), paddingBottom: 4, borderBottomWidth: 1.5, borderColor: colors.ink }}
          />
        )}
      </View>
      <EditCover open={draft !== null} target={input} onPress={() => input.current?.blur()} />
      <ErrorMessage message={rename.error} />
    </View>
  );
}

/**
 * The group screen's fixed top: back to the groups and Activity, the group's
 * name, and how many people with Invite people, which opens the link in place.
 */
export function GroupHeader(props: { app: MemberListApp }) {
  const actions = useActions();
  const progress = useCompactProgress();
  const invite = useActionCall();
  const inviteToggle = useRef<View>(null);
  const ui = useUiState();
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const name = snapshot?.group.name ?? '';
  const open = Boolean(replica && !replica.hidden);
  const inviting = ui.view === 'invite';
  const people = (snapshot?.members ?? []).filter((member) => member.status === 'active').length;

  return (
    <ScreenHeader
      start={<BackButton label="Back to groups" disabled={!actions.availability('showGroups', {}).available} onPress={() => { void actions.dispatch('showGroups', {}, { origin: 'ui' }); }} />}
      end={open ? <ActivityLink app={props.app} /> : undefined}
      heading={open && replica ? <GroupName name={name} groupId={replica.group_id} /> : undefined}
      title={open ? undefined : name}
      below={open ? (
        <View>
          {/* Folds away as the page scrolls, for more room, unless the invite is open under it. */}
          {/* Mostly folded, it is out of reach rather than a sliver under the title. */}
          <View aria-hidden={!inviting && progress > 0.5} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, height: inviting ? 44 : between(44, 0, progress), opacity: inviting ? 1 : 1 - progress, overflow: 'hidden', pointerEvents: !inviting && progress > 0.5 ? 'none' : 'auto' }}>
            <Text style={[s.caption, { fontSize: 14 }]}>{people === 1 ? '1 person' : `${people} people`}</Text>
            <Pressable
              ref={inviteToggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: inviting }}
              disabled={!invite.can(inviting ? 'closePanel' : 'showInvite', {})}
              onPress={() => { void invite.call(inviting ? 'closePanel' : 'showInvite', {}); }}
              style={({ pressed }) => [{ height: 44, justifyContent: 'center', paddingHorizontal: 12, marginLeft: -12 }, pressed && s.pressed]}
            >
              <Text style={[s.headerActionText, s.link, { fontSize: 14, fontWeight: '400' }]}>Invite people</Text>
            </Pressable>
          </View>
          <Reveal
            toggle={inviteToggle}
            // A tap elsewhere may open another view; it acts first, and the
            // link closes only if it is still the view after that.
            onOutsidePress={() => setTimeout(() => {
              if (actions.ui.snapshot().view === 'invite') void actions.dispatch('closePanel', {}, { origin: 'ui' });
            }, 0)}
          >
            {inviting ? <InvitePanel app={props.app} /> : null}
          </Reveal>
          <ErrorMessage message={invite.error} />
        </View>
      ) : undefined}
    />
  );
}

/** Balances in each person's recorded currencies, including settled zeros. */
function balancesByMember(replica: Replica): Map<string, { currency: string; amount: number }[]> {
  const result = new Map<string, { currency: string; amount: number }[]>();

  for (const { currency, rows } of balanceRows(replica.projected_snapshot))
    for (const { member, amount } of rows)
      result.set(member.id, [...(result.get(member.id) ?? []), { currency, amount }]);

  return result;
}

/**
 * You first, then everyone from most negative to most positive balance:
 * people who owe on top, then settled people, then those owed most, and last
 * the people in no expense or repayment yet. Ties keep the order people were
 * added.
 */
function orderedMembers<Member extends { id: string }>(members: readonly Member[], owing: Map<string, { amount: number }[]>, you: string | undefined, recorded: (memberId: string) => boolean): Member[] {
  const balance = (memberId: string) => {
    const amounts = (owing.get(memberId) ?? []).map((entry) => entry.amount);

    return Math.min(...amounts, 0) || Math.max(...amounts, 0);
  };

  return members.toSorted((left, right) =>
    Number(right.id === you) - Number(left.id === you) ||
    Number(recorded(right.id)) - Number(recorded(left.id)) ||
    balance(left.id) - balance(right.id));
}

/**
 * One person: presence, name, their balance as a bar, and the figure, in a
 * column as wide as the group's widest figure so every bar's centre lines up.
 */
function PersonRow(props: { app: MemberListApp; replica: Replica; memberId: string; removed: boolean; you: boolean; balances: { currency: string; amount: number }[]; recorded: boolean; max: number; figureWidth: number }) {
  const open = useActionCall();
  const remove = useActionCall();
  // As in their details: only someone no expense or repayment has named, removed ones included.
  const snapshot = props.replica.projected_snapshot;
  // You never take yourself out from your own row.
  const removable = !props.you && !props.removed && snapshot !== null && !memberHasRecords(snapshot, props.memberId);
  const name = memberName(props.replica.projected_snapshot, props.memberId);
  const state = props.app.snapshot();
  const participants = participantMarkers(props.replica, props.memberId, props.app.client.presence(props.replica.group_id), state.online && state.reachable);
  const amounts = props.balances.map((entry) => signedFigure(entry.amount, entry.currency));
  const first = props.balances[0]?.amount ?? 0;
  const currency = props.balances[0]?.currency;
  // The bar flies to the person's page, and yours also to the groups list.
  const bar = currency ? (props.you ? `gbar-${props.replica.group_id}-${currency}` : `pbar-${props.replica.group_id}-${props.memberId}-${currency}`) : null;

  return (
    <View>
      <View style={[{ flexDirection: 'row', alignItems: 'stretch', marginHorizontal: -24 }, s.ruled, props.you && { backgroundColor: colors.youRow }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}${props.you ? ' (you)' : ''}${props.removed ? ', removed' : ''}, ${amounts.join(', ') || (props.recorded ? 'settled' : 'no expenses yet')}. Show details`}
        disabled={!open.can('showPerson', { memberId: props.memberId })}
        onPress={() => { void open.call('showPerson', { memberId: props.memberId }); }}
        style={({ pressed }) => [{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 24, paddingRight: removable ? 0 : 24, gap: 8 }, pressed && s.rowPressed]}
      >
        <View style={{ width: '34%', flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <MemberIcon participants={participants} size={6} />
          <Text ref={morph(`pname-${props.replica.group_id}-${props.memberId}`)} numberOfLines={2} style={[s.name, { flexShrink: 1, lineHeight: 20 }]}>{name}</Text>
          {props.you ? <YouBadge /> : null}
          {props.removed ? <Text style={s.tag}>removed</Text> : null}
        </View>
        <View style={{ flex: 1, alignSelf: 'stretch' }}>
          {props.recorded ? <BalanceBar amount={first} max={props.max} morph={bar} /> : null}
        </View>
        <View style={{ width: props.figureWidth, alignItems: 'flex-end', gap: 6 }}>
          {props.balances.length ? props.balances.map((entry) => (
            <Text key={entry.currency} ref={morph(props.you ? `gamt-${props.replica.group_id}-${entry.currency}` : `pamt-${props.replica.group_id}-${props.memberId}-${entry.currency}`, { unclipped: true })} accessibilityLabel={moneyLabel(Math.abs(entry.amount), entry.currency)} numberOfLines={1} style={[s.amount, { color: balanceColor(entry.amount) }]}>
              {signedFigure(entry.amount, entry.currency)}
            </Text>
          )) : null}
        </View>
      </Pressable>
      {/* Someone no expense or repayment has named can go straight from here. */}
      {removable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          disabled={!remove.can('removeMember', { memberId: props.memberId })}
          onPress={() => { void remove.call('removeMember', { memberId: props.memberId }); }}
          style={({ pressed }) => [{ width: 44, marginRight: 10, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, !remove.can('removeMember', { memberId: props.memberId }) && s.dim]}
        >
          <CloseIcon size={16} color={colors.muted} />
        </Pressable>
      ) : null}
      </View>
      <ErrorMessage message={open.error ?? remove.error} />
    </View>
  );
}

/** Everyone in the group with their balance, and a last row to add a person. */
function People(props: { app: MemberListApp; replica: Replica }) {
  const snapshot = props.replica.projected_snapshot;
  const you = preferredMember(snapshot, props.replica.session?.identity.id);
  const owing = balancesByMember(props.replica);
  const recorded = (memberId: string) => hasRecords(snapshot, memberId);
  // Removed people stay while they owe or are owed.
  const members = orderedMembers(repaymentMembers(snapshot), owing, you?.id, recorded);
  const max = Math.max(0, ...[...owing.values()].map((entries) => Math.abs(entries[0]?.amount ?? 0)));
  // A monospaced figure takes about 0.6 of its 15px size per character.
  const longest = Math.max(0, ...[...owing.values()].flatMap((entries) => entries.map((entry) => signedFigure(entry.amount, entry.currency).length)));
  const figureWidth = Math.max(84, Math.ceil(longest * 9.2));

  return (
    <View role="region" aria-label="Balances">
      {members.map((member) => (
        <PersonRow
          key={member.id}
          app={props.app}
          replica={props.replica}
          memberId={member.id}
          removed={member.status !== 'active'}
          you={member.id === you?.id}
          balances={owing.get(member.id) ?? []}
          recorded={recorded(member.id)}
          figureWidth={figureWidth}
          max={max}
        />
      ))}
      <AddPersonRow />
    </View>
  );
}

/**
 * The group screen's content, one scrolling page: everyone's balance, then
 * expenses and repayments; or rejoining a group left here.
 */
export function GroupView(props: GroupViewProps) {
  const action = useActionCall();
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
    <View style={{ gap: 28 }}>
      <People app={props.app} replica={replica} />
      <ExpenseList replica={replica} />
    </View>
  );
}
