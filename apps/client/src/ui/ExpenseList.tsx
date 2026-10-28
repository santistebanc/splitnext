import { Text, View } from 'react-native';
import { preferredMember, type ClientReplicaState, type Expense, type Settlement } from '@splitnext/client';
import { currentExpenses, expenseLabel, memberName, moneyLabel } from '../model/expenses';
import { needsReview } from '../model/notices';
import { ErrorMessage, FooterButton, ListRow, colors, s } from './components';
import { morph } from './ScreenMorph';
import { useActionCall } from './useActionCall';

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

/** The group screen's list: expenses and repayments, newest first. */
export function ExpenseList(props: { replica: Replica }) {
  const entries = ledgerEntries(props.replica);

  if (!entries.length) return null;

  return (
    <View role="list" aria-label="Expenses">
      <View style={s.listCard}>
        {entries.map((entry, index) =>
          entry.kind === 'expense'
            ? <ExpenseRow key={entry.expense.id} replica={props.replica} expense={entry.expense} first={index === 0} />
            : <RepaymentRow key={entry.settlement.id} replica={props.replica} settlement={entry.settlement} first={index === 0} />,
        )}
      </View>
    </View>
  );
}

/** The small orange dot on a row whose change from this device needs review. */
function ReviewDot() {
  return <View role="img" aria-label="Needs review" style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.alert }} />;
}

function Row(props: { first: boolean; label: string; title: string; meta?: string; amount: string; quiet?: boolean; review: boolean; disabled: boolean; onPress: () => void; error: string | null; morph?: string }) {
  return (
    <View>
      <ListRow label={props.label} disabled={props.disabled} onPress={props.onPress}>
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text ref={morph(props.morph && `etitle-${props.morph}`)} numberOfLines={2} style={[s.name, { flexShrink: 1, fontSize: 17, lineHeight: 22 }]}>{props.title}</Text>
            {props.review ? <ReviewDot /> : null}
          </View>
          {props.meta ? <Text numberOfLines={1} style={s.rowCaption}>{props.meta}</Text> : null}
        </View>
        <Text ref={morph(props.morph && `eamt-${props.morph}`, { unclipped: true })} style={[s.amount, props.quiet && { color: colors.muted }]}>{props.amount}</Text>
      </ListRow>
      <ErrorMessage message={props.error} />
    </View>
  );
}

function ExpenseRow(props: { replica: Replica; expense: Expense; first: boolean }) {
  const open = useActionCall();
  const expense = props.expense;
  const payer = expense.paid[0]?.member_id;
  const people = expense.parts.length;

  return (
    <Row
      first={props.first}
      label={`Change ${expenseLabel(expense)}`}
      morph={expense.id}
      title={expense.description}
      meta={`${payer ? personName(props.replica, payer, true) : 'Someone'} paid · ${people === 1 ? '1 person' : `${people} people`}`}
      amount={moneyLabel(expense.total, expense.currency)}
      review={needsReview(props.replica, 'expense', expense.id)}
      disabled={!open.can('showExpense', { expenseId: expense.id })}
      onPress={() => { void open.call('showExpense', { expenseId: expense.id }); }}
      error={open.error}
    />
  );
}

/** A recorded repayment, which opens in the repayment form. */
export function RepaymentRow(props: { replica: Replica; settlement: Settlement; first: boolean }) {
  const open = useActionCall();
  const entry = props.settlement;
  const title = repaymentTitle(props.replica, entry);

  return (
    <Row
      first={props.first}
      label={`Change repayment: ${title} ${moneyLabel(entry.amount, entry.currency)}`}
      title={title}
      amount={moneyLabel(entry.amount, entry.currency)}
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
      <FooterButton morph="addexp" disabled={!add.can('showExpense', {})} onPress={() => { void add.call('showExpense', {}); }}>
        Add expense
      </FooterButton>
    </>
  );
}

