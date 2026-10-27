import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { memberHasRecords, memberSettlements, participantsForMember, preferredMember } from '@splitnext/client';
import { memberBreakdown } from '../model/breakdown';
import { balanceRows, memberName } from '../model/expenses';
import { participantMarkers } from '../model/memberPresentation';
import { BackHeader } from './BackHeader';
import { ErrorMessage, balanceColor, colors, s, signedFigure, signedMoney } from './components';
import { repaymentTitle } from './ExpenseList';
import { ChevronRightIcon, PencilIcon, PersonIcon, TrashIcon, UndoIcon, WarningIcon } from './icons';
import { MemberIcon, MemberNameInput, presenceText, type MemberListApp } from './MemberList';
import { fontFamily, monoFamily } from './theme';
import { useActionCall, useUiState } from './useActionCall';

/** The person details header: back to the group, the group named quietly above the person's name, which Rename edits in place. */
export function PersonHeader(props: { app: MemberListApp }) {
  const ui = useUiState();
  const save = useActionCall();
  const snapshot = props.app.snapshot().group?.projected_snapshot;
  const group = snapshot?.group.name ?? '';
  const name = ui.person ? memberName(snapshot, ui.person) : '';
  const renaming = Boolean(ui.person) && ui.memberEdit?.memberId === ui.person;

  function finishRename(): void {
    if (save.can('saveMemberEdit')) void save.call('saveMemberEdit', {});
  }

  return (
    <BackHeader
      context={group}
      error={save.error}
      title={name}
      heading={renaming ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MemberNameInput
            name={ui.memberEdit?.name ?? ''}
            placeholder="Name"
            autoFocus
            onSave={finishRename}
            style={[s.screenTitle, { flex: 1, minWidth: 0, height: 36, paddingHorizontal: 8, borderRadius: 10, borderWidth: 2, borderColor: colors.action, backgroundColor: colors.surface }]}
          />
          <Pressable
            accessibilityRole="button"
            onPress={finishRename}
            style={({ pressed }) => [{ height: 36, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.action, justifyContent: 'center' }, pressed && s.pressed]}
          >
            <Text style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.actionInk }}>Done</Text>
          </Pressable>
        </View>
      ) : undefined}
    />
  );
}

function money(amount: number) {
  return { fontFamily: monoFamily, fontWeight: '600', color: balanceColor(amount) } as const;
}

/** One of the three actions under Settle up. */
function Tile(props: { icon: ReactNode; text: string; label?: string; danger?: boolean; pressed?: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label ?? props.text}
      accessibilityState={{ disabled: props.disabled, selected: props.pressed }}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        { flex: 1, minHeight: 64, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
        props.pressed && { backgroundColor: colors.youRow },
        (pressed || props.disabled) && s.dim,
      ]}
    >
      {props.icon}
      <Text numberOfLines={1} style={{ fontFamily, fontSize: 13, fontWeight: '600', color: props.danger ? colors.owes : colors.ink }}>{props.text}</Text>
    </Pressable>
  );
}

/**
 * A person's details, under their name in the header: their presence, their balance per currency,
 * Settle up, renaming, choosing them as you on this device, removing them,
 * and every expense and repayment their balance is made of.
 */
export function PersonDetails(props: { app: MemberListApp }) {
  const ui = useUiState();
  const state = props.app.snapshot();
  const replica = state.group;
  const snapshot = replica?.projected_snapshot;
  const memberId = ui.person;
  const member = snapshot?.members.find((entry) => entry.id === memberId);
  const edit = useActionCall();
  const claim = useActionCall();
  const remove = useActionCall();
  const restore = useActionCall();
  const settle = useActionCall();
  const open = useActionCall();
  const [claimed, setClaimed] = useState<string | null>(null);

  if (!replica || !snapshot || !member || !memberId) return null;
  const identity = replica.session?.identity.id;
  const you = preferredMember(snapshot, identity)?.id;
  const isYou = member.id === you;
  const active = member.status === 'active';
  const name = memberName(snapshot, member.id);
  const renaming = ui.memberEdit?.memberId === member.id;
  const participants = participantMarkers(replica, member.id, props.app.client.presence(replica.group_id), state.online && state.reachable);
  const others = participantsForMember(snapshot, member.id).filter((grant) => grant.identity_id !== identity).length;

  const balances = balanceRows(snapshot).flatMap(({ currency, rows }) => {
    const row = rows.find((entry) => entry.member.id === member.id);

    return row ? [{ currency, amount: row.amount }] : [];
  });

  const unsettled = balances.some(({ amount }) => amount !== 0);
  const payments = memberSettlements(snapshot, member.id).length;
  const breakdown = memberBreakdown(snapshot, member.id, (id) => (id === you ? 'You' : memberName(snapshot, id)));
  // Taking out someone any expense or repayment has named, removed ones included, hides them for history; anyone else is removed.
  const hides = memberHasRecords(snapshot, member.id);

  return (
    <View style={{ gap: 18, paddingBottom: 32 }}>
      <View style={{ gap: 6, paddingHorizontal: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MemberIcon participants={participants} size={10} />
          <Text style={{ fontFamily, fontSize: 14, color: colors.soft }}>{active ? presenceText(participants) : 'Removed · still in balances until settled'}</Text>
        </View>
        <ErrorMessage message={edit.error} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {balances.length ? balances.map(({ currency, amount }) => (
          <View key={currency} style={{ flexGrow: 1, flexBasis: '45%', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.surface, gap: 2 }}>
            <Text style={{ fontFamily, fontSize: 13, fontWeight: '600', color: colors.muted }}>{amount > 0 ? 'Gets back' : amount < 0 ? 'Owes' : 'Settled'} · {currency}</Text>
            <Text style={[money(amount), { fontSize: 22 }]}>{signedFigure(amount, currency)}</Text>
          </View>
        )) : (
          <View style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.surface, gap: 2 }}>
            <Text style={{ fontFamily, fontSize: 13, fontWeight: '600', color: colors.muted }}>Balance</Text>
            {breakdown.length ? (
              <Text style={{ fontFamily, fontSize: 18, fontWeight: '600', color: colors.settled }}>Settled</Text>
            ) : (
              <Text style={{ fontFamily, fontSize: 18, fontWeight: '600', color: colors.muted }}>No expenses yet</Text>
            )}
          </View>
        )}
        {/* Beside what they owe or get back, as tall as it. */}
        {payments ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Settle up, ${payments === 1 ? '1 payment' : `${payments} payments`}`}
            disabled={!settle.can('showSettleUp', { memberId: member.id })}
            onPress={() => { void settle.call('showSettleUp', { memberId: member.id }); }}
            style={({ pressed }) => [{ flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingVertical: 12, paddingLeft: 16, paddingRight: 12, borderRadius: 16, backgroundColor: colors.action }, pressed && s.pressed]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.actionInk }}>Settle up</Text>
              <Text style={{ fontFamily, fontSize: 13, fontWeight: '500', color: '#d6e6ff' }}>{payments === 1 ? '1 payment' : `${payments} payments`}</Text>
            </View>
            <ChevronRightIcon size={18} color={colors.actionInk} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
      <ErrorMessage message={settle.error} />

      <View style={{ gap: 8 }}>
        {active ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Tile
              icon={<PencilIcon />}
              text="Rename"
              label={`Rename ${name}`}
              disabled={renaming || !edit.can('beginEditMember', { memberId: member.id })}
              onPress={() => { void edit.call('beginEditMember', { memberId: member.id }); }}
            />
            <Tile
              icon={<PersonIcon />}
              text={isYou ? 'That’s you' : `I’m ${name}`}
              pressed={isYou}
              disabled={isYou || !claim.can('setPreferredMember', { memberId: member.id })}
              onPress={() => {
                void claim.call('setPreferredMember', { memberId: member.id }, () => setClaimed(member.id));
              }}
            />
            <Tile
              icon={<TrashIcon color={unsettled ? colors.faint : colors.owes} />}
              text={hides ? 'Hide' : 'Remove'}
              label={`${hides ? 'Hide' : 'Remove'} ${name}`}
              danger={!unsettled}
              disabled={!remove.can('removeMember', { memberId: member.id })}
              onPress={() => { void remove.call('removeMember', { memberId: member.id }); }}
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Tile
              icon={<UndoIcon size={20} />}
              text="Restore"
              label={`Restore ${name}`}
              disabled={!restore.can('restoreMember', { memberId: member.id })}
              onPress={() => { void restore.call('restoreMember', { memberId: member.id }); }}
            />
          </View>
        )}
        {isYou && claimed === member.id && others ? (
          <View role="status" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.warning }}>
            <WarningIcon color={colors.warningInk} />
            <Text style={{ flex: 1, fontFamily, fontSize: 14, lineHeight: 20, color: colors.warningInk }}>
              {name} is already taken on {others === 1 ? 'another device' : `${others} other devices`}. It’s now taken on this device too.
            </Text>
          </View>
        ) : null}
        {active && unsettled ? (
          <Text style={{ paddingHorizontal: 4, fontFamily, fontSize: 13, color: colors.muted }}>Settle up first to hide {isYou ? 'yourself' : name}.</Text>
        ) : null}
        <ErrorMessage message={claim.error ?? remove.error ?? restore.error} />
      </View>

      {breakdown.map((group) => (
        <View key={group.currency} style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={{ paddingHorizontal: 4, fontFamily, fontSize: 15, fontWeight: '600', color: colors.ink }}>{group.currency}</Text>
          <View style={{ borderRadius: 16, backgroundColor: colors.surface, overflow: 'hidden' }}>
            {group.rows.map((row, index) => {
              const title = row.kind === 'expense' ? row.title : repaymentTitle(replica, { from_member_id: row.from, to_member_id: row.to });

              return (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${title}, ${signedMoney(row.amount, group.currency)}`}
                  disabled={row.kind === 'expense' ? !open.can('showExpense', { expenseId: row.id }) : !open.can('showSettlement', { settlementId: row.id })}
                  onPress={() => {
                    if (row.kind === 'expense') void open.call('showExpense', { expenseId: row.id });
                    else void open.call('showSettlement', { settlementId: row.id });
                  }}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8, paddingHorizontal: 16 }, index > 0 && s.ruled, pressed && { backgroundColor: colors.background }]}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={1} style={{ fontFamily, fontSize: 15, color: colors.ink }}>{title}</Text>
                    <Text numberOfLines={1} style={{ fontFamily, fontSize: 13, color: colors.muted }}>{row.detail}</Text>
                  </View>
                  <Text style={[money(row.amount), { fontSize: 15 }]}>{signedFigure(row.amount, group.currency)}</Text>
                </Pressable>
              );
            })}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, borderTopWidth: 2, borderColor: colors.track, backgroundColor: colors.totalRow }}>
              <Text style={{ flex: 1, fontFamily, fontSize: 15, fontWeight: '600', color: colors.ink }}>Balance</Text>
              <Text style={[money(group.total), { fontSize: 17 }]}>{signedMoney(group.total, group.currency)}</Text>
            </View>
          </View>
        </View>
      ))}
      <ErrorMessage message={open.error} />
    </View>
  );
}
