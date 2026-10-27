import { Text, TextInput, useWindowDimensions, View } from 'react-native';
import { parseAmount, preferredMember, repaymentMembers, settlementSuggestions, type ClientReplicaState } from '@splitnext/client';
import { memberName, moneyLabel } from '../model/expenses';
import { ErrorMessage, HeaderAction, ScreenHeader, SectionHeading, colors, s } from './components';
import { RepaymentRow } from './ExpenseList';
import { MemberDropdown } from './MemberDropdown';
import { between, useCompactProgress } from './pageScroll';
import { fontFamily } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

type Snapshot = ClientReplicaState['projected_snapshot'];

/** A member's name, or "you" in the sentence's own case. */
function personName(snapshot: Snapshot, memberId: string, you: string | undefined, capital = false): string {
  return memberId === you ? (capital ? 'You' : 'you') : memberName(snapshot, memberId);
}

/** The repayment's actions and its sentence: who paid whom. */
export function SettlementsHeader(props: { replica: ClientReplicaState }) {
  const draft = useUiState().repayment;
  const back = useActionCall();
  const remove = useActionCall();
  const save = useActionCall();
  const editing = Boolean(draft.settlementId);
  const ready = editing ? save.can('saveRepayment') : save.can('recordSettlement', draft);

  function done(): void {
    void back.call('closePanel', {});
  }

  return (
    <>
      <ScreenHeader
        start={<HeaderAction quiet text="Cancel" label="Cancel" disabled={!back.can('closePanel')} onPress={done} />}
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
              text={save.busy ? 'Saving…' : editing ? 'Save' : 'Record'}
              label={editing ? 'Save repayment' : 'Record repayment'}
              disabled={!ready}
              onPress={() => {
                if (editing) void save.call('saveRepayment', {}, done);
                else void save.call('recordSettlement', draft, done);
              }}
            />
          </>
        )}
        heading={<RepaymentPeople replica={props.replica} />}
      />
      <ErrorMessage message={back.error ?? remove.error ?? save.error} />
    </>
  );
}

/** Two member dropdowns read as a sentence, using the preferred member as you. */
function RepaymentPeople(props: { replica: ClientReplicaState }) {
  const snapshot = props.replica.projected_snapshot;
  const draft = useUiState().repayment;
  const action = useActionCall();
  const progress = useCompactProgress();
  const { width } = useWindowDimensions();

  if (!snapshot) return null;
  const you = preferredMember(snapshot, props.replica.session?.identity.id)?.id;
  const eligible = new Set(repaymentMembers(snapshot).map((member) => member.id));
  const members = snapshot.members.filter((member) => eligible.has(member.id) || (draft.settlementId && [draft.from, draft.to].includes(member.id)));
  const fontSize = between(width < 360 ? 28 : 32, 22, progress);
  const input = { from: draft.from, to: draft.to, amount: draft.amount, currency: draft.currency, keepEditing: Boolean(draft.settlementId), manual: true };

  function prepare(side: 'from' | 'to', value: string): void {
    void action.call('prepareRepayment', { ...input, [side]: value });
  }

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View accessibilityRole="header" accessibilityLabel={`${personName(snapshot, draft.from, you, true)} paid ${personName(snapshot, draft.to, you)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <MemberDropdown label="Paid by" value={draft.from} options={members.map((member) => ({ value: member.id, label: personName(snapshot, member.id, you, true) }))} fontSize={fontSize} disabled={!action.can('prepareRepayment', input)} onChange={(value) => prepare('from', value)} />
        <Text style={{ fontFamily, fontSize, fontWeight: '700', color: colors.ink }}>paid</Text>
        <MemberDropdown label="Paid to" value={draft.to} options={members.map((member) => ({ value: member.id, label: personName(snapshot, member.id, you) }))} fontSize={fontSize} disabled={!action.can('prepareRepayment', input)} onChange={(value) => prepare('to', value)} />
      </View>
      <ErrorMessage message={action.error} />
    </View>
  );
}

/** Recording money already paid outside the app, or changing a recorded repayment. */
export function SettlementsPanel(props: { replica: ClientReplicaState }) {
  const snapshot = props.replica.projected_snapshot;
  const actions = useActions();
  const draft = useUiState().repayment;

  if (!snapshot) return null;
  const you = preferredMember(snapshot, props.replica.session?.identity.id)?.id;
  const owed = settlementSuggestions(snapshot).find((entry) => entry.from_member_id === draft.from && entry.to_member_id === draft.to && entry.currency === draft.currency);
  const full = owed && parseAmount(draft.amount, draft.currency) === owed.amount;

  const change = (field: 'repayment.amount', value: string) => {
    void actions.dispatch('changeDraft', { field, value }, { origin: 'ui' });
  };

  return (
    <View style={{ gap: 34, paddingTop: 20, paddingBottom: 24 }}>
      <View style={{ gap: 10 }}>
        <View style={{ paddingBottom: 10, borderBottomWidth: 1.5, borderColor: colors.ink }}>
          <TextInput
            accessibilityLabel="Amount"
            placeholder="0.00"
            placeholderTextColor={colors.placeholder}
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
    <View>
      <SectionHeading title="Earlier repayments" />
      <View style={s.listCard}>
        {recorded.map((entry, index) => <RepaymentRow key={entry.id} replica={props.replica} settlement={entry} first={index === 0} />)}
      </View>
    </View>
  );
}
