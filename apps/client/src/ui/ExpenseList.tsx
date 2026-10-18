import { Pressable, Text, View } from 'react-native';
import { memberLabel, nameOrdinals, type ClientReplicaState } from '@splitnext/client';
import { balanceRows, currentExpenses, expenseLabel, memberName, moneyLabel } from '../model/expenses';
import { Button, ErrorMessage, s } from './components';
import { useActionCall } from './useActionCall';

type Replica = ClientReplicaState;

/** The group's current expenses, newest first, each opening the form to change it. */
export function ExpenseList(props: { replica: Replica }) {
  const snapshot = props.replica.projected_snapshot;
  const expenses = currentExpenses(snapshot);
  const add = useActionCall();

  return (
    <View style={[s.card, s.peopleCard]}>
      <View style={s.between}>
        <Text accessibilityRole="header" style={s.heading}>
          Expenses
        </Text>
        <Button
          quiet
          disabled={!add.can('showExpense', {})}
          onPress={() => {
            void add.call('showExpense', {});
          }}
        >
          Add expense
        </Button>
      </View>
      {expenses.map((expense) => (
        <ExpenseRow key={expense.id} replica={props.replica} expenseId={expense.id} />
      ))}
      <ErrorMessage message={add.error} />
    </View>
  );
}

function ExpenseRow(props: { replica: Replica; expenseId: string }) {
  const snapshot = props.replica.projected_snapshot;
  const expense = snapshot?.expenses.find((entry) => entry.id === props.expenseId);
  const open = useActionCall();
  const remove = useActionCall();

  if (!expense) return null;

  const payer = expense.paid[0]?.member_id;

  const needsReview = props.replica.notices.some(
    (notice) => notice.outcome.target.kind === 'expense' && notice.outcome.target.id === expense.id,
  );

  return (
    <View>
      <View style={s.ledgerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Change ${expenseLabel(expense)}`}
          disabled={!open.can('showExpense', { expenseId: expense.id })}
          onPress={() => {
            void open.call('showExpense', { expenseId: expense.id });
          }}
          style={[s.personText, s.between]}
        >
          <View style={s.personText}>
            <Text numberOfLines={1} style={s.name}>
              {expense.description}
            </Text>
            <Text numberOfLines={1} style={s.caption}>
              Paid by {payer ? memberName(snapshot, payer) : 'someone'}
              {needsReview ? ' · needs review' : ''}
            </Text>
          </View>
          <Text style={s.amount}>{moneyLabel(expense.total, expense.currency)}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${expenseLabel(expense)}`}
          disabled={!remove.can('removeExpense', { expenseId: expense.id })}
          onPress={() => {
            void remove.call('removeExpense', { expenseId: expense.id });
          }}
          style={s.memberActionsButton}
        >
          <Text style={s.name}>×</Text>
        </Pressable>
      </View>
      <ErrorMessage message={open.error ?? remove.error} />
    </View>
  );
}

/** What each member is owed or owes, separately in every currency. */
export function Balances(props: { replica: Replica }) {
  const snapshot = props.replica.projected_snapshot;
  const currencies = balanceRows(snapshot);
  const ordinals = nameOrdinals(snapshot);

  if (!currencies.length) return null;

  return (
    <View style={[s.card, s.peopleCard]}>
      <Text accessibilityRole="header" style={s.heading}>
        Balances
      </Text>
      {currencies.map(({ currency, rows }) => (
        <View key={currency}>
          {currencies.length > 1 ? <Text style={s.label}>{currency}</Text> : null}
          {rows.map(({ member, amount }) => (
            <View key={member.id} style={[s.ledgerRow, s.between]}>
              <Text numberOfLines={1} style={[s.name, s.memberName]}>
                {memberLabel(member.display_name, ordinals.get(member.id))}
              </Text>
              <Text style={[s.amount, amount > 0 && s.owed]}>
                {amount > 0
                  ? `is owed ${moneyLabel(amount, currency)}`
                  : amount < 0
                    ? `owes ${moneyLabel(-amount, currency)}`
                    : 'settled'}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
