import { View } from 'react-native';
import { preferredMember, type ClientReplicaState, type Expense, type Settlement } from '@splitnext/client';
import { currentExpenses, expenseEffect, expenseLabel, matchesSearch, memberName, moneyLabel, monthHeading } from '../model/expenses';
import type { UiState } from '../model/uiState';
import { needsReview } from '../model/notices';
import { Button, Dot, EmptyState, ErrorMessage, Row, Stack, Text, Touchable, colors, layout, opacities, rules, sizes } from '../design';
import { balanceColor, signedFigure } from './balance';
import { MemberAvatar } from './MemberList';
import { morph } from './ScreenMorph';
import { useActionCall, useUiState } from './useActionCall';

type Replica = ClientReplicaState;

/** A name in a sentence, as "You"/"you" when it is this device's member. */
function personName(replica: Replica, memberId: string, capital: boolean): string {
  const you = preferredMember(replica.projected_snapshot, replica.session?.identity.id)?.id;

  return memberId === you ? (capital ? 'You' : 'you') : memberName(replica.projected_snapshot, memberId);
}

/** A recorded repayment as people say it: "Ana paid you back". */
export function repaymentTitle(replica: Replica, entry: Pick<Settlement, 'from_member_id' | 'to_member_id'>): string {
  return `${personName(replica, entry.from_member_id, true)} paid ${personName(replica, entry.to_member_id, false)} back`;
}

type Entry = { kind: 'expense'; expense: Expense } | { kind: 'settlement'; settlement: Settlement };

/** Current expenses and recorded repayments together, newest first. */
function ledgerEntries(replica: Replica): Entry[] {
  const snapshot = replica.projected_snapshot;
  const expenses = currentExpenses(snapshot).toReversed().map((expense): Entry => ({ kind: 'expense', expense }));
  const settlements = (snapshot?.settlements ?? []).filter((entry) => entry.status === 'active').map((settlement): Entry => ({ kind: 'settlement', settlement }));
  const created = (entry: Entry) => (entry.kind === 'expense' ? entry.expense.created_at : entry.settlement.created_at);

  // Recorded order breaks ties, as the group applied them.
  return [...expenses, ...settlements]
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (created(right.entry) < created(left.entry) ? -1 : created(right.entry) > created(left.entry) ? 1 : right.index - left.index))
    .map(({ entry }) => entry);
}

/** The group screen's list: expenses and repayments, newest first, under the month each falls in. */
export function ExpenseList(props: { replica: Replica }) {
  const search = useUiState().search;
  const you = preferredMember(props.replica.projected_snapshot, props.replica.session?.identity.id)?.id;
  const all = ledgerEntries(props.replica);
  const entries = search.open ? all.filter((entry) => found(props.replica, entry, search, you)) : all;

  if (!all.length) return <EmptyState title="No expenses yet" />;

  if (!entries.length) return <EmptyState title="Nothing matches" text="Try other words, or turn a filter off." />;
  const created = (entry: Entry) => (entry.kind === 'expense' ? entry.expense.created_at : entry.settlement.created_at);

  return (
    <View role="list" aria-label="Expenses">
      {entries.map((entry, index) => {
        const month = monthHeading(created(entry));
        const previous = entries[index - 1];

        return (
          <View key={entry.kind === 'expense' ? entry.expense.id : entry.settlement.id}>
            {!previous || monthHeading(created(previous)) !== month ? (
              <Text accessibilityRole="header" variant="meta" weight="semibold" tone="muted" style={{ paddingTop: 16, paddingBottom: 4 }}>{month}</Text>
            ) : null}
            {entry.kind === 'expense'
              ? <ExpenseRow replica={props.replica} expense={entry.expense} you={you} />
              : <RepaymentRow replica={props.replica} settlement={entry.settlement} you={you} />}
          </View>
        );
      })}
      {search.open ? <SearchTotal replica={props.replica} entries={entries} you={you} /> : null}
    </View>
  );
}

/** Whether a search finds an entry: its words in what it was for, and every filter that is on. */
function found(replica: Replica, entry: Entry, search: UiState['search'], you: string | undefined): boolean {
  const title = entry.kind === 'expense' ? entry.expense.description : repaymentTitle(replica, entry.settlement);
  const effect = entry.kind === 'expense' ? expenseEffect(entry.expense, you) : you === entry.settlement.from_member_id || you === entry.settlement.to_member_id ? 1 : null;
  const paidByYou = entry.kind === 'expense' ? entry.expense.paid.some((payer) => payer.member_id === you) : entry.settlement.from_member_id === you;

  return matchesSearch(title, search.query) && (!search.involvesYou || effect !== null) && (!search.paidByYou || paidByYou);
}

/** Under a search's results: how many, and what they come to for you. */
function SearchTotal(props: { replica: Replica; entries: Entry[]; you: string | undefined }) {
  const totals = new Map<string, number>();

  for (const entry of props.entries) {
    const currency = entry.kind === 'expense' ? entry.expense.currency : entry.settlement.currency;

    const effect = entry.kind === 'expense'
      ? expenseEffect(entry.expense, props.you)
      : props.you === entry.settlement.from_member_id ? entry.settlement.amount : props.you === entry.settlement.to_member_id ? -entry.settlement.amount : null;

    if (effect !== null) totals.set(currency, (totals.get(currency) ?? 0) + effect);
  }

  return (
    <Row gap={12} style={[{ minHeight: sizes.row }, rules.above]}>
      <Text variant="body" weight="semibold" tone="muted" style={{ flex: 1 }}>{props.entries.length === 1 ? '1 result' : `${props.entries.length} results`}</Text>
      {[...totals].map(([currency, amount]) => <Text key={currency} variant="figure" color={balanceColor(amount)}>{signedFigure(amount, currency)}</Text>)}
    </Row>
  );
}

/** The small orange dot on a row whose change from this device needs review. */
function ReviewDot() {
  return <Dot label="Needs review" color={colors.alert} />;
}

/**
 * One expense or repayment: who paid as their avatar, what it was, and its
 * amount, with what it does to you under it when that is not nothing. A row
 * that leaves you out entirely is quiet.
 */
function EntryRow(props: { replica: Replica; payer: string | undefined; label: string; title: string; amount: string; effect: number | null; currency: string; quiet?: boolean; review: boolean; disabled: boolean; onPress: () => void; error: string | null; morph?: string }) {
  const involved = props.effect !== null;

  return (
    <View>
      <Touchable
        feedback="tint"
        accessibilityRole="button"
        accessibilityLabel={props.label}
        disabled={props.disabled}
        onPress={props.onPress}
        style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.row, paddingVertical: 8, marginHorizontal: -layout.gutter, paddingHorizontal: layout.gutter }, rules.above]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, opacity: involved ? 1 : opacities.disabled }}>
          {props.payer ? <MemberAvatar replica={props.replica} memberId={props.payer} /> : null}
          <Row gap={8} fill>
            <Text ref={morph(props.morph && `etitle-${props.morph}`)} numberOfLines={2} variant="strong" style={{ flexShrink: 1 }}>{props.title}</Text>
            {props.review ? <ReviewDot /> : null}
          </Row>
          <Stack gap={2} align="end" style={{ flexShrink: 0 }}>
            <Text ref={morph(props.morph && `eamt-${props.morph}`, { unclipped: true })} variant="figure" tone={props.quiet ? 'muted' : 'ink'}>{props.amount}</Text>
            {props.effect ? <Text variant="figureSmall" color={balanceColor(props.effect)}>{signedFigure(props.effect, props.currency)}</Text> : null}
          </Stack>
        </View>
      </Touchable>
      <ErrorMessage message={props.error} />
    </View>
  );
}

function ExpenseRow(props: { replica: Replica; expense: Expense; you: string | undefined }) {
  const open = useActionCall();
  const expense = props.expense;

  return (
    <EntryRow
      replica={props.replica}
      payer={expense.paid[0]?.member_id}
      label={`Change ${expenseLabel(expense)}`}
      morph={expense.id}
      title={expense.description}
      amount={moneyLabel(expense.total, expense.currency)}
      effect={expenseEffect(expense, props.you)}
      currency={expense.currency}
      review={needsReview(props.replica, 'expense', expense.id)}
      disabled={!open.can('showExpense', { expenseId: expense.id })}
      onPress={() => { void open.call('showExpense', { expenseId: expense.id }); }}
      error={open.error}
    />
  );
}

/** A recorded repayment, which opens in the repayment form. */
export function RepaymentRow(props: { replica: Replica; settlement: Settlement; you: string | undefined }) {
  const open = useActionCall();
  const entry = props.settlement;
  const title = repaymentTitle(props.replica, entry);
  // Paying back raises the payer's balance and lowers the one paid.
  const effect = props.you === entry.from_member_id ? entry.amount : props.you === entry.to_member_id ? -entry.amount : null;

  return (
    <EntryRow
      replica={props.replica}
      payer={entry.from_member_id}
      label={`Change repayment: ${title} ${moneyLabel(entry.amount, entry.currency)}`}
      title={title}
      amount={moneyLabel(entry.amount, entry.currency)}
      effect={effect}
      currency={entry.currency}
      quiet
      review={needsReview(props.replica, 'settlement', entry.id)}
      disabled={!open.can('showSettlement', { settlementId: entry.id })}
      onPress={() => { void open.call('showSettlement', { settlementId: entry.id }); }}
      error={open.error}
    />
  );
}

/** Add expense, the group screen's main action, pinned at its foot. */
export function AddExpenseButton() {
  const add = useActionCall();

  return (
    <>
      <ErrorMessage message={add.error} />
      <Button ref={morph('addexp')} disabled={!add.can('showExpense', {})} onPress={() => { void add.call('showExpense', {}); }}>
        Add expense
      </Button>
    </>
  );
}

