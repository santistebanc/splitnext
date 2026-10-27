import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { parseAmount, preferredMember, repaymentMembers, settlementSuggestions, type ClientReplicaState } from '@splitnext/client';
import { memberName, moneyLabel } from '../model/expenses';
import { ErrorMessage, HeaderAction, RadioRow, ScreenHeader, SectionHeading, colors, s } from './components';
import { RepaymentRow } from './ExpenseList';
import { Drawer } from './Drawer';
import { ChevronDownIcon } from './icons';
import { displayFamily, radius } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

type Snapshot = ClientReplicaState['projected_snapshot'];

/** A member's name, or "you" in the sentence's own case. */
function personName(snapshot: Snapshot, memberId: string, you: string | undefined, capital = false): string {
  return memberId === you ? (capital ? 'You' : 'you') : memberName(snapshot, memberId);
}

/** The repayment form's header: Cancel, Delete for a saved repayment, and Record or Save. */
export function SettlementsHeader() {
  const draft = useUiState().repayment;
  const back = useActionCall();
  const save = useActionCall();
  const remove = useActionCall();
  const editing = Boolean(draft.settlementId);
  const ready = editing ? save.can('saveRepayment') : save.can('recordSettlement', draft);

  function done(): void {
    void back.call('closePanel', {});
  }

  return (
    <>
      <ScreenHeader
        start={<HeaderAction text="Cancel" label="Cancel" disabled={!back.can('closePanel')} onPress={done} />}
        end={(
          <>
            {draft.settlementId ? (
              <HeaderAction
                danger
                text="Delete"
                label="Delete"
                disabled={!remove.can('removeSettlement', { settlementId: draft.settlementId })}
                onPress={() => {
                  if (draft.settlementId) void remove.call('removeSettlement', { settlementId: draft.settlementId }, done);
                }}
              />
            ) : null}
            <HeaderAction
              primary
              text={editing ? 'Save' : 'Record'}
              label={editing ? 'Save repayment' : 'Record repayment'}
              disabled={!ready}
              onPress={() => {
                if (editing) void save.call('saveRepayment', {}, done);
                else void save.call('recordSettlement', draft, done);
              }}
            />
          </>
        )}
      />
      <ErrorMessage message={back.error ?? save.error ?? remove.error} />
    </>
  );
}

/** One name in the "Santi paid you" sentence, which opens the people to choose from. */
function NameChip(props: { label: string; name: string; open: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} ${props.name}. Change`}
      accessibilityState={{ expanded: props.open }}
      onPress={props.onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 48, paddingHorizontal: 10, borderRadius: radius.control, backgroundColor: props.open ? colors.actionSoft : colors.track }, pressed && s.pressed]}
    >
      <Text style={{ fontFamily: displayFamily, fontSize: 26, fontWeight: '700', color: colors.ink }}>{props.name}</Text>
      <ChevronDownIcon color={colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
}

/** Recording money already paid outside the app, or changing a recorded repayment. */
export function SettlementsPanel(props: { replica: ClientReplicaState }) {
  const snapshot = props.replica.projected_snapshot;
  const action = useActionCall();
  const actions = useActions();
  const draft = useUiState().repayment;
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  if (!snapshot) return null;
  const you = preferredMember(snapshot, props.replica.session?.identity.id)?.id;
  const eligible = new Set(repaymentMembers(snapshot).map((member) => member.id));
  const members = snapshot.members.filter((member) => eligible.has(member.id) || (draft.settlementId && [draft.from, draft.to].includes(member.id))).map((member) => member.id);
  const owed = settlementSuggestions(snapshot).find((entry) => entry.from_member_id === draft.from && entry.to_member_id === draft.to && entry.currency === draft.currency);
  const full = owed && parseAmount(draft.amount, draft.currency) === owed.amount;

  const prepare = (from: string, to: string) => {
    setPicking(null);
    void action.call('prepareRepayment', { from, to, amount: draft.amount, currency: draft.currency, keepEditing: Boolean(draft.settlementId), manual: true });
  };

  const change = (field: 'repayment.amount', value: string) => {
    void actions.dispatch('changeDraft', { field, value }, { origin: 'ui' });
  };

  const from = draft.from ? personName(snapshot, draft.from, you, true) : 'Someone';
  const to = draft.to ? personName(snapshot, draft.to, you) : 'someone';

  return (
    <View style={{ gap: 24, paddingHorizontal: 4, paddingBottom: 24 }}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          <NameChip label="Paid by" name={from} open={picking === 'from'} onPress={() => setPicking(picking === 'from' ? null : 'from')} />
          <Text style={{ paddingHorizontal: 4, fontFamily: displayFamily, fontSize: 26, fontWeight: '700', color: colors.ink }}>paid</Text>
          <NameChip label="Paid to" name={to} open={picking === 'to'} onPress={() => setPicking(picking === 'to' ? null : 'to')} />
        </View>
        {picking ? (
          <Drawer title={picking === 'from' ? 'Paid by' : 'Paid to'} onClose={() => setPicking(null)}>
            <ScrollView style={{ flexShrink: 1 }}>
              <View accessibilityRole="radiogroup" accessibilityLabel={picking === 'from' ? 'Paid by' : 'Paid to'} style={{ gap: 6 }}>
                {members.map((memberId) => (
                  <RadioRow
                    compact
                    key={memberId}
                    label={`${memberName(snapshot, memberId)}${memberId === you ? ' (you)' : ''}`}
                    selected={(picking === 'from' ? draft.from : draft.to) === memberId}
                    onPress={() => (picking === 'from' ? prepare(memberId, draft.to) : prepare(draft.from, memberId))}
                  />
                ))}
              </View>
            </ScrollView>
          </Drawer>
        ) : null}
      </View>

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: colors.field }}>
          <TextInput
            accessibilityLabel="Amount"
            placeholder="0.00"
            placeholderTextColor={colors.control}
            inputMode="decimal"
            value={draft.amount}
            onChangeText={(value) => change('repayment.amount', value)}
            style={s.amountInput}
          />
        </View>
        <Text style={s.caption}>
          {owed
            ? full
              ? `Full amount ${personName(snapshot, owed.from_member_id, you)} ${owed.from_member_id === you ? 'owe' : 'owes'}. Paid outside splitnext.`
              : `${personName(snapshot, owed.from_member_id, you, true)} ${owed.from_member_id === you ? 'owe' : 'owes'} ${moneyLabel(owed.amount, owed.currency)}. Paid outside splitnext.`
            : 'Paid outside splitnext.'}
        </Text>
      </View>

      <ErrorMessage message={action.error} />

      <RepaymentHistory replica={props.replica} />
    </View>
  );
}

/** Recorded repayments, newest first; each opens in the repayment form. */
function RepaymentHistory(props: { replica: ClientReplicaState }) {
  const snapshot = props.replica.projected_snapshot;
  const draft = useUiState().repayment;

  if (!snapshot) return null;
  const recorded = snapshot.settlements.filter((entry) => entry.status === 'active' && entry.id !== draft.settlementId).toReversed();

  if (!recorded.length) return null;

  return (
    <View style={{ marginTop: 16 }}>
      <SectionHeading title="Earlier repayments" />
      <View style={s.listCard}>
        {recorded.map((entry, index) => <RepaymentRow key={entry.id} replica={props.replica} settlement={entry} first={index === 0} />)}
      </View>
    </View>
  );
}
