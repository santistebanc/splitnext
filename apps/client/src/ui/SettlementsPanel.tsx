import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import { minorDigits, parseAmount, preferredMember, repaymentMembers, settlementSuggestions, type ClientReplicaState } from '@splitnext/client';
import { memberName, moneyLabel } from '../model/expenses';
import { ErrorMessage, FooterButton, HeaderAction, ScreenHeader, colors, s } from './components';
import { AmountInput, type AmountInputHandle } from './AmountInput';
import { EntrySwitch } from './EntrySwitch';
import { MemberChoice } from './MemberChoice';
import type { MemberListApp } from './MemberList';
import { between, useCompactProgress } from './pageScroll';
import { fontFamily } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

type Snapshot = ClientReplicaState['projected_snapshot'];

/** A member's name, or "you" in the sentence's own case. */
function personName(snapshot: Snapshot, memberId: string, you: string | undefined, capital = false): string {
  return memberId === you ? (capital ? 'You' : 'you') : memberName(snapshot, memberId);
}

function useSaveRepayment() {
  const draft = useUiState().repayment;
  const save = useActionCall();
  const close = useActionCall();
  const editing = Boolean(draft.settlementId);
  const ready = editing ? save.can('saveRepayment') : save.can('recordSettlement', draft);

  function submit(): void {
    if (!ready) return;
    const done = () => { void close.call('closePanel', {}); };

    if (editing) void save.call('saveRepayment', {}, done);
    else void save.call('recordSettlement', draft, done);
  }

  return { save, editing, ready, submit };
}

/** Like expenses: Cancel and Delete above the amount; the main action is below. */
export function SettlementsHeader() {
  const draft = useUiState().repayment;
  const back = useActionCall();
  const remove = useActionCall();
  const actions = useActions();
  const { submit } = useSaveRepayment();
  const progress = useCompactProgress();
  const amount = useRef<AmountInputHandle>(null);
  const whole = Math.max(1, (draft.amount.split('.')[0] ?? '').length);
  const shownLength = whole + Math.floor((whole - 1) / 3) + 1 + minorDigits(draft.currency);
  const amountFit = Math.min(1, 10 / shownLength);

  useEffect(() => {
    if (draft.settlementId) return;
    const frame = requestAnimationFrame(() => amount.current?.focus({ preventScroll: true }));

    return () => cancelAnimationFrame(frame);
  }, []);

  function done(): void {
    void back.call('closePanel', {});
  }

  return (
    <>
      <ScreenHeader
        start={<HeaderAction quiet text="Cancel" label="Cancel" disabled={!back.can('closePanel')} onPress={done} />}
        end={draft.settlementId ? (
          <HeaderAction danger text="Delete" label="Delete" disabled={!remove.can('removeSettlement', { settlementId: draft.settlementId })} onPress={() => {
            if (draft.settlementId) void remove.call('removeSettlement', { settlementId: draft.settlementId }, done);
          }} />
        ) : <EntrySwitch kind="repayment" />}
        scrollRule={false}
      />
      <ErrorMessage message={back.error ?? remove.error} />
      <View style={{ paddingBottom: between(14, 6, progress) }}>
        <View style={{ marginTop: between(12, 0, progress), paddingBottom: between(10, 6, progress), borderBottomWidth: 1.5, borderColor: colors.ink, flexDirection: 'row' }}>
          <AmountInput inputRef={amount} align="right" value={draft.amount} currency={draft.currency} onChangeText={(value) => {
            void actions.dispatch('changeDraft', { field: 'repayment.amount', value }, { origin: 'ui' });
          }} onSubmitEditing={submit} height={between(60, 36, progress)} fontSize={between(56, 32, progress) * amountFit} />
        </View>
        <View style={{ paddingTop: between(16, 8, progress), paddingBottom: between(14, 8, progress), borderBottomWidth: 1, borderColor: colors.rule }}>
          <Text accessibilityRole="header" style={{ fontFamily, fontSize: between(24, 18, progress), fontWeight: '600', color: colors.ink }}>Repayment</Text>
        </View>
      </View>
    </>
  );
}

/** The same pinned primary action as the expense editor. */
export function SettlementsFooter() {
  const { save, editing, ready, submit } = useSaveRepayment();

  return (
    <>
      <ErrorMessage message={save.error} />
      <FooterButton label={editing ? 'Save repayment' : 'Record repayment'} busy={save.busy} disabled={!ready} onPress={submit}>
        {save.busy ? 'Saving…' : editing ? 'Save' : 'Record repayment'}
      </FooterButton>
    </>
  );
}

/** Member choices follow the amount, with the same row scale as the expense editor. */
export function SettlementsPanel(props: { app: MemberListApp; replica: ClientReplicaState }) {
  const snapshot = props.replica.projected_snapshot;
  const draft = useUiState().repayment;
  const action = useActionCall();

  if (!snapshot) return null;
  const you = preferredMember(snapshot, props.replica.session?.identity.id)?.id;
  const eligible = new Set(repaymentMembers(snapshot).map((member) => member.id));
  const members = snapshot.members.filter((member) => eligible.has(member.id) || (draft.settlementId && [draft.from, draft.to].includes(member.id)));
  const input = { from: draft.from, to: draft.to, amount: draft.amount, currency: draft.currency, keepEditing: Boolean(draft.settlementId), manual: true };
  const owed = settlementSuggestions(snapshot).find((entry) => entry.from_member_id === draft.from && entry.to_member_id === draft.to && entry.currency === draft.currency);
  const full = owed && parseAmount(draft.amount, draft.currency) === owed.amount;

  return (
    <View style={{ gap: 16, paddingBottom: 24 }}>
      <View>
        {(['from', 'to'] as const).map((side) => (
          <MemberChoice
            key={side}
            app={props.app}
            label={side === 'from' ? 'Paid by' : 'Paid to'}
            change={side === 'from' ? 'Change payer' : 'Change recipient'}
            value={draft[side]}
            members={members.map((member) => member.id)}
            you={you}
            disabled={!action.can('prepareRepayment', input)}
            onChange={(value) => { void action.call('prepareRepayment', { ...input, [side]: value }); }}
          />
        ))}
      </View>
      <Text style={s.caption}>
        {owed
          ? full
            ? `Full amount ${personName(snapshot, owed.from_member_id, you)} ${owed.from_member_id === you ? 'owe' : 'owes'}. Paid outside splitnext.`
            : `${personName(snapshot, owed.from_member_id, you, true)} ${owed.from_member_id === you ? 'owe' : 'owes'} ${moneyLabel(owed.amount, owed.currency)}. Paid outside splitnext.`
          : 'Paid outside splitnext.'}
      </Text>
      <ErrorMessage message={action.error} />
    </View>
  );
}
