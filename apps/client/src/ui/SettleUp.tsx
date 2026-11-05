import { ScrollView, View } from 'react-native';
import { memberSettlements, preferredMember, settlementSuggestions } from '@splitnext/client';
import { Button, EmptyState, ErrorMessage, Row, Text, rules, sizes } from '../design';
import { memberName, moneyLabel } from '../model/expenses';
import { FooterDrawer } from './FooterDrawer';
import type { MemberListApp } from './MemberList';
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
            <Button
             
              label={`Settle up, ${count === 1 ? '1 payment' : `${count} payments`}`}
              disabled={!settle.can('showSettleUp', person ? { memberId: person } : {})}
              onPress={() => { void settle.call('showSettleUp', person ? { memberId: person } : {}); }}
            >
              Settle up
            </Button>
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
          const payment = { from: entry.from_member_id, to: entry.to_member_id, amount, currency: entry.currency };

          return (
            // Who pays, who is paid, and the amount share a line while they fit and wrap
            // between them when not, a name too long for a line truncating; Record never gives way.
            <Row key={`${entry.currency}:${entry.from_member_id}:${entry.to_member_id}`} gap={12} paddingY={12} style={[{ minHeight: sizes.row }, rules.above]}>
              <Row fill wrap align="baseline" style={{ columnGap: 8 }}>
                <Text numberOfLines={1} variant="strong" style={{ maxWidth: '100%' }}>{payer}</Text>
                <Text numberOfLines={1} variant="strong" style={{ maxWidth: '100%' }}>→ {payee === 'You' ? 'you' : payee}</Text>
                <Text numberOfLines={1} variant="figure" style={{ maxWidth: '100%' }}>{amount}</Text>
              </Row>
              <Button
                size="compact"
                label={`${payer} ${payer === 'You' ? 'pay' : 'pays'} ${payee === 'You' ? 'you' : payee} ${moneyLabel(entry.amount, entry.currency)}. Record this payment`}
                disabled={record.busy || !record.can('recordSettlement', payment)}
                onPress={() => { void record.call('recordSettlement', payment); }}
                style={{ flexShrink: 0 }}
              >
                Record
              </Button>
            </Row>
          );
        })}
        {!payments.length ? <EmptyState tone="settled" title={person ? 'Settled' : 'Everyone is settled up'} /> : null}
      </View>
      <ErrorMessage message={record.error} />
    </View>
  );
}
