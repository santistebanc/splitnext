import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { memberHasRecords, memberSettlements, participantsForMember, preferredMember } from '@splitnext/client';
import { memberBreakdown } from '../model/breakdown';
import { balanceRows, memberName } from '../model/expenses';
import { participantMarkers } from '../model/memberPresentation';
import { BackButton, BalanceBar, Button, ErrorMessage, FooterButton, ListRow, Notice, ScreenHeader, balanceColor, colors, s, signedFigure, titleStyle } from './components';
import { repaymentTitle } from './ExpenseList';
import { PencilIcon } from './icons';
import { MemberIcon, MemberNameInput, presenceText, type MemberListApp } from './MemberList';
import { between, useCompactProgress } from './pageScroll';
import { fontFamily, monoFamily } from './theme';
import { morph } from './ScreenMorph';
import { useActionCall, useUiState } from './useActionCall';

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
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <Text style={[s.caption, { fontSize: 15 }]}>{props.label}</Text>
        <Text ref={morph(props.morph)} style={{ fontFamily: monoFamily, fontSize: props.size, lineHeight: props.size, fontWeight: '500', letterSpacing: -0.03 * props.size, color: balanceColor(props.amount) }}>
          {signedFigure(props.amount, props.currency)}
        </Text>
      </View>
      <BalanceBar track amount={props.amount} max={props.max} height={props.bar} morph={props.barMorph} />
    </View>
  );
}

/**
 * The person's fixed top: back to the group, their name, which the pencil
 * edits in place, This is me, and their balance as a figure over its bar.
 */
export function PersonHeader(props: { app: MemberListApp }) {
  const ui = useUiState();
  const progress = useCompactProgress();
  const back = useActionCall();
  const save = useActionCall();
  const edit = useActionCall();
  const claim = useActionCall();
  const state = props.app.snapshot();
  const replica = state.group;
  const snapshot = replica?.projected_snapshot;
  const group = snapshot?.group.name ?? '';
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

  function finishRename(): void {
    if (save.can('saveMemberEdit')) void save.call('saveMemberEdit', {});
  }

  const label = !first ? (recorded ? 'Settled' : 'No expenses yet') : first.amount > 0 ? 'Gets back' : first.amount < 0 ? 'Owes' : 'Settled';

  return (
    <>
      <ScreenHeader
        start={<BackButton label={`Back to ${group}`} text={group} disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
        heading={(
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {renaming ? (
              <MemberNameInput
                name={ui.memberEdit?.name ?? ''}
                placeholder="Name"
                autoFocus
                onSave={finishRename}
                style={[titleStyle(progress), { flex: 1, minWidth: 0, paddingBottom: 4, borderBottomWidth: 1.5, borderColor: colors.ink }]}
              />
            ) : (
              <>
                <Text ref={morph(replica && memberId ? `pname-${replica.group_id}-${memberId}` : null)} accessibilityRole="header" numberOfLines={1} style={[titleStyle(progress), { flexShrink: 1 }]}>{name}</Text>
                {isYou ? <Text style={{ fontFamily, fontSize: 15, fontWeight: '500', color: colors.muted }}>you</Text> : null}
                {active && memberId ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${name}`}
                    disabled={!edit.can('beginEditMember', { memberId })}
                    onPress={() => { void edit.call('beginEditMember', { memberId }); }}
                    style={({ pressed }) => [{ marginLeft: 'auto', marginRight: -12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, !edit.can('beginEditMember', { memberId }) && s.dim]}
                  >
                    <PencilIcon size={18} color={colors.ink} />
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        )}
        below={(
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: between(8, 2, progress) }}>
              <MemberIcon participants={participants} size={6} />
              <Text style={[s.caption, { flexShrink: 1 }]}>{active ? presenceText(participants) : 'Removed · still in balances until settled'}</Text>
              {/* Taking the name sits beside whether anyone has taken it. */}
              {active && memberId && !isYou ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`I’m ${name}`}
                  disabled={!claim.can('setPreferredMember', { memberId })}
                  onPress={() => { void claim.call('setPreferredMember', { memberId }); }}
                  hitSlop={{ top: 8, bottom: 8 }}
                  style={({ pressed }) => [{ marginLeft: 'auto', height: 28, justifyContent: 'center', paddingLeft: 12 }, pressed && s.pressed]}
                >
                  <Text style={[s.headerActionText, s.link, { fontSize: 14 }]}>This is me</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={{ paddingTop: between(18, 8, progress) }}>
              <BalanceFigure amount={first?.amount ?? 0} currency={first?.currency ?? 'XXX'} max={largestBalance(snapshot)} label={label} size={between(30, 20, progress)} bar={between(12, 8, progress)} morph={replica && memberId && first ? (isYou ? `gamt-${replica.group_id}-${first.currency}` : `pamt-${replica.group_id}-${memberId}-${first.currency}`) : null} barMorph={replica && memberId && first ? (isYou ? `gbar-${replica.group_id}-${first.currency}` : `pbar-${replica.group_id}-${memberId}-${first.currency}`) : null} />
            </View>
          </View>
        )}
      />
      <ErrorMessage message={back.error ?? save.error ?? edit.error ?? claim.error} />
    </>
  );
}

/** Settle up, pinned at the foot while the person is in a payment of the group's plan. */
export function PersonFooter(props: { app: MemberListApp }) {
  const settle = useActionCall();
  const memberId = useUiState().person;
  const snapshot = props.app.snapshot().group?.projected_snapshot;

  if (!memberId || !snapshot) return null;
  const payments = memberSettlements(snapshot, memberId).length;

  if (!payments) return null;

  return (
    <>
      <ErrorMessage message={settle.error} />
      <FooterButton
        morph={`settle-${memberId}`}
        label={`Settle up, ${payments === 1 ? '1 payment' : `${payments} payments`}`}
        disabled={!settle.can('showSettleUp', { memberId })}
        onPress={() => { void settle.call('showSettleUp', { memberId }); }}
      >
        Settle up
      </FooterButton>
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
  const [claimedBefore] = useState(() => (member ? preferredMember(snapshot, replica?.session?.identity.id)?.id === member.id : false));

  if (!replica || !snapshot || !member || !memberId) return null;
  const identity = replica.session?.identity.id;
  const you = preferredMember(snapshot, identity)?.id;
  const isYou = member.id === you;
  const active = member.status === 'active';
  const name = memberName(snapshot, member.id);
  const others = participantsForMember(snapshot, member.id).filter((grant) => grant.identity_id !== identity).length;
  const breakdown = memberBreakdown(snapshot, member.id, (id) => (id === you ? 'You' : memberName(snapshot, id)));
  // Only someone no expense or repayment has named, removed ones included, can be removed here.
  const hasRecords = memberHasRecords(snapshot, member.id);

  return (
    <View style={{ gap: 22, paddingTop: 12, paddingBottom: 12 }}>
      {isYou && !claimedBefore && others ? (
        <Notice
          tone="warning"
          role="status"
          message={`${name} is already taken on ${others === 1 ? 'another device' : `${others} other devices`}. It’s now taken on this device too.`}
        />
      ) : null}
      {active ? (
        hasRecords ? null : (
          <Button secondary label={`Remove ${name}`} disabled={!remove.can('removeMember', { memberId: member.id })} onPress={() => { void remove.call('removeMember', { memberId: member.id }); }}>
            Remove
          </Button>
        )
      ) : (
        <Button secondary label={`Restore ${name}`} disabled={!restore.can('restoreMember', { memberId: member.id })} onPress={() => { void restore.call('restoreMember', { memberId: member.id }); }}>
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
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text numberOfLines={1} style={s.name}>{title}</Text>
                  <Text numberOfLines={1} style={s.rowCaption}>{row.detail}</Text>
                </View>
                <Text style={[s.amount, { color: balanceColor(row.amount) }]}>{signedFigure(row.amount, group.currency)}</Text>
              </ListRow>
            );
          })}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderTopWidth: 1.5, borderColor: colors.ink }}>
            <Text style={{ flex: 1, fontFamily, fontSize: 15, fontWeight: '600', color: colors.ink }}>Balance</Text>
            <Text style={[s.amount, { color: balanceColor(group.total) }]}>{signedFigure(group.total, group.currency)}</Text>
          </View>
        </View>
      ))}
      <ErrorMessage message={open.error} />
    </View>
  );
}
