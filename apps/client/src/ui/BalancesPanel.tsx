import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { preferredMember, repaymentMembers } from '@splitnext/client';
import { hasRecords } from '../model/breakdown';
import { balanceRows, memberName, moneyLabel } from '../model/expenses';
import { participantMarkers } from '../model/memberPresentation';
import { createValueStore } from './pageScroll';
import { ErrorMessage, colors, headerGap, s } from './components';
import { SectionHeading, listRow, rowCaption, signedMoney } from './ExpenseList';
import { AddPersonRow, MemberIcon, type MemberListApp, type Replica } from './MemberList';
import { AnimatedHeight, usePrefersReducedMotion } from './AnimatedHeight';
import { PlusIcon } from './icons';
import { StickyTop } from './StickyTop';
import { fontFamily, monoFamily } from './theme';
import { useActionCall, useUiState } from './useActionCall';
import { YouBadge } from './YouBadge';

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
 * the people in no expense or repayment yet. Someone who owes in any currency
 * sorts by that debt. Amounts in different currencies are compared as
 * written, since they are never converted; ties keep the order people were
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
 * Space between the card and the expenses. Pinned alone, the heading keeps
 * only its own space below it, the same it keeps above the card, so the
 * expenses slide under it where the card rests.
 */
const padBottom = 12;

/** Room the default level leaves below it: the Expenses heading, two expenses, and the floating Add expense button. */
const expensesRoom = 32 + 2 * 52 + 76;

/**
 * The floating “···” button that shows everyone, or fewer again. It sits on
 * the card's bottom edge, half over the last person and half below the card.
 */
const moreHeight = 24;

/**
 * The section's measured parts: the Balances heading's height, the bottom of
 * each person's row within the list, and the Add a person line's height, the
 * last one it showed, or 0 before it has shown.
 */
type Geometry = { heading: number; rows: number[]; footer: number };

/**
 * The default level: how many people show at the top of the page (`shown`,
 * the rest behind the “···” button), the list's and card's heights, the empty
 * base below the card, and the section's full and smallest heights. The Add a
 * person line ends the card only when everyone shows.
 */
type Plan = { shown: number; truncated: boolean; list: number; card: number; base: number; full: number; minimal: number };

function planFor(geometry: Geometry, viewport: number): Plan {
  const room = viewport - expensesRoom - padBottom - geometry.heading;
  const everyone = geometry.rows.at(-1) ?? 0;
  const truncated = everyone + geometry.footer > room;
  // Truncated, at least one person waits behind the button, whose lower half needs room below the card.
  const fitting = geometry.rows.filter((bottom) => bottom + moreHeight / 2 <= room).length;
  const shown = truncated ? Math.max(1, Math.min(geometry.rows.length - 1, fitting)) : geometry.rows.length;
  const list = truncated ? (geometry.rows[shown - 1] ?? 0) : everyone;
  const card = truncated ? list : list + geometry.footer;
  // The card ends at a whole person; the base keeps the rest of the room, so the expenses start in the same place.
  const base = truncated ? Math.max(moreHeight / 2, room - list) : 0;
  const minimal = geometry.heading;

  return { shown, truncated, list, card, base, full: minimal + card + padBottom + base, minimal };
}

/**
 * The section's height at one scroll position: it shrinks with the scroll so
 * the expenses stay right below it, cutting the card from the bottom until
 * only the Balances heading is left, pinned at the top.
 */
function heightAt(plan: Plan, scrolled: number): number {
  return Math.min(plan.full, Math.max(plan.minimal, plan.full - scrolled));
}

/**
 * Shared by the group screen's header, page, and scroll handler: the page's
 * scroll position and a way to scroll it, the room held at the page's end,
 * the section's measurements, and its default level.
 */
export function useBalancesLayout() {
  const { height } = useWindowDimensions();
  const [header, setHeader] = useState(0);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  // Web layout events report size changes, not moves, so rows are measured by
  // height per person and stacked in the list's current order.
  const measured = useRef({ heading: 0, footer: 0, order: new Array<string>(), heights: new Map<string, number>() });
  const scroll = useMemo(createValueStore, []);
  const hold = useMemo(createValueStore, []);
  const scrollControl = useRef<((y: number, animated?: boolean) => void) | null>(null);

  function update(): void {
    const { heading, footer, order, heights } = measured.current;
    let bottom = 0;
    const rows = order.map((memberId) => (bottom += heights.get(memberId) ?? Number.NaN));

    if (heading && rows.length && rows.every(Number.isFinite)) {
      const next = { heading, footer, rows };

      setGeometry((previous) => (previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    }
  }

  function measure(part: { heading?: number; footer?: number }): void {
    measured.current = { ...measured.current, ...part };
    update();
  }

  function measureRow(memberId: string, rowHeight: number): void {
    measured.current.heights.set(memberId, rowHeight);
    update();
  }

  /** The people in the list's current order, whose row heights stack into its geometry. */
  function order(memberIds: string[]): void {
    if (memberIds.join() === measured.current.order.join()) return;
    measured.current = { ...measured.current, order: memberIds };
    update();
  }

  const plan = geometry && header ? planFor(geometry, height - header - headerGap) : null;

  return {
    scroll,
    hold,
    scrollControl,
    scrollToTop: (animated = true) => scrollControl.current?.(0, animated),
    /**
     * Scrolls until the Expenses heading is pinned under the Balances heading,
     * with the first expense right below it. The expenses start after the
     * balances, at the default level or listed in full above the “···”
     * button; both heights come from the measured parts, since web layout
     * events report size changes, not moves.
     */
    scrollToExpenses: (showAll: boolean) => {
      if (!plan || !geometry) return;

      const start = showAll ? plan.minimal + (geometry.rows.at(-1) ?? 0) + geometry.footer + moreHeight / 2 + padBottom : plan.full;

      scrollControl.current?.(start - plan.minimal);
    },
    measureHeader: setHeader,
    measure,
    measureRow,
    order,
    geometry,
    plan,
  };
}

export type BalancesLayout = ReturnType<typeof useBalancesLayout>;

/** Empty room at the page's end while the balances close, so the page keeps its length and the scroll is never cut short. */
export function BalancesHold(props: { layout: BalancesLayout }) {
  const { hold } = props.layout;
  const height = useSyncExternalStore(hold.subscribe, hold.get, hold.get);

  return height > 0 ? <View aria-hidden style={{ height }} /> : null;
}

/** How long showing fewer people takes, scrolling back to the top as the card closes. */
const closeDuration = 420;

/** Slow at both ends, so the close starts and settles without a jolt. */
function easeInOut(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

function between(range: readonly [number, number], eased: number): number {
  return range[0] + (range[1] - range[0]) * eased;
}

/**
 * A close in progress: where the page was scrolled, the card's and base's
 * heights from listed in full to the default level, and how far it has run.
 */
type Closing = { from: number; card: readonly [number, number]; base: readonly [number, number]; progress: number };

type BalancesProps = { app: MemberListApp; replica: Replica; layout: BalancesLayout };

/**
 * The Balances section above the expenses: its heading with Invite, then a
 * card of everyone and a line to add a person, styled like the expenses. By
 * default it shows everyone, unless that leaves no room for the first
 * expenses; then the card ends at the last whole person, with a floating “···”
 * on its edge that shows everyone, and the line to add a person waits until
 * everyone shows. Scrolling shrinks the card with the page, from the bottom,
 * until only the heading is left, pinned at the top; tapping the heading
 * scrolls back up. It stays part of the page's one scroll area. Shown in
 * full, the card scrolls with the page under the pinned heading.
 */
export function GroupBalances(props: BalancesProps) {
  const showAll = useUiState().balancesExpanded && Boolean(props.layout.plan?.truncated);
  const { plan } = props.layout;

  // Both levels share one tree, so switching between them, as when adding a
  // person makes the list too long, keeps the card and the Add a person line
  // with whatever is being typed in it.
  return (
    <>
      {showAll ? <PinnedHeading {...props} /> : null}
      <BalancesSection {...props} pinned={!showAll} />
      {/* Holds the section's place: pinned, the section above takes no room in the page. */}
      {showAll ? null : <View style={{ height: plan?.full ?? 0 }} />}
    </>
  );
}

/**
 * The section. At the default level it is pinned at the top of the page and
 * shrinks as the expenses scroll up; listed in full, it scrolls with the page.
 */
function BalancesSection(props: BalancesProps & { pinned: boolean }) {
  const { plan, scroll } = props.layout;
  const scrolled = useSyncExternalStore(scroll.subscribe, scroll.get, scroll.get);
  const height = props.pinned && plan ? heightAt(plan, scrolled) : undefined;

  return (
    <StickyTop height={height} pinned={props.pinned}>
      <View role="region" aria-label="Balances" nativeID="balances" style={[{ paddingBottom: padBottom }, props.pinned && { flex: 1, backgroundColor: colors.background }]}>
        <BalancesHeading {...props} />
        {/* The room below the card closes last, as the heading pins alone. */}
        <BalancesCard {...props} card={plan && height !== undefined ? Math.max(0, height - plan.minimal - padBottom) : undefined} />
      </View>
    </StickyTop>
  );
}

/** Shown in full, the heading alone, pinned once it reaches the top. */
function PinnedHeading(props: BalancesProps) {
  const { plan, scroll } = props.layout;
  const scrolled = useSyncExternalStore(scroll.subscribe, scroll.get, scroll.get);

  if (!plan || scrolled <= 0) return null;

  return (
    <StickyTop height={plan.minimal}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <BalancesHeading {...props} measuring={false} />
      </View>
    </StickyTop>
  );
}

/** “Balances” with Invite at its end; tapping the title scrolls back to the top. */
function BalancesHeading(props: BalancesProps & { measuring?: boolean }) {
  const invite = useActionCall();
  const measuring = props.measuring ?? true;
  const you = preferredMember(props.replica.projected_snapshot, props.replica.session?.identity.id);

  return (
    <View onLayout={measuring ? (event) => props.layout.measure({ heading: event.nativeEvent.layout.height }) : undefined}>
      <SectionHeading
        title="Balances"
        onPress={() => props.layout.scrollToTop()}
        end={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Invite people"
            disabled={!invite.can('showInvite')}
            onPress={() => { void invite.call('showInvite', {}); }}
            hitSlop={6}
            style={({ pressed }) => [
              // A soft pill, so it reads as a button without competing with Add expense.
              { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingLeft: 10, paddingRight: 12, borderRadius: 999, backgroundColor: colors.actionSoft },
              (pressed || !invite.can('showInvite')) && s.dim,
            ]}
          >
            <PlusIcon size={14} color={colors.action} strokeWidth={2.6} />
            <Text style={{ fontFamily, fontSize: 14, fontWeight: '600', color: colors.action }}>Invite</Text>
          </Pressable>
        }
      />
      {!you ? (
        <Text style={{ paddingHorizontal: 4, paddingBottom: 6, fontFamily, fontSize: 13, color: colors.warningInk }}>Tap your name to choose who you are.</Text>
      ) : null}
      <ErrorMessage message={invite.error} />
    </View>
  );
}

/**
 * Everyone, and the Add a person line once everyone shows. When not everyone
 * fits, a floating “···” button on the card's bottom edge shows everyone, and
 * listed in full, it shows fewer again. An empty base below the card keeps the
 * room the card leaves when it ends at a whole person. Given a height, the
 * section's space is cut to it from the bottom: the base goes first, then the
 * Add a person line, then the list; the button rides the card's edge and fades
 * out as the card closes.
 */
function BalancesCard(props: BalancesProps & { card?: number | undefined }) {
  const toggle = useActionCall();
  const expanded = useUiState().balancesExpanded;
  const snapshot = props.replica.projected_snapshot;
  const you = preferredMember(snapshot, props.replica.session?.identity.id);
  const owing = balancesByMember(props.replica);
  // Removed people stay while they owe or are owed.
  const members = orderedMembers(repaymentMembers(snapshot), owing, you?.id, (memberId) => hasRecords(snapshot, memberId));
  const { layout, card } = props;
  const plan = layout.plan;
  const rows = layout.geometry?.rows.slice(0, members.length) ?? [];
  // While cut, the base goes first, then the Add a person line, then the list.
  const cardHeight = card !== undefined && plan ? Math.min(plan.card, card) : undefined;
  const list = card !== undefined && plan ? Math.min(plan.list, card) : undefined;
  const cut = list !== undefined;
  // Listed in full, the button offers fewer; cut, it offers everyone.
  const fewer = !cut && expanded && Boolean(plan?.truncated);
  const addable = !plan?.truncated || fewer;
  const more = Boolean(plan?.truncated);
  const reduced = usePrefersReducedMotion();
  // Listed in full, the list grows from the default height once shown.
  const [opened, setOpened] = useState(false);
  const [closing, setClosing] = useState<Closing | null>(null);
  const eased = closing ? easeInOut(closing.progress) : 0;
  // Listed in full, the base only holds the button's lower half; closing, it grows to the default level's.
  const base = card !== undefined && cardHeight !== undefined ? card - cardHeight : closing ? between(closing.base, eased) : fewer ? moreHeight / 2 : 0;
  const moreOpacity = cardHeight === undefined ? 1 : Math.min(1, Math.max(0, (cardHeight - moreHeight / 2) / (2 * moreHeight)));
  const fullList = rows.at(-1) ?? 0;
  const growing = fewer && plan && !closing ? (opened ? fullList : plan.list) : undefined;
  const closingCard = closing ? between(closing.card, eased) : undefined;
  const running = closing !== null;

  useEffect(() => {
    // The card stays mounted between levels, so each listing in full grows again from the default height.
    if (!fewer) {
      setOpened(false);

      return;
    }

    const frame = requestAnimationFrame(() => setOpened(true));

    return () => cancelAnimationFrame(frame);
  }, [fewer]);

  // One clock drives the close, so the card, the base, and the scroll move together.
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    let done = false;

    let frame = requestAnimationFrame(function step(now) {
      // A frame's time can come from just before the close started.
      const progress = Math.min(1, Math.max(0, (now - start) / closeDuration));

      setClosing((current) => current && { ...current, progress });

      if (progress < 1) {
        frame = requestAnimationFrame(step);

        return;
      }

      done = true;
      // Shown at the top with the default level's heights, the default level takes over unchanged.
      void toggle.call('setBalancesExpanded', { expanded: false }).then(() => setClosing(null));
    });

    return () => {
      cancelAnimationFrame(frame);
      layout.hold.set(0);

      // Leaving the page mid-close still shows fewer people on return.
      if (!done) void toggle.call('setBalancesExpanded', { expanded: false });
    };
  }, [running]);

  // Scrolls in the same frame the card shrinks, before it is painted: the
  // page's top comes down and the card's edge, with “···”, glides to where it
  // rests at the top.
  useLayoutEffect(() => {
    if (closing) layout.scrollControl.current?.(closing.from * (1 - eased), false);
  }, [closing]);

  /**
   * “···” scrolls back to the top; cut, it jumps there and shows everyone if
   * they do not all fit there, and listed in full, it shows fewer again,
   * closing the card while scrolling back up.
   */
  function press(): void {
    if (fewer) {
      if (closing) return;

      if (reduced || !plan) {
        layout.scrollToTop(false);
        void toggle.call('setBalancesExpanded', { expanded: false });

        return;
      }

      const heights = [fullList + (layout.geometry?.footer ?? 0), plan.list] as const;

      // The page keeps its length while the card closes, so the scroll is never cut short.
      layout.hold.set(Math.max(0, heights[0] - heights[1]));
      setClosing({ from: layout.scroll.get(), card: heights, base: [moreHeight / 2, plan.base], progress: 0 });

      return;
    }

    layout.scrollToTop(false);

    if (plan?.truncated) void toggle.call('setBalancesExpanded', { expanded: true });
  }

  useEffect(() => {
    layout.order(members.map((member) => member.id));
  });

  return (
    <>
      <View style={{ zIndex: 1 }}>
        <View style={[s.listCard, { borderRadius: 16, borderWidth: 0, overflow: 'hidden' }, (cardHeight ?? closingCard) !== undefined && { height: cardHeight ?? closingCard }]}>
          <AnimatedHeight height={cut ? list : growing} animate={!cut}>
            {members.map((member, index) => (
              <PersonRow
                key={member.id}
                app={props.app}
                replica={props.replica}
                memberId={member.id}
                first={index === 0}
                removed={member.status !== 'active'}
                you={member.id === you?.id}
                balances={owing.get(member.id) ?? []}
                recorded={hasRecords(snapshot, member.id)}
                hidden={cut && (rows[index] ?? 0) > list}
                onLayout={(rowHeight) => layout.measureRow(member.id, rowHeight)}
              />
            ))}
          </AnimatedHeight>
          {addable ? (
            <View
              aria-hidden={card !== undefined && plan ? plan.list >= card : undefined}
              onLayout={(event) => layout.measure({ footer: event.nativeEvent.layout.height })}
            >
              <AddPersonRow />
            </View>
          ) : null}
        </View>
        {more && moreOpacity > 0 ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: -moreHeight / 2, alignItems: 'center', opacity: moreOpacity }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={fewer ? 'Show fewer people' : `Show all ${members.length} people`}
              disabled={!toggle.can('setBalancesExpanded', { expanded: !fewer })}
              onPress={press}
              hitSlop={10}
              style={({ pressed }) => [
                // Floats over the card's edge, so it reads as a button rather than a row.
                { alignItems: 'center', justifyContent: 'center', height: moreHeight, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, boxShadow: '0 2px 8px rgba(16, 22, 29, 0.14)' },
                pressed && { backgroundColor: colors.background },
              ]}
            >
              <Text numberOfLines={1} style={{ fontFamily, fontSize: 16, lineHeight: 16, letterSpacing: 2, color: colors.faint }}>
                ···
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {/* Empty, holding the room the card leaves so the expenses do not move. */}
      {base > 0 ? <View aria-hidden style={{ height: base }} /> : null}
      <ErrorMessage message={toggle.error} />
    </>
  );
}

function PersonRow(props: {
  app: MemberListApp;
  replica: Replica;
  memberId: string;
  first: boolean;
  removed: boolean;
  you: boolean;
  balances: { currency: string; amount: number }[];
  recorded: boolean;
  hidden: boolean;
  onLayout?: ((height: number) => void) | undefined;
}) {
  const open = useActionCall();
  const name = memberName(props.replica.projected_snapshot, props.memberId);
  const state = props.app.snapshot();
  const participants = participantMarkers(props.replica, props.memberId, props.app.client.presence(props.replica.group_id), state.online && state.reachable);
  const amounts = props.balances.map((entry) => signedMoney(entry.amount, entry.currency));

  return (
    <View
      aria-hidden={props.hidden}
      style={[!props.first && s.ruled, props.you && { backgroundColor: colors.youRow }]}
      onLayout={props.onLayout ? (event) => props.onLayout?.(event.nativeEvent.layout.height) : undefined}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}${props.you ? ' (you)' : ''}${props.removed ? ', removed' : ''}, ${amounts.join(', ') || (props.recorded ? 'settled' : 'no expenses yet')}. Show details`}
        disabled={props.hidden || !open.can('showPerson', { memberId: props.memberId })}
        onPress={() => { void open.call('showPerson', { memberId: props.memberId }); }}
        style={({ pressed }) => [listRow, { minHeight: 44 }, pressed && { backgroundColor: colors.background }]}
      >
        <MemberIcon participants={participants} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={[s.name, { flexShrink: 1 }]}>{name}</Text>
          {props.you ? <YouBadge /> : null}
          {props.removed ? <Text style={rowCaption}>removed</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 1 }}>
          {props.balances.map((entry) => (
            <Text key={entry.currency} accessibilityLabel={moneyLabel(Math.abs(entry.amount), entry.currency)} style={{ fontFamily: monoFamily, fontWeight: '600', fontSize: 16, color: entry.amount > 0 ? colors.owed : entry.amount < 0 ? colors.owes : colors.settled }}>
              {signedMoney(entry.amount, entry.currency)}
            </Text>
          ))}
        </View>
      </Pressable>
      <ErrorMessage message={open.error} />
    </View>
  );
}
