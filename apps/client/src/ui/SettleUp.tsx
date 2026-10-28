import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { formatAmount, memberSettlements, preferredMember, repaymentMembers, settlementSuggestions } from '@splitnext/client';
import { memberName, moneyLabel, noCurrency } from '../model/expenses';
import { ErrorMessage, FooterButton, colors, s } from './components';
import { useRepaymentForm } from './ExpenseList';
import { FooterDrawer } from './FooterDrawer';
import type { MemberListApp } from './MemberList';
import { fontFamily, monoFamily } from './theme';
import { useActionCall, useUiState } from './useActionCall';

/** The payments to settle: one person's, or the whole group's plan. */
function plannedPayments(app: MemberListApp, person: string | null) {
  const replica = app.snapshot().group;
  const snapshot = replica?.projected_snapshot;

  if (!snapshot || !replica) return null;
  const you = preferredMember(snapshot, replica.session?.identity.id)?.id;

  return { snapshot, you, payments: person ? memberSettlements(snapshot, person) : settlementSuggestions(snapshot) };
}

/**
 * Settle up, pinned at the person's foot while they are in a payment of the
 * group's plan. It opens the plan's payments as a drawer above it, like New
 * group, and then records a different payment.
 */
export function SettleUpFooter(props: { app: MemberListApp }) {
  const ui = useUiState();
  const person = ui.person;
  const open = ui.view === 'settle';
  const settle = useActionCall();
  const back = useActionCall();
  const repayment = useRepaymentForm();
  const { height } = useWindowDimensions();
  const plan = plannedPayments(props.app, person);

  // Settled people have nothing to open, unless it is already open and showing ✓ Settled.
  if (!plan || (!plan.payments.length && !open)) return null;
  const { snapshot, you, payments } = plan;
  const count = payments.length;
  // A different payment starts from the person, or from you for the whole group.
  const from = person ?? you ?? repaymentMembers(snapshot)[0]?.id ?? '';
  const other = you && you !== from ? you : repaymentMembers(snapshot).find((member) => member.id !== from)?.id ?? '';

  function recordDifferent(): void {
    const owes = payments.find((entry) => entry.from_member_id === from || entry.to_member_id === from);

    repayment.open({ from, to: owes ? (owes.from_member_id === from ? owes.to_member_id : owes.from_member_id) : other, amount: owes ? formatAmount(owes.amount, owes.currency) : '', currency: owes?.currency ?? noCurrency, manual: true });
  }

  return (
    <FooterDrawer
      open={open}
      title="Settle up"
      closeLabel={person ? `Back to ${memberName(snapshot, person)}` : 'Back to group'}
      closeText="Close"
      onClose={() => { void back.call('closePanel', {}); }}
      footer={(
        <>
          <ErrorMessage message={settle.error ?? back.error ?? repayment.action.error} />
          {open ? (
            <FooterButton label="Record a different payment" disabled={repayment.action.busy || !from || !other} onPress={recordDifferent}>
              Record a different payment
            </FooterButton>
          ) : (
            <FooterButton
              label={`Settle up, ${count === 1 ? '1 payment' : `${count} payments`}`}
              disabled={!settle.can('showSettleUp', person ? { memberId: person } : {})}
              onPress={() => { void settle.call('showSettleUp', person ? { memberId: person } : {}); }}
            >
              Settle up
            </FooterButton>
          )}
        </>
      )}
    >
      <ScrollView style={{ maxHeight: height * 0.5 }}>
        <SettleUpPayments app={props.app} />
      </ScrollView>
    </FooterDrawer>
  );
}

/** The plan's payments, each recorded as planned with Record. */
function SettleUpPayments(props: { app: MemberListApp }) {
  const person = useUiState().person;
  const record = useActionCall();
  const plan = plannedPayments(props.app, person);

  if (!plan) return null;
  const { snapshot, you, payments } = plan;
  const label = (memberId: string) => (memberId === you ? 'You' : memberName(snapshot, memberId));

  return (
    <View>
      <View role="list" aria-label="Payments">
        {payments.map((entry) => {
          const payer = label(entry.from_member_id);
          const payee = label(entry.to_member_id);
          const amount = moneyLabel(entry.amount, entry.currency);

          return (
            <View key={`${entry.currency}:${entry.from_member_id}:${entry.to_member_id}`} style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 }, s.ruled]}>
              <Text style={{ flex: 1, fontFamily, fontSize: 18, lineHeight: 22, fontWeight: '600', color: colors.ink }}>{payer} → {payee === 'You' ? 'you' : payee}</Text>
              <Text style={{ fontFamily: monoFamily, fontSize: 18, fontWeight: '500', color: colors.ink }}>{amount}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${payer} ${payer === 'You' ? 'pay' : 'pays'} ${payee === 'You' ? 'you' : payee} ${moneyLabel(entry.amount, entry.currency)}. Record this payment`}
                disabled={record.busy || !record.can('recordSettlement', { from: entry.from_member_id, to: entry.to_member_id, amount, currency: entry.currency })}
                onPress={() => { void record.call('recordSettlement', { from: entry.from_member_id, to: entry.to_member_id, amount, currency: entry.currency }); }}
                style={({ pressed }) => [{ height: 44, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: colors.action }, pressed && s.pressed]}
              >
                <Text style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.actionInk }}>Record</Text>
              </Pressable>
            </View>
          );
        })}
        {!payments.length ? (
          <View style={[{ paddingVertical: 16 }, s.ruled]}>
            <Text style={{ fontFamily, fontSize: 18, fontWeight: '600', color: colors.settledInk }}>✓ {person ? 'Settled' : 'Everyone is settled up'}</Text>
          </View>
        ) : null}
      </View>
      <ErrorMessage message={record.error} />
    </View>
  );
}
