import { Pressable, Text, View } from 'react-native';
import { formatAmount, memberSettlements, preferredMember, repaymentMembers, settlementSuggestions } from '@splitnext/client';
import { balanceRows, memberName, moneyLabel, noCurrency } from '../model/expenses';
import { BackButton, ErrorMessage, ScreenHeader, colors, s } from './components';
import { useRepaymentForm } from './ExpenseList';
import type { MemberListApp } from './MemberList';
import { between, useCompactProgress } from './pageScroll';
import { BalanceFigure } from './PersonView';
import { fontFamily, monoFamily } from './theme';
import { useActionCall, useUiState } from './useActionCall';

/** The settle-up header: back, Settle up, and whose balance it settles, over its bar. */
export function SettleUpHeader(props: { app: MemberListApp }) {
  const person = useUiState().person;
  const progress = useCompactProgress();
  const back = useActionCall();
  const snapshot = props.app.snapshot().group?.projected_snapshot;
  const group = snapshot?.group.name ?? '';
  const name = person ? memberName(snapshot, person) : group;
  const rows = balanceRows(snapshot);
  const amount = person ? rows.flatMap((entry) => entry.rows.filter((row) => row.member.id === person).map((row) => ({ currency: entry.currency, amount: row.amount })))[0] : undefined;
  const max = Math.max(0, ...rows.flatMap((entry) => entry.rows.map((row) => Math.abs(row.amount))));

  return (
    <>
      <ScreenHeader
        start={<BackButton label={`Back to ${name}`} text={name} disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
        title="Settle up"
        morph={person ? `settle-${person}` : undefined}
        below={person ? (
          <View style={{ gap: 16, paddingTop: between(32, 12, progress) }}>
            <Text style={{ fontFamily, fontSize: 20, lineHeight: 25, fontWeight: '600', color: colors.ink }}>{name}</Text>
            <BalanceFigure amount={amount?.amount ?? 0} currency={amount?.currency ?? noCurrency} max={max} label="" size={18} bar={8} />
          </View>
        ) : undefined}
      />
      <ErrorMessage message={back.error} />
    </>
  );
}

/**
 * The payments in the group's settle-up plan: all of them, or those involving
 * one person. Record records a payment as planned; a different or partial
 * payment opens the repayment form.
 */
export function SettleUp(props: { app: MemberListApp }) {
  const person = useUiState().person;
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const repayment = useRepaymentForm();
  const record = useActionCall();

  if (!snapshot || !replica) return null;
  const you = preferredMember(snapshot, replica.session?.identity.id)?.id;
  const label = (memberId: string) => (memberId === you ? 'You' : memberName(snapshot, memberId));
  const payments = person ? memberSettlements(snapshot, person) : settlementSuggestions(snapshot);
  // A different payment starts from the person, or from you for the whole group.
  const from = person ?? you ?? repaymentMembers(snapshot)[0]?.id ?? '';
  const other = you && you !== from ? you : repaymentMembers(snapshot).find((member) => member.id !== from)?.id ?? '';

  return (
    <View style={{ paddingTop: 16, paddingBottom: 34 }}>
      <View role="list" aria-label="Payments">
        {payments.map((entry) => {
          const payer = label(entry.from_member_id);
          const payee = label(entry.to_member_id);
          const amount = formatAmount(entry.amount, entry.currency);

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
        <View style={s.ruled} />
      </View>
      <ErrorMessage message={record.error} />

      <View style={{ alignItems: 'flex-start', paddingTop: 12 }}>
        <Pressable
          accessibilityRole="button"
          disabled={repayment.action.busy || !from || !other}
          onPress={() => {
            const owes = payments.find((entry) => entry.from_member_id === from || entry.to_member_id === from);

            repayment.open({ from, to: owes ? (owes.from_member_id === from ? owes.to_member_id : owes.from_member_id) : other, amount: owes ? formatAmount(owes.amount, owes.currency) : '', currency: owes?.currency ?? noCurrency, manual: true });
          }}
          style={({ pressed }) => [{ height: 44, justifyContent: 'center' }, pressed && s.pressed, (!from || !other) && s.dim]}
        >
          <Text style={[s.headerActionText, s.link]}>Record a different payment</Text>
        </Pressable>
      </View>
      <ErrorMessage message={repayment.action.error} />
    </View>
  );
}
