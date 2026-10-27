import { Pressable, Text, View } from 'react-native';
import { formatAmount, memberSettlements, preferredMember, repaymentMembers, settlementSuggestions } from '@splitnext/client';
import { memberName, moneyLabel, noCurrency } from '../model/expenses';
import { BackHeader } from './BackHeader';
import { Button, ErrorMessage, Pill, colors, s } from './components';
import { useRepaymentForm } from './ExpenseList';
import { ArrowRightIcon, CheckIcon } from './icons';
import type { MemberListApp } from './MemberList';
import { fontFamily, monoFamily, radius } from './theme';
import { useUiState } from './useActionCall';

/** The settle-up header: back to the person it settles, or the group, named above the title. */
export function SettleUpHeader(props: { app: MemberListApp }) {
  const person = useUiState().person;
  const snapshot = props.app.snapshot().group?.projected_snapshot;
  const name = person ? memberName(snapshot, person) : snapshot?.group.name ?? '';

  return <BackHeader context={name} title="Settle up" />;
}

/**
 * The payments in the group's settle-up plan: all of them, or
 * those involving one person. Each opens the repayment form filled in; the amount stays
 * editable for a partial payment.
 */
export function SettleUp(props: { app: MemberListApp }) {
  const person = useUiState().person;
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const repayment = useRepaymentForm();

  if (!snapshot || !replica) return null;
  const you = preferredMember(snapshot, replica.session?.identity.id)?.id;
  const name = person ? memberName(snapshot, person) : 'everyone';
  const label = (memberId: string) => (memberId === you ? 'You' : memberName(snapshot, memberId));
  const payments = person ? memberSettlements(snapshot, person) : settlementSuggestions(snapshot);
  const currencies = [...new Set(payments.map((entry) => entry.currency))];
  // A different payment starts from the person, or from you for the whole group.
  const from = person ?? you ?? repaymentMembers(snapshot)[0]?.id ?? '';
  const other = you && you !== from ? you : repaymentMembers(snapshot).find((member) => member.id !== from)?.id ?? '';

  return (
    <View style={{ gap: 18, paddingBottom: 32 }}>
      <Text style={[s.lead, { paddingHorizontal: 4 }]}>
        {payments.length ? `These payments settle ${name} completely. Tap one once it’s paid.` : person ? `${name} is settled up.` : 'Everyone is settled up.'}
      </Text>

      {!payments.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 16, borderRadius: radius.card, backgroundColor: colors.surface }}>
          <CheckIcon color={colors.settled} />
          <Text style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.settled }}>All settled up</Text>
        </View>
      ) : null}

      {currencies.map((currency) => (
        <View key={currency}>
          <View style={{ gap: 8 }}>
            {payments.filter((entry) => entry.currency === currency).map((entry) => {
              const from = label(entry.from_member_id);
              const to = label(entry.to_member_id);

              return (
                <Pressable
                  key={`${entry.from_member_id}:${entry.to_member_id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${from} ${from === 'You' ? 'pay' : 'pays'} ${to === 'You' ? 'you' : to} ${moneyLabel(entry.amount, currency)}. Record this payment`}
                  disabled={repayment.action.busy}
                  onPress={() => repayment.open({ from: entry.from_member_id, to: entry.to_member_id, amount: formatAmount(entry.amount, currency), currency, manual: false })}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingVertical: 10, paddingLeft: 16, paddingRight: 12, borderRadius: radius.card, backgroundColor: colors.surface }, pressed && s.pressed]}
                >
                  <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>{from}</Text>
                    <ArrowRightIcon color={colors.muted} />
                    <Text style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>{to}</Text>
                  </View>
                  <Text style={{ fontFamily: monoFamily, fontWeight: '600', fontSize: 17, color: colors.ink }}>{formatAmount(entry.amount, currency)}</Text>
                  <Pill filled text="Record" />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <View style={{ alignItems: 'flex-start' }}>
        <Button
          quiet
          small
          disabled={repayment.action.busy || !from || !other}
          onPress={() => {
            const owes = payments.find((entry) => entry.from_member_id === from || entry.to_member_id === from);

            repayment.open({ from, to: owes ? (owes.from_member_id === from ? owes.to_member_id : owes.from_member_id) : other, amount: '', currency: owes?.currency ?? currencies[0] ?? noCurrency, manual: true });
          }}
        >
          Record a different payment
        </Button>
      </View>
      <ErrorMessage message={repayment.action.error} />
    </View>
  );
}
