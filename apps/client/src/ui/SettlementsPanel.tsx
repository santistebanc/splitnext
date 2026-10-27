import { Text, TextInput, View } from 'react-native';
import { parseAmount, preferredMember, repaymentMembers, settlementSuggestions, type ClientReplicaState } from '@splitnext/client';
import { memberName, moneyLabel } from '../model/expenses';
import { Choice, ErrorMessage, FooterButton, HeaderAction, ScreenHeader, SectionHeading, colors, s } from './components';
import { RepaymentRow } from './ExpenseList';
import { useActionCall, useActions, useUiState } from './useActionCall';

type Snapshot = ClientReplicaState['projected_snapshot'];

/** A member's name, or "you" in the sentence's own case. */
function personName(snapshot: Snapshot, memberId: string, you: string | undefined, capital = false): string {
  return memberId === you ? (capital ? 'You' : 'you') : memberName(snapshot, memberId);
}

/** The repayment form's header: Cancel, Delete for a saved repayment, and its title. */
export function SettlementsHeader() {
  const draft = useUiState().repayment;
  const back = useActionCall();
  const remove = useActionCall();

  function done(): void {
    void back.call('closePanel', {});
  }

  return (
    <>
      <ScreenHeader
        start={<HeaderAction quiet text="Cancel" label="Cancel" disabled={!back.can('closePanel')} onPress={done} />}
        end={draft.settlementId ? (
          <HeaderAction
            danger
            text="Delete"
            label="Delete"
            disabled={!remove.can('removeSettlement', { settlementId: draft.settlementId })}
            onPress={() => {
              if (draft.settlementId) void remove.call('removeSettlement', { settlementId: draft.settlementId }, done);
            }}
          />
        ) : undefined}
        title={draft.settlementId ? 'Change payment' : 'Record a payment'}
      />
      <ErrorMessage message={back.error ?? remove.error} />
    </>
  );
}

/** Record, or Save for a recorded repayment, pinned at the foot. */
export function SettlementsFooter() {
  const draft = useUiState().repayment;
  const back = useActionCall();
  const save = useActionCall();
  const editing = Boolean(draft.settlementId);
  const ready = editing ? save.can('saveRepayment') : save.can('recordSettlement', draft);

  function done(): void {
    void back.call('closePanel', {});
  }

  return (
    <>
      <ErrorMessage message={save.error} />
      <FooterButton
        label={editing ? 'Save repayment' : 'Record repayment'}
        busy={save.busy}
        disabled={!ready}
        onPress={() => {
          if (editing) void save.call('saveRepayment', {}, done);
          else void save.call('recordSettlement', draft, done);
        }}
      >
        {editing ? 'Save' : 'Record'}
      </FooterButton>
    </>
  );
}

/** Recording money already paid outside the app, or changing a recorded repayment. */
export function SettlementsPanel(props: { replica: ClientReplicaState }) {
  const snapshot = props.replica.projected_snapshot;
  const action = useActionCall();
  const actions = useActions();
  const draft = useUiState().repayment;

  if (!snapshot) return null;
  const you = preferredMember(snapshot, props.replica.session?.identity.id)?.id;
  const eligible = new Set(repaymentMembers(snapshot).map((member) => member.id));
  const members = snapshot.members.filter((member) => eligible.has(member.id) || (draft.settlementId && [draft.from, draft.to].includes(member.id))).map((member) => member.id);
  const owed = settlementSuggestions(snapshot).find((entry) => entry.from_member_id === draft.from && entry.to_member_id === draft.to && entry.currency === draft.currency);
  const full = owed && parseAmount(draft.amount, draft.currency) === owed.amount;

  const prepare = (from: string, to: string) => {
    void action.call('prepareRepayment', { from, to, amount: draft.amount, currency: draft.currency, keepEditing: Boolean(draft.settlementId), manual: true });
  };

  const change = (field: 'repayment.amount', value: string) => {
    void actions.dispatch('changeDraft', { field, value }, { origin: 'ui' });
  };

  function chips(side: 'from' | 'to') {
    return (
      <View role="radiogroup" aria-label={side === 'from' ? 'Paid by' : 'Paid to'} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {members.map((memberId) => (
          <Choice
            key={memberId}
            label={memberName(snapshot, memberId)}
            selected={(side === 'from' ? draft.from : draft.to) === memberId}
            onPress={() => (side === 'from' ? prepare(memberId, draft.to) : prepare(draft.from, memberId))}
          >
            {personName(snapshot, memberId, you, true)}
          </Choice>
        ))}
      </View>
    );
  }

  return (
    <View style={{ gap: 34, paddingTop: 20, paddingBottom: 24 }}>
      <View style={{ gap: 12 }}>
        <Text style={s.label}>From</Text>
        {chips('from')}
        <Text style={[s.label, { paddingTop: 14 }]}>To</Text>
        {chips('to')}
      </View>

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
    <View>
      <SectionHeading title="Earlier repayments" />
      <View style={s.listCard}>
        {recorded.map((entry, index) => <RepaymentRow key={entry.id} replica={props.replica} settlement={entry} first={index === 0} />)}
      </View>
    </View>
  );
}
