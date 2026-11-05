import { useRef, useState, type RefObject } from 'react';
import { View, type TextInput } from 'react-native';
import { groupNameSchema, preferredMember, repaymentMembers } from '@splitnext/client';
import { BellIcon, Button, ChevronDownIcon, ChevronUpIcon, CountBadge, ErrorMessage, IconButton, Input, InviteIcon, PencilIcon, Row, SearchIcon, Stack, Tabs, Tag, Text, TextButton, ToggleChip, Touchable, YouBadge, between, colors, balanceStyle, layout, radii, rules, sizes, titleStyle } from '../design';
import { attentionCount } from '../model/activity';
import { hasRecords } from '../model/breakdown';
import { balanceRows, currentExpenses, memberName, moneyLabel } from '../model/expenses';
import { balanceColor, signedFigure } from './balance';
import { ExpenseList } from './ExpenseList';
import { InvitePanel } from './InvitePanel';
import { AddPersonRow, MemberAvatar, type MemberListApp, type Replica } from './MemberList';
import { useCompactProgress } from './pageScroll';
import { Reveal } from './Reveal';
import { EditCover } from './EditCover';
import { ScreenHeader, BackButton } from './ScreenHeader';
import { TitleField } from './TitleField';
import { morph } from './ScreenMorph';
import { useActionCall, useActions, useUiState } from './useActionCall';

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
    <IconButton label={label} disabled={!open.can('showActivity')} onPress={() => { void open.call('showActivity', {}); }}>
      <BellIcon size={22} />
      {/* The count sits on the bell's shoulder. */}
      {count ? (
        <View style={{ position: 'absolute', top: 4, left: 23 }}>
          <CountBadge testID="activity-count" count={count} />
        </View>
      ) : null}
    </IconButton>
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
      <Row style={{ minHeight: sizes.touch, height: fullTitleHeight && draft === null ? between(Math.max(sizes.touch, fullTitleHeight), sizes.touch, progress) : undefined }}>
        {/* Measure the expanded title independently of wrapping during collapse.
            Its second line releases space continuously rather than all at once. */}
        <Text aria-hidden pointerEvents="none" numberOfLines={2} onLayout={(event) => setFullTitleHeight(event.nativeEvent.layout.height)} style={[titleStyle(0), { position: 'absolute', left: 0, right: 34, top: 0, opacity: 0 }]}>{name}</Text>
        {draft === null ? (
          <>
            <Text ref={morph(`gname-${props.groupId}`)} accessibilityRole="header" numberOfLines={2} style={[titleStyle(progress), { flexShrink: 1, alignSelf: 'flex-start' }]}>{name}</Text>
            {progress <= 0.5 ? (
              <IconButton label="Rename group" disabled={!rename.can('renameGroup', { name })} onPress={() => setDraft(name)} style={{ marginLeft: 'auto', marginRight: -10, opacity: Math.max(0, 1 - 2 * progress) }}>
                <PencilIcon size={18} />
              </IconButton>
            ) : null}
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
            style={{ ...titleStyle(progress), paddingBottom: 4, ...rules.inkBelow }}
          />
        )}
      </Row>
      <EditCover open={draft !== null} target={input} onPress={() => input.current?.blur()} />
      <ErrorMessage message={rename.error} />
    </View>
  );
}

/** Invite people: an icon at the header's end that opens the invite link under the title. */
function InviteToggle(props: { toggle: RefObject<View | null> }) {
  const invite = useActionCall();
  const inviting = useUiState().view === 'invite';

  return (
    <IconButton
      ref={props.toggle}
      label="Invite people"
      aria-expanded={inviting}
      disabled={!invite.can(inviting ? 'closePanel' : 'showInvite', {})}
      onPress={() => { void invite.call(inviting ? 'closePanel' : 'showInvite', {}); }}
    >
      <InviteIcon size={22} />
    </IconButton>
  );
}

/** Search, at the header's end while the expenses show: it opens a field under the tabs. */
function SearchToggle() {
  const actions = useActions();
  const ui = useUiState();

  if (ui.groupTab !== 'expenses') return null;

  return (
    <IconButton
      label={ui.search.open ? 'Stop searching' : 'Search expenses'}
      aria-expanded={ui.search.open}
      onPress={() => { void actions.dispatch(ui.search.open ? 'closeExpenseSearch' : 'searchExpenses', {}, { origin: 'ui' }); }}
    >
      <SearchIcon size={22} />
    </IconButton>
  );
}

/** What to look for among the expenses, and the filters, which show only while searching. */
function SearchBar() {
  const actions = useActions();
  const search = useUiState().search;
  const run = (input: { query?: string; involvesYou?: boolean; paidByYou?: boolean }) => { void actions.dispatch('searchExpenses', input, { origin: 'ui' }); };

  return (
    <Stack gap={8} paddingTop={12}>
      <Row gap={8} style={{ minHeight: sizes.touch, ...rules.inkBelow }}>
        <SearchIcon size={18} color={colors.muted} />
        <Input
          accessibilityLabel="Search expenses"
          placeholder="Search expenses"
          autoFocus
          value={search.query}
          onChangeText={(query) => run({ query })}
          maxLength={100}
          returnKeyType="search"
          style={{ flex: 1, minWidth: 0, height: sizes.touch, paddingHorizontal: 0 }}
        />
        <TextButton underline={false} tone="muted" onPress={() => { void actions.dispatch('closeExpenseSearch', {}, { origin: 'ui' }); }} style={{ paddingLeft: 12 }}>Cancel</TextButton>
      </Row>
      <Row gap={8}>
        <ToggleChip text="Involves you" selected={search.involvesYou} onPress={() => run({ involvesYou: !search.involvesYou })} />
        <ToggleChip text="Paid by you" selected={search.paidByYou} onPress={() => run({ paidByYou: !search.paidByYou })} />
      </Row>
    </Stack>
  );
}

/** What a balance means for you, as the line above its figure. */
function yourStanding(amount: number | undefined): string {
  if (!amount) return 'You’re settled';

  return amount < 0 ? 'You owe' : 'You get back';
}

/**
 * Where you stand, first on the group: what you owe or get back, large, with
 * Settle up beside it while a payment of the plan involves you. Tapping the
 * figure opens your details. It folds away as the page scrolls.
 */
function YourBalance(props: { replica: Replica }) {
  const progress = useCompactProgress();
  const open = useActionCall();
  const settle = useActionCall();
  const snapshot = props.replica.projected_snapshot;
  const you = preferredMember(snapshot, props.replica.session?.identity.id);

  if (!you || !snapshot) return null;
  const balances = balancesByMember(props.replica).get(you.id) ?? [];
  const name = memberName(snapshot, you.id);
  const amounts = balances.map((entry) => signedFigure(entry.amount, entry.currency));
  const folded = progress > 0.5;

  // Until an expense names you, a quiet line still opens your details, such as to rename yourself.
  if (!hasRecords(snapshot, you.id))
    return (
      <View aria-hidden={folded} style={{ height: between(sizes.touch, 0, progress), opacity: 1 - progress, overflow: 'hidden', pointerEvents: folded ? 'none' : 'auto' }}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`${name} (you), no expenses yet. Show details`}
          disabled={!open.can('showPerson', { memberId: you.id })}
          onPress={() => { void open.call('showPerson', { memberId: you.id }); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: sizes.touch }}
        >
          <MemberAvatar replica={props.replica} memberId={you.id} size="small" />
          <Text variant="body" weight="semibold" numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>{name}</Text>
          <YouBadge />
        </Touchable>
        <ErrorMessage message={open.error} />
      </View>
    );

  return (
    <View aria-hidden={folded} style={{ height: between(balances.length > 1 ? 120 : 78, 0, progress), opacity: 1 - progress, overflow: 'hidden', pointerEvents: folded ? 'none' : 'auto' }}>
      <Row gap={12} align="end" style={{ paddingTop: 8 }}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`${name} (you), ${amounts.join(', ') || 'settled'}. Show details`}
          disabled={!open.can('showPerson', { memberId: you.id })}
          onPress={() => { void open.call('showPerson', { memberId: you.id }); }}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Text variant="caption" weight="semibold" tone="muted">{yourStanding(balances[0]?.amount)}</Text>
          {balances.map((entry) => (
            <Text key={entry.currency} ref={morph(`gamt-${props.replica.group_id}-${entry.currency}`, { unclipped: true })} accessibilityLabel={moneyLabel(Math.abs(entry.amount), entry.currency)} numberOfLines={1} color={balanceColor(entry.amount)} style={balanceStyle(36)}>
              {moneyLabel(Math.abs(entry.amount), entry.currency)}
            </Text>
          ))}
        </Touchable>
        {settle.can('showSettleUp', { memberId: you.id }) ? (
          <Button size="compact" label="Settle up" onPress={() => { void settle.call('showSettleUp', {}); }} style={{ marginBottom: 2 }}>
            Settle up
          </Button>
        ) : null}
      </Row>
      <ErrorMessage message={open.error ?? settle.error} />
    </View>
  );
}

/**
 * The group screen's fixed top: back to the groups, Invite people and
 * Activity, the group's name, where you stand, and the People and Expenses
 * tabs. Invite people opens the link in place under the name.
 */
export function GroupHeader(props: { app: MemberListApp }) {
  const actions = useActions();
  const inviteToggle = useRef<View>(null);
  const ui = useUiState();
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const name = snapshot?.group.name ?? '';
  const open = Boolean(replica && !replica.hidden);
  const inviting = ui.view === 'invite';
  const people = repaymentMembers(snapshot).length;
  const entries = currentExpenses(snapshot).length + (snapshot?.settlements ?? []).filter((entry) => entry.status === 'active').length;

  return (
    <ScreenHeader
      start={<BackButton label="Back to groups" disabled={!actions.availability('showGroups', {}).available} onPress={() => { void actions.dispatch('showGroups', {}, { origin: 'ui' }); }} />}
      end={open ? <><SearchToggle /><InviteToggle toggle={inviteToggle} /><ActivityLink app={props.app} /></> : undefined}
      heading={open && replica ? <GroupName name={name} groupId={replica.group_id} /> : undefined}
      title={open ? undefined : name}
      flush={open}
      below={open && replica ? (
        <View>
          <Reveal
            toggle={inviteToggle}
            // A tap elsewhere may open another view; it acts first, and the
            // link closes only if it is still the view after that.
            onOutsidePress={() => setTimeout(() => {
              if (actions.ui.snapshot().view === 'invite') void actions.dispatch('closePanel', {}, { origin: 'ui' });
            }, 0)}
          >
            {inviting ? <View style={{ paddingTop: 8 }}><InvitePanel app={props.app} /></View> : null}
          </Reveal>
          <YourBalance replica={replica} />
          <Tabs
            label="Group"
            value={ui.groupTab}
            onChange={(tab) => { void actions.dispatch('showGroupTab', { tab }, { origin: 'ui' }); }}
            options={[{ value: 'people', text: 'People', count: people }, { value: 'expenses', text: 'Expenses', count: entries }]}
            style={{ marginTop: 8, marginHorizontal: -layout.gutter, paddingHorizontal: layout.gutter }}
          />
          {ui.groupTab === 'expenses' && ui.search.open ? <SearchBar /> : null}
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
 * Everyone from most negative to most positive balance: people who owe on
 * top, then settled people, then those owed most, and last the people in no
 * expense or repayment yet. Ties keep the order people were added.
 */
function orderedMembers<Member extends { id: string }>(members: readonly Member[], owing: Map<string, { amount: number }[]>, recorded: (memberId: string) => boolean): Member[] {
  const balance = (memberId: string) => {
    const amounts = (owing.get(memberId) ?? []).map((entry) => entry.amount);

    return Math.min(...amounts, 0) || Math.max(...amounts, 0);
  };

  return members.toSorted((left, right) =>
    Number(recorded(right.id)) - Number(recorded(left.id)) ||
    balance(left.id) - balance(right.id));
}

/** A row running to the column's edges, so its pressed tint does too. */
const fullRow = { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.touch + 6, paddingVertical: 6, marginHorizontal: -layout.gutter, paddingHorizontal: layout.gutter } as const;

/** One person: their avatar, their name, and their balance, which opens their details. */
function PersonRow(props: { app: MemberListApp; replica: Replica; memberId: string; removed: boolean; balances: { currency: string; amount: number }[]; recorded: boolean }) {
  const open = useActionCall();
  const name = memberName(props.replica.projected_snapshot, props.memberId);
  const amounts = props.balances.map((entry) => signedFigure(entry.amount, entry.currency));

  return (
    <View>
      <Touchable
        feedback="tint"
        accessibilityRole="button"
        accessibilityLabel={`${name}${props.removed ? ', removed' : ''}, ${amounts.join(', ') || (props.recorded ? 'settled' : 'no expenses yet')}. Show details`}
        disabled={!open.can('showPerson', { memberId: props.memberId })}
        onPress={() => { void open.call('showPerson', { memberId: props.memberId }); }}
        style={[fullRow, rules.above]}
      >
        <MemberAvatar replica={props.replica} memberId={props.memberId} app={props.app} />
        <Row gap={8} fill>
          <Text ref={morph(`pname-${props.replica.group_id}-${props.memberId}`)} numberOfLines={2} variant="strong" style={{ flexShrink: 1 }}>{name}</Text>
          {props.removed ? <Tag>removed</Tag> : null}
        </Row>
        <Stack gap={4} align="end" style={{ flexShrink: 0 }}>
          {props.balances.map((entry) => (
            <Text key={entry.currency} ref={morph(`pamt-${props.replica.group_id}-${props.memberId}-${entry.currency}`, { unclipped: true })} accessibilityLabel={moneyLabel(Math.abs(entry.amount), entry.currency)} numberOfLines={1} variant="figure" color={balanceColor(entry.amount)}>
              {signedFigure(entry.amount, entry.currency)}
            </Text>
          ))}
        </Stack>
      </Touchable>
      <ErrorMessage message={open.error} />
    </View>
  );
}

/**
 * Everyone else with their balance, then the people who are settled folded
 * into one line that shows them, and a last row to add a person.
 */
function People(props: { app: MemberListApp; replica: Replica }) {
  const actions = useActions();
  const ui = useUiState();
  const snapshot = props.replica.projected_snapshot;
  const you = preferredMember(snapshot, props.replica.session?.identity.id);
  const owing = balancesByMember(props.replica);
  const recorded = (memberId: string) => hasRecords(snapshot, memberId);
  // Removed people stay while they owe or are owed.
  const members = orderedMembers(repaymentMembers(snapshot).filter((member) => member.id !== you?.id), owing, recorded);
  const settled = (memberId: string) => recorded(memberId) && (owing.get(memberId) ?? []).every((entry) => entry.amount === 0);
  const open = members.filter((member) => !settled(member.id));
  const square = members.filter((member) => settled(member.id));

  const row =(member: (typeof members)[number]) => (
    <PersonRow key={member.id} app={props.app} replica={props.replica} memberId={member.id} removed={member.status !== 'active'} balances={owing.get(member.id) ?? []} recorded={recorded(member.id)} />
  );

  return (
    <View role="region" aria-label="Balances">
      {open.map(row)}
      {square.length ? (
        <Touchable
          feedback="tint"
          accessibilityRole="button"
          accessibilityLabel={`${square.length} settled: ${square.map((member) => memberName(snapshot, member.id)).join(', ')}`}
          aria-expanded={ui.balancesExpanded}
          onPress={() => { void actions.dispatch('setBalancesExpanded', { expanded: !ui.balancesExpanded }, { origin: 'ui' }); }}
          style={[fullRow, rules.above]}
        >
          <Row style={{ minWidth: 30 }}>
            {square.slice(0, 3).map((member, index) => (
              <View key={member.id} style={{ marginLeft: index ? -8 : 0, borderRadius: radii.round, borderWidth: 2, borderColor: colors.background }}>
                <MemberAvatar replica={props.replica} memberId={member.id} size="small" />
              </View>
            ))}
          </Row>
          <Text variant="body" weight="semibold" tone="muted" style={{ flex: 1 }}>{square.length} settled</Text>
          {ui.balancesExpanded ? <ChevronUpIcon size={16} color={colors.faint} /> : <ChevronDownIcon size={16} color={colors.faint} />}
        </Touchable>
      ) : null}
      {ui.balancesExpanded ? square.map(row) : null}
      <AddPersonRow />
    </View>
  );
}

/**
 * The group screen's content under its tabs: everyone's balance, or the
 * expenses and repayments; or rejoining a group left here.
 */
export function GroupView(props: GroupViewProps) {
  const action = useActionCall();
  const ui = useUiState();
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;

  if (!snapshot || !replica) return null;

  if (replica.hidden)
    return (
      <Stack gap={12} paddingY={12} style={rules.inkAbove}>
        <Text variant="body">You left this group.</Text>
        <Button disabled={!action.can('showRejoin')} onPress={() => { void action.call('showRejoin', {}); }}>
          Rejoin group
        </Button>
        <ErrorMessage message={action.error} />
      </Stack>
    );

  return ui.groupTab === 'expenses' ? <ExpenseList replica={replica} /> : <People app={props.app} replica={replica} />;
}
