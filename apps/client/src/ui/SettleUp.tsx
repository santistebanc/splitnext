import { Pressable, Text, View } from 'react-native';
import { formatAmount, memberSettlements, preferredMember, repaymentMembers } from '@splitnext/client';
import { memberName, moneyLabel } from '../model/expenses';
import { ErrorMessage, colors, s } from './components';
import { useRepaymentForm } from './ExpenseList';
import { ArrowRightIcon, CheckIcon } from './icons';
import type { MemberListApp } from './MemberList';
import { BackHeader } from './PersonView';
import { fontFamily, monoFamily } from './theme';
import { useUiState } from './useActionCall';

/** The settle-up header: back to the person it settles, named above the title. */
export function SettleUpHeader(props: { app: MemberListApp }) {
  const person = useUiState().person;
  const name = person ? memberName(props.app.snapshot().group?.projected_snapshot, person) : '';

  return <BackHeader context={name} title="Settle up" />;
}

/**
 * The payments in the group's settle-up plan that involve one person, per
 * currency. Each opens the repayment form filled in; the amount stays
 * editable for a partial payment.
 */
export function SettleUp(props: { app: MemberListApp }) {
  const person = useUiState().person;
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const repayment = useRepaymentForm();

  if (!snapshot || !replica || !person) return null;
  const you = preferredMember(snapshot, replica.session?.identity.id)?.id;
  const name = memberName(snapshot, person);
  const label = (memberId: string) => (memberId === you ? 'You' : memberName(snapshot, memberId));
  const payments = memberSettlements(snapshot, person);
  const currencies = [...new Set(payments.map((entry) => entry.currency))];
  const other = you && you !== person ? you : repaymentMembers(snapshot).find((member) => member.id !== person)?.id ?? '';

  return (
    <View style={{ gap: 18, paddingBottom: 32 }}>
      <Text style={{ paddingHorizontal: 4, fontFamily, fontSize: 15, lineHeight: 22, color: colors.soft }}>
        {payments.length ? `These payments settle ${name} completely. Tap one once it’s paid.` : `${name} is settled up.`}
      </Text>

      {!payments.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.surface }}>
          <CheckIcon color={colors.settled} />
          <Text style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.settled }}>All settled up</Text>
        </View>
      ) : null}

      {currencies.map((currency) => (
        <View key={currency} style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={{ paddingHorizontal: 4, fontFamily, fontSize: 15, fontWeight: '600', color: colors.ink }}>{currency}</Text>
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
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingVertical: 10, paddingLeft: 16, paddingRight: 12, borderRadius: 16, backgroundColor: colors.surface }, pressed && s.pressed]}
                >
                  <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>{from}</Text>
                    <ArrowRightIcon color={colors.muted} />
                    <Text style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>{to}</Text>
                  </View>
                  <Text style={{ fontFamily: monoFamily, fontWeight: '600', fontSize: 17, color: colors.ink }}>{formatAmount(entry.amount, currency)}</Text>
                  <View style={{ height: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.action, justifyContent: 'center' }}>
                    <Text style={{ fontFamily, fontSize: 14, fontWeight: '600', color: colors.actionInk }}>Record</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        disabled={repayment.action.busy || !other}
        onPress={() => {
          const owes = payments[0];

          repayment.open({ from: person, to: owes ? (owes.from_member_id === person ? owes.to_member_id : owes.from_member_id) : other, amount: '', currency: owes?.currency ?? currencies[0] ?? 'EUR', manual: true });
        }}
        style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' }, (pressed || !other) && s.dim]}
      >
        <Text style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.action }}>Record a different payment</Text>
      </Pressable>
      <ErrorMessage message={repayment.action.error} />
    </View>
  );
}
