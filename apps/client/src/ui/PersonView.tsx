import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { memberHasRecords, preferredMember } from '@splitnext/client';
import { BalanceBar, Button, ErrorMessage, IconButton, ListRow, PencilIcon, Row, Stack, Text, between, figureStyle, rules, sizes, titleStyle } from '../design';
import { memberBreakdown } from '../model/breakdown';
import { balanceRows, memberName } from '../model/expenses';
import { participantMarkers } from '../model/memberPresentation';
import { balanceColor, signedFigure } from './balance';
import { EditCover } from './EditCover';
import { ActivityLink } from './GroupView';
import { TitleField } from './TitleField';
import { repaymentTitle } from './ExpenseList';
import { MemberIcon, presenceText, type MemberListApp } from './MemberList';
import { useCompactProgress } from './pageScroll';
import { BackButton, ScreenHeader } from './ScreenHeader';
import { morph } from './ScreenMorph';
import { useActionCall, useActions, useUiState } from './useActionCall';

/** A person's balance in each recorded currency, settled zeros included. */
function personBalances(snapshot: Parameters<typeof balanceRows>[0] | undefined, memberId: string) {
  return balanceRows(snapshot).flatMap(({ currency, rows }) => {
    const row = rows.find((entry) => entry.member.id === memberId);

    return row ? [{ currency, amount: row.amount }] : [];
  });
}

/** The largest balance anyone in the group has, the bar's full width. */
function largestBalance(snapshot: Parameters<typeof balanceRows>[0] | undefined): number {
  return Math.max(0, ...balanceRows(snapshot).flatMap(({ rows }) => rows.map((row) => Math.abs(row.amount))));
}

/** A balance as a large figure over its bar, with what it means beside it. */
export function BalanceFigure(props: { amount: number; currency: string; max: number; label: string; size: number; bar: number; morph?: string | null; barMorph?: string | null }) {
  return (
    <Stack gap={12}>
      <Row gap={12} align="end" justify="between">
        <Text variant="body" tone="muted">{props.label}</Text>
        <Text ref={morph(props.morph, { unclipped: true })} numberOfLines={1} color={balanceColor(props.amount)} style={figureStyle(props.size)}>
          {signedFigure(props.amount, props.currency)}
        </Text>
      </Row>
      <BalanceBar track amount={props.amount} max={props.max} height={props.bar} stripRef={morph(props.barMorph, { stretch: true })} />
    </Stack>
  );
}

/**
 * The person's fixed top: back to the group, their name, which the pencil
 * edits in place, whether it is taken, and their balance as a figure over its
 * bar. Who is you changes only by leaving the group and rejoining as them.
 */
export function PersonHeader(props: { app: MemberListApp }) {
  const ui = useUiState();
  const progress = useCompactProgress();
  const back = useActionCall();
  const save = useActionCall();
  const edit = useActionCall();
  const state = props.app.snapshot();
  const replica = state.group;
  const snapshot = replica?.projected_snapshot;
  const group = snapshot?.group.name ?? '';
  const backTo = ui.trail.at(-1) === 'activity' ? 'Activity' : group;
  const memberId = ui.person;
  const member = snapshot?.members.find((entry) => entry.id === memberId);
  const name = memberId ? memberName(snapshot, memberId) : '';
  const renaming = Boolean(memberId) && ui.memberEdit?.memberId === memberId;
  const you = preferredMember(snapshot, replica?.session?.identity.id)?.id;
  const isYou = Boolean(memberId) && memberId === you;
  const active = member?.status === 'active';
  const balances = memberId ? personBalances(snapshot, memberId) : [];
  const first = balances[0];
  const recorded = memberId && snapshot ? memberBreakdown(snapshot, memberId).length > 0 : false;
  const participants = replica && memberId ? participantMarkers(replica, memberId, props.app.client.presence(replica.group_id), state.online && state.reachable) : [];

  const nameField = useRef<TextInput>(null);
  const [youWidth, setYouWidth] = useState(0);
  const actions = useActions();

  function finishRename(): void {
    if (save.can('saveMemberEdit')) void save.call('saveMemberEdit', {});
  }

  const label = !first ? (recorded ? 'Settled' : 'No expenses yet') : first.amount > 0 ? 'Gets back' : first.amount < 0 ? 'Owes' : 'Settled';

  return (
    <>
      <ScreenHeader
        start={<BackButton label={`Back to ${backTo}`} text={backTo} disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
        end={<ActivityLink app={props.app} />}
        heading={(
          <Row fill gap={12}>
            {renaming ? (
              <TitleField
                inputRef={nameField}
                accessibilityLabel="Name"
                placeholder="Name"
                value={ui.memberEdit?.name ?? ''}
                onChangeText={(value) => { void actions.dispatch('changeDraft', { field: 'member.name', value }, { origin: 'ui' }); }}
                maxLength={100}
                onBlur={finishRename}
                // What follows the name: you and a gap, then a gap and the pencil, 44 wide with 12 past the edge.
                inset={(isYou ? youWidth + 10 : 0) + 10 + 32}
                style={{ ...titleStyle(progress), paddingBottom: 4, ...rules.inkBelow }}
              />
            ) : (
              <>
                <Text ref={morph(replica && memberId ? `pname-${replica.group_id}-${memberId}` : null)} accessibilityRole="header" numberOfLines={2} style={[titleStyle(progress), { flexShrink: 1 }]}>{name}</Text>
                {isYou ? <Text onLayout={(event) => setYouWidth(event.nativeEvent.layout.width)} variant="body" tone="muted">you</Text> : null}
                {active && memberId && progress <= 0.5 ? (
                  <IconButton label={`Rename ${name}`} disabled={!edit.can('beginEditMember', { memberId })} onPress={() => { void edit.call('beginEditMember', { memberId }); }} style={{ marginLeft: 'auto', marginRight: -12, opacity: Math.max(0, 1 - 2 * progress) }}>
                    <PencilIcon size={18} />
                  </IconButton>
                ) : null}
              </>
            )}
          </Row>
        )}
        // The header ends at the balance bar's edge.
        flush
        below={(
          <Stack gap={8}>
            <Row gap={8} style={{ paddingTop: between(8, 2, progress) }}>
              <MemberIcon participants={participants} />
              <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>{active ? presenceText(participants) : 'Removed · still in balances until settled'}</Text>
            </Row>
            <View style={{ paddingTop: between(18, 8, progress) }}>
              <BalanceFigure amount={first?.amount ?? 0} currency={first?.currency ?? 'XXX'} max={largestBalance(snapshot)} label={label} size={between(30, 20, progress)} bar={between(12, 8, progress)} morph={replica && memberId && first ? (isYou ? `gamt-${replica.group_id}-${first.currency}` : `pamt-${replica.group_id}-${memberId}-${first.currency}`) : null} barMorph={replica && memberId && first ? (isYou ? `gbar-${replica.group_id}-${first.currency}` : `pbar-${replica.group_id}-${memberId}-${first.currency}`) : null} />
            </View>
          </Stack>
        )}
      />
      <EditCover open={renaming} target={nameField} onPress={() => nameField.current?.blur()} />
      <ErrorMessage message={back.error ?? save.error ?? edit.error} />
    </>
  );
}

/**
 * Below the person's balance: Remove while no expense or repayment names
 * them, Restore once removed, and every expense and repayment their balance
 * is made of.
 */
export function PersonDetails(props: { app: MemberListApp }) {
  const ui = useUiState();
  const state = props.app.snapshot();
  const replica = state.group;
  const snapshot = replica?.projected_snapshot;
  const memberId = ui.person;
  const member = snapshot?.members.find((entry) => entry.id === memberId);
  const remove = useActionCall();
  const restore = useActionCall();
  const open = useActionCall();

  if (!replica || !snapshot || !member || !memberId) return null;
  const identity = replica.session?.identity.id;
  const you = preferredMember(snapshot, identity)?.id;
  const isYou = member.id === you;
  const active = member.status === 'active';
  const name = memberName(snapshot, member.id);
  const breakdown = memberBreakdown(snapshot, member.id, (id) => (id === you ? 'You' : memberName(snapshot, id)));
  // Only someone else no expense or repayment has named, removed ones included, can be removed here.
  const hasRecords = memberHasRecords(snapshot, member.id);

  return (
    <Stack gap={24} paddingY={12}>
      {active ? (
        hasRecords || isYou ? null : (
          <Button variant="secondary" label={`Remove ${name}`} disabled={!remove.can('removeMember', { memberId: member.id })} onPress={() => { void remove.call('removeMember', { memberId: member.id }); }}>
            Remove
          </Button>
        )
      ) : (
        <Button variant="secondary" label={`Restore ${name}`} disabled={!restore.can('restoreMember', { memberId: member.id })} onPress={() => { void restore.call('restoreMember', { memberId: member.id }); }}>
          Restore
        </Button>
      )}
      <ErrorMessage message={remove.error ?? restore.error} />

      {breakdown.map((group) => (
        <View key={group.currency} role="list" aria-label="Expenses and repayments" style={{ paddingTop: 12 }}>
          {group.rows.map((row) => {
            const title = row.kind === 'expense' ? row.title : repaymentTitle(replica, { from_member_id: row.from, to_member_id: row.to });

            return (
              <ListRow
                key={row.id}
                label={`${title}, ${signedFigure(row.amount, group.currency)}`}
                disabled={row.kind === 'expense' ? !open.can('showExpense', { expenseId: row.id }) : !open.can('showSettlement', { settlementId: row.id })}
                onPress={() => {
                  if (row.kind === 'expense') void open.call('showExpense', { expenseId: row.id });
                  else void open.call('showSettlement', { settlementId: row.id });
                }}
              >
                <Stack fill gap={4} align="start">
                  <Text ref={morph(row.kind === 'expense' ? `etitle-${row.id}` : null)} numberOfLines={2} variant="strong" style={{ maxWidth: '100%' }}>{title}</Text>
                  <Text numberOfLines={1} variant="caption" tone="muted" style={{ maxWidth: '100%' }}>{row.detail}</Text>
                </Stack>
                <Text ref={morph(row.kind === 'expense' ? `eamt-${row.id}` : null, { unclipped: true })} numberOfLines={1} variant="figure" color={balanceColor(row.amount)}>{signedFigure(row.amount, group.currency)}</Text>
              </ListRow>
            );
          })}
          <Row gap={12} style={[{ minHeight: sizes.row }, rules.inkAbove]}>
            <Text variant="strong" style={{ flex: 1 }}>Balance</Text>
            <Text numberOfLines={1} variant="figure" color={balanceColor(group.total)}>{signedFigure(group.total, group.currency)}</Text>
          </Row>
        </View>
      ))}
      <ErrorMessage message={open.error} />
    </Stack>
  );
}
