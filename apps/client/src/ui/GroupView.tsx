import { useContext, useEffect, useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { groupNameSchema, preferredMember, repaymentMembers } from '@splitnext/client';
import { BellIcon, Button, ChevronDownIcon, ChevronUpIcon, CountBadge, ErrorMessage, IconButton, Input, InviteIcon, PencilIcon, Row, SearchIcon, Stack, Tag, Text, TextButton, ToggleChip, Touchable, YouBadge, between, colors, balanceStyle, bleedRow, radii, RowRule, rules, sizes, strokes, titleStyle } from '../design';
import { attentionCount } from '../model/activity';
import { hasRecords } from '../model/breakdown';
import { balanceRows, currentExpenses, memberName, moneyLabel } from '../model/expenses';
import { balanceColor, signedFigure } from './balance';
import { ExpenseList } from './ExpenseList';
import { InviteSheet } from './InvitePanel';
import { AddPersonRow, MemberAvatar, type MemberListApp, type Replica } from './MemberList';
import { CompactHeaderContext, RevealContext, useCompactProgress } from './pageScroll';
import { StickyFoot } from './StickyFoot';
import { StickyTop } from './StickyTop';
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

/** The compact title's row: its one 18px line with room for descenders. */
const compactTitleRow = 28;

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
      <Row style={{ minHeight: draft === null ? between(sizes.touch, compactTitleRow, progress) : sizes.touch, height: fullTitleHeight && draft === null ? between(Math.max(sizes.touch, fullTitleHeight), compactTitleRow, progress) : undefined }}>
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

/** Invite people: beside Add a person, since adding names and sending them the link go together; it opens the link in a sheet. */
function InviteButton(props: { app: MemberListApp }) {
  const invite = useActionCall();
  const inviting = useUiState().view === 'invite';

  return (
    <>
      <Button
        size="compact"
        variant="secondary"
        label="Invite people"
        icon={<InviteIcon size={16} />}
        expanded={inviting}
        disabled={!invite.can('showInvite', {})}
        onPress={() => { void invite.call('showInvite', {}); }}
      >
        Invite
      </Button>
      {inviting ? <InviteSheet app={props.app} /> : null}
      <ErrorMessage message={invite.error} />
    </>
  );
}

/** Search stays beside the expense list that it filters. */
function SearchToggle() {
  const actions = useActions();
  const ui = useUiState();

  return (
    <IconButton
      label={ui.search.open ? 'Stop searching' : 'Search expenses'}
      aria-expanded={ui.search.open}
      onPress={() => { void actions.dispatch(ui.search.open ? 'closeExpenseSearch' : 'searchExpenses', {}, { origin: 'ui' }); }}
    >
      <SearchIcon size={18} />
    </IconButton>
  );
}

/** About how tall the search and its filters are, which the results' room leaves for them. */
const searchHeight = 100;

/** What to look for among the expenses, and the filters, which show only while searching. */
function SearchBar() {
  const actions = useActions();
  const search = useUiState().search;
  const run = (input: { query?: string; involvesYou?: boolean; paidByYou?: boolean }) => { void actions.dispatch('searchExpenses', input, { origin: 'ui' }); };

  return (
    <Stack gap={8} paddingBottom={8} style={{ backgroundColor: colors.background }}>
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
 * Your own row, first among the people: drawn like theirs, but tinted, a
 * little larger, with what your balance means under your name, and Settle up
 * beside it while a payment of the plan involves you. It opens your details.
 */
function YourRow(props: { replica: Replica }) {
  const open = useActionCall();
  const settle = useActionCall();
  const snapshot = props.replica.projected_snapshot;
  const you = preferredMember(snapshot, props.replica.session?.identity.id);

  if (!you || !snapshot) return null;
  const balances = balancesByMember(props.replica).get(you.id) ?? [];
  const name = memberName(snapshot, you.id);
  const recorded = hasRecords(snapshot, you.id);
  const amounts = balances.map((entry) => signedFigure(entry.amount, entry.currency));

  return (
    <View testID="your-balance">
      <View style={[bleedRow, { backgroundColor: colors.tint, paddingVertical: 10, gap: 4 }]}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`${name} (you), ${recorded ? amounts.join(', ') || 'settled' : 'no expenses yet'}. Show details`}
          disabled={!open.can('showPerson', { memberId: you.id })}
          onPress={() => { void open.call('showPerson', { memberId: you.id }); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.touch }}
        >
          <MemberAvatar replica={props.replica} memberId={you.id} />
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Row gap={8}>
              <Text ref={morph(`pname-${props.replica.group_id}-${you.id}`)} numberOfLines={1} variant="strong" style={{ flexShrink: 1 }}>{name}</Text>
              <YouBadge />
            </Row>
            <Text variant="caption" weight="semibold" tone="muted">{recorded ? yourStanding(balances[0]?.amount) : 'No expenses yet'}</Text>
          </Stack>
          {recorded ? (
            <Stack gap={4} align="end" style={{ flexShrink: 0 }}>
              {balances.map((entry) => (
                <Text key={entry.currency} ref={morph(`gamt-${props.replica.group_id}-${entry.currency}`, { unclipped: true })} accessibilityLabel={moneyLabel(Math.abs(entry.amount), entry.currency)} numberOfLines={1} color={balanceColor(entry.amount)} style={balanceStyle(22)}>
                  {signedFigure(entry.amount, entry.currency)}
                </Text>
              ))}
            </Stack>
          ) : null}
        </Touchable>
        {/* On its own line under your figure, so a narrow screen keeps your name whole. */}
        {settle.can('showSettleUp', { memberId: you.id }) ? (
          <Row justify="end">
            <Button size="compact" label="Settle up" onPress={() => { void settle.call('showSettleUp', {}); }}>
              Settle up
            </Button>
          </Row>
        ) : null}
      </View>
      <ErrorMessage message={open.error ?? settle.error} />
    </View>
  );
}

/** The group screen's fixed top: back to the groups and Activity, and the group's name. */
export function GroupHeader(props: { app: MemberListApp }) {
  const actions = useActions();
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const name = snapshot?.group.name ?? '';
  const open = Boolean(replica && !replica.hidden);

  return (
    <ScreenHeader
      start={<BackButton label="Back to groups" disabled={!actions.availability('showGroups', {}).available} onPress={() => { void actions.dispatch('showGroups', {}, { origin: 'ui' }); }} />}
      end={open ? <ActivityLink app={props.app} /> : undefined}
      heading={open && replica ? <GroupName name={name} groupId={replica.group_id} /> : undefined}
      compactTitle={open ? name : undefined}
      title={open ? undefined : name}
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
const fullRow = { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.touch + 6, paddingVertical: 6, ...bleedRow } as const;

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
        style={fullRow}
      >
        <RowRule />
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
      <YourRow replica={props.replica} />
      {open.map(row)}
      {square.length ? (
        <Touchable
          feedback="tint"
          accessibilityRole="button"
          accessibilityLabel={`${square.length} settled: ${square.map((member) => memberName(snapshot, member.id)).join(', ')}`}
          aria-expanded={ui.balancesExpanded}
          onPress={() => { void actions.dispatch('setBalancesExpanded', { expanded: !ui.balancesExpanded }, { origin: 'ui' }); }}
          style={fullRow}
        >
          <RowRule />
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
      <AddPersonRow end={<InviteButton app={props.app} />} tint={snapshot?.members.length ?? 0} />
    </View>
  );
}

/**
 * People and expenses share one page, each list in full, scrolled as one.
 * While the expenses are still below the screen, a floating button at the
 * foot jumps to them.
 */
export function GroupView(props: GroupViewProps) {
  const action = useActionCall();
  const searching = useUiState().search.open;
  const room = useContext(CompactHeaderContext).room;
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

  const entries = currentExpenses(snapshot).length + snapshot.settlements.filter((entry) => entry.status === 'active').length;

  return (
    // One parent from the top of the page, so the Expenses heading can float at the foot from anywhere above its place.
    <View>
      <View role="region" aria-label="Group people" style={{ marginBottom: 12 }}>
        <People app={props.app} replica={replica} />
      </View>
      <ExpensesHeading entries={entries} />
      {/* While searching, the results take at least a screen, so the search can always rise under the header. */}
      <View role="region" aria-label="Group expenses" style={{ minHeight: searching ? room - searchHeight : 0 }}>
        <ExpenseList replica={replica} />
      </View>
    </View>
  );
}

/** Where the expenses start, which the floating Expenses button scrolls to. */
const expensesAnchor = 'group-expenses';

/** How far before its place the floating button starts turning into the heading. */
const dockRange = 72;

/** A color part of the way from one #rrggbb color to another. */
function mix(from: string, to: string, part: number): string {
  const channel = (color: string, index: number) => parseInt(color.slice(1 + index * 2, 3 + index * 2), 16);
  const parts = [0, 1, 2].map((index) => Math.round(between(channel(from, index), channel(to, index), part)));

  return `rgb(${parts.join(', ')})`;
}

/** A #rrggbb color seen through, from clear (0) to solid (1), so nothing behind it is covered. */
function fade(color: string, part: number): string {
  return `${color}${Math.round(part * 255).toString(16).padStart(2, '0')}`;
}

/**
 * The Expenses heading. While its place is below the screen it floats at the
 * foot as a button that scrolls the expenses up under the compact header;
 * scrolled to, it turns into the heading in place, its count and search
 * coming in as the button's fill and arrow go.
 */
function ExpensesHeading(props: { entries: number }) {
  const reveal = useContext(RevealContext);
  const searching = useUiState().search.open;
  const inset = useContext(CompactHeaderContext).height;

  // Opening search brings it up under the header, with room for what it finds.
  useEffect(() => {
    if (searching) reveal?.(expensesAnchor);
  }, [searching]);

  // While searching, the search takes the heading's place and stays under the header.
  if (searching)
    return (
      <>
        <View nativeID={expensesAnchor} />
        <StickyTop top={inset} layer={3}>
          <SearchBar />
        </StickyTop>
      </>
    );

  return (
    <StickyFoot bottom={12} range={dockRange} anchorId={expensesAnchor} held={props.entries > 0}>
      {(docked) => {
        const floating = docked < 1;
        // It keeps its solid fill while it moves into place and loses it only
        // over the last stretch, so its text never sits on a half-faded grey.
        const plain = Math.max(0, docked - 0.6) / 0.4;

        return (
          <Row gap={0} pointerEvents="box-none" style={{ minHeight: sizes.touch, borderBottomWidth: strokes.hairline, borderColor: fade(colors.rule, docked) }}>
            {/* Equal room either side centers the button; the left room goes as it docks. */}
            <View pointerEvents="none" style={{ flexGrow: 1 - docked, flexBasis: 0 }} />
            <Touchable
              accessibilityRole={floating ? 'button' : 'none'}
              accessibilityLabel={floating ? `Show expenses, ${props.entries}` : undefined}
              disabled={!floating}
              onPress={() => reveal?.(expensesAnchor)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                height: 36,
                paddingHorizontal: between(14, 0, docked),
                borderRadius: radii.round,
                backgroundColor: floating ? `rgba(20, 20, 19, ${1 - plain})` : 'transparent',
                boxShadow: floating ? `0 2px 8px rgba(20, 20, 19, ${0.18 * (1 - plain)})` : 'none',
              }}
            >
              <Text accessibilityRole="header" aria-level={2} variant="strong" color={mix(colors.background, colors.ink, plain)}>Expenses</Text>
              <Text variant="body" color={mix(colors.background, colors.muted, plain)}>{props.entries}</Text>
              {floating ? (
                <View style={{ width: between(16, 0, docked), marginLeft: between(-2, -8, docked), opacity: 1 - docked, overflow: 'hidden' }}>
                  <ChevronDownIcon size={16} color={colors.background} />
                </View>
              ) : null}
            </Touchable>
            <View pointerEvents="none" style={{ flexGrow: 1, flexBasis: 0 }} />
            {props.entries ? (
              <View pointerEvents={floating ? 'none' : 'auto'} aria-hidden={floating} style={{ width: between(0, sizes.touch, docked), opacity: docked, overflow: 'hidden', alignItems: 'flex-end' }}>
                <SearchToggle />
              </View>
            ) : null}
          </Row>
        );
      }}
    </StickyFoot>
  );
}
