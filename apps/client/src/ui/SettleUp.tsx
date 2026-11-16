import { useState } from 'react';
import { View } from 'react-native';
import { formatAmount, memberSettlements, preferredMember, settlementSuggestions } from '@splitnext/client';
import { Button, ChevronDownIcon, ChevronUpIcon, EmptyState, ErrorMessage, Row, Stack, Text, Touchable, colors, rules, sizes } from '../design';
import { memberName, moneyLabel } from '../model/expenses';
import { MemberAvatar, type MemberListApp, type Replica } from './MemberList';
import { useActionCall } from './useActionCall';

/** The payments to settle: one person's, or the whole group's plan. */
function plannedPayments(app: MemberListApp, person: string | null) {
  const replica = app.snapshot().group;
  const snapshot = replica?.projected_snapshot;

  if (!snapshot || !replica) return null;
  const you = preferredMember(snapshot, replica.session?.identity.id)?.id;

  return { snapshot, you, payments: person ? memberSettlements(snapshot, person) : settlementSuggestions(snapshot) };
}

/** One payment of the plan as people say it, with Record, which records it as planned. */
function PlanPayment(props: { replica: Replica; you: string | undefined; from: string; to: string; amount: number; currency: string; quiet?: boolean }) {
  const record = useActionCall();
  const snapshot = props.replica.projected_snapshot;
  const name = (memberId: string) => (memberId === props.you ? 'You' : memberName(snapshot, memberId));
  const payer = name(props.from);
  const payee = name(props.to);
  const mine = props.from === props.you || props.to === props.you;
  // Your own payments name only the other person: “You pay Ben”, “Ben pays you”.
  const other = props.from === props.you ? props.to : props.from;
  const amount = moneyLabel(props.amount, props.currency);
  const payment = { from: props.from, to: props.to, amount: formatAmount(props.amount, props.currency), currency: props.currency };

  return (
    <View>
      <Row gap={12} style={[{ minHeight: sizes.row, paddingVertical: 8 }, rules.above]}>
        {mine ? <MemberAvatar replica={props.replica} memberId={other} /> : null}
        {/* The name goes first, on its own line, so a long one cannot push out what the payment is. */}
        <Stack fill gap={2}>
          <Text numberOfLines={1} variant="strong">{mine ? name(other) : payer}</Text>
          <Text numberOfLines={1} variant="caption" tone="muted">{props.from === props.you ? 'You pay' : props.to === props.you ? 'Pays you' : `→ ${payee}`}</Text>
        </Stack>
        <Text numberOfLines={1} variant="figure">{amount}</Text>
        <Button
          size="compact"
          variant={props.quiet ? 'secondary' : 'primary'}
          label={`${payer} ${payer === 'You' ? 'pay' : 'pays'} ${payee === 'You' ? 'you' : payee} ${amount}. Record this payment`}
          disabled={record.busy || !record.can('recordSettlement', payment)}
          onPress={() => { void record.call('recordSettlement', payment); }}
        >
          Record
        </Button>
      </Row>
      <ErrorMessage message={record.error} />
    </View>
  );
}

/**
 * The group's settle-up page: the payments of the plan that are yours, first,
 * and everyone else's folded into one line until opened.
 */
export function SettleUpPlan(props: { app: MemberListApp }) {
  const [others, setOthers] = useState(false);
  const replica = props.app.snapshot().group;
  const plan = plannedPayments(props.app, null);

  if (!plan || !replica) return null;
  const { you, payments } = plan;
  const yours = payments.filter((entry) => entry.from_member_id === you || entry.to_member_id === you);
  const rest = payments.filter((entry) => entry.from_member_id !== you && entry.to_member_id !== you);

  const row =(entry: (typeof payments)[number], quiet: boolean) => (
    <PlanPayment key={`${entry.currency}:${entry.from_member_id}:${entry.to_member_id}`} replica={replica} you={you} from={entry.from_member_id} to={entry.to_member_id} amount={entry.amount} currency={entry.currency} quiet={quiet} />
  );

  if (!payments.length) return <EmptyState tone="settled" title="Everyone is settled up" />;

  return (
    <View role="list" aria-label="Payments" style={{ paddingTop: 8 }}>
      <Text accessibilityRole="header" variant="meta" weight="semibold" tone="muted" style={{ paddingBottom: 4 }}>Yours</Text>
      {yours.length ? yours.map((entry) => row(entry, false)) : <Text variant="body" tone="owed" style={[{ paddingVertical: 12 }, rules.above]}>✓ You’re settled</Text>}
      {rest.length ? (
        <>
          <Touchable
            accessibilityRole="button"
            accessibilityState={{ expanded: others }}
            aria-expanded={others}
            onPress={() => setOthers(!others)}
            style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: sizes.row, marginTop: 16 }, rules.above]}
          >
            <Text variant="body" weight="semibold" tone="muted" style={{ flex: 1 }}>{`Everyone else’s ${rest.length === 1 ? 'payment' : `${rest.length} payments`}`}</Text>
            {others ? <ChevronUpIcon size={16} color={colors.faint} /> : <ChevronDownIcon size={16} color={colors.faint} />}
          </Touchable>
          {others ? rest.map((entry) => row(entry, true)) : null}
        </>
      ) : null}
    </View>
  );
}
