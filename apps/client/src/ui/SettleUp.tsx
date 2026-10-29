import { Pressable, ScrollView, Text, View } from 'react-native';
import { memberSettlements, preferredMember, settlementSuggestions } from '@splitnext/client';
import { memberName, moneyLabel } from '../model/expenses';
import { ErrorMessage, FooterButton, colors, s } from './components';
import { FooterDrawer } from './FooterDrawer';
import type { MemberListApp } from './MemberList';
import { fontFamily, monoFamily } from './theme';
import { useScreenSize } from './screenHost';
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
 * group, and gives way to it while it is open.
 */
export function SettleUpFooter(props: { app: MemberListApp }) {
  const ui = useUiState();
  const person = ui.person;
  const open = ui.view === 'settle';
  const settle = useActionCall();
  const back = useActionCall();
  const { height } = useScreenSize();
  const plan = plannedPayments(props.app, person);

  // Settled people have nothing to open, unless it is already open and showing ✓ Settled.
  if (!plan || (!plan.payments.length && !open)) return null;
  const { snapshot, payments } = plan;
  const count = payments.length;

  return (
    <FooterDrawer
      open={open}
      title="Settle up"
      closeLabel={person ? `Back to ${memberName(snapshot, person)}` : 'Back to group'}
      closeText="Close"
      onClose={() => { void back.call('closePanel', {}); }}
      footer={(
        <>
          <ErrorMessage message={settle.error ?? back.error} />
          {open ? null : (
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

const nameStyle = { fontFamily, fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.ink } as const;

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
            // Who pays, who is paid, and the amount share a line while they fit and wrap
            // between them when not, a name too long for a line truncating; Record never gives way.
            <View key={`${entry.currency}:${entry.from_member_id}:${entry.to_member_id}`} style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }, s.ruled]}>
              <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 }}>
                <Text numberOfLines={1} style={[nameStyle, { maxWidth: '100%' }]}>{payer}</Text>
                <Text numberOfLines={1} style={[nameStyle, { maxWidth: '100%' }]}>→ {payee === 'You' ? 'you' : payee}</Text>
                <Text numberOfLines={1} style={{ maxWidth: '100%', fontFamily: monoFamily, fontSize: 17, lineHeight: 22, fontWeight: '500', color: colors.ink }}>{amount}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${payer} ${payer === 'You' ? 'pay' : 'pays'} ${payee === 'You' ? 'you' : payee} ${moneyLabel(entry.amount, entry.currency)}. Record this payment`}
                disabled={record.busy || !record.can('recordSettlement', { from: entry.from_member_id, to: entry.to_member_id, amount, currency: entry.currency })}
                onPress={() => { void record.call('recordSettlement', { from: entry.from_member_id, to: entry.to_member_id, amount, currency: entry.currency }); }}
                style={({ pressed }) => [{ flexShrink: 0, height: 44, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: colors.action }, pressed && s.pressed]}
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
