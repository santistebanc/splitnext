import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { activeMembers, formatAmount, minorDigits, parseAmount, preferredMember } from '@splitnext/client';
import { entryFromDraft, expenseLabel, memberName, moneyLabel, previewAllocation, type ExpenseDraft, type ExpenseDraftPart } from '../model/expenses';
import { ErrorMessage, Field, FooterButton, HeaderAction, ScreenHeader, colors, s } from './components';
import { AmountInput, type AmountInputHandle } from './AmountInput';
import { between, useCompactProgress } from './pageScroll';
import { Reveal } from './Reveal';
import { morph } from './ScreenMorph';
import { whenLabel } from './relativeTime';
import { participantMarkers } from '../model/memberPresentation';
import { MemberIcon, type MemberListApp } from './MemberList';
import { YouBadge } from './YouBadge';
import { fontFamily, monoFamily, splitHues, withTransition } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

/** The editor needs presence too, to show who is online among the payers. */
export type ExpenseEditorApp = MemberListApp;

type ExpenseEditorProps = { app: ExpenseEditorApp };

/** The editor's header: Cancel, with Delete for a recorded expense. */
export function ExpenseEditorHeader(props: ExpenseEditorProps) {
  const back = useActionCall();
  const remove = useActionCall();
  const draft = useUiState().expense;
  const expense = props.app.snapshot().group?.projected_snapshot?.expenses.find((entry) => entry.id === draft.expenseId);

  return (
    <>
      <ScreenHeader
        start={<HeaderAction quiet text="Cancel" label="Cancel" disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
        end={expense ? (
          <HeaderAction danger text="Delete" label={`Delete ${expenseLabel(expense)}`} disabled={!remove.can('removeExpense', { expenseId: expense.id })} onPress={() => { void remove.call('removeExpense', { expenseId: expense.id }, () => { void back.call('closePanel', {}); }); }} />
        ) : null}
        // The timestamp sits under this row; the rule under the description ends the header.
        scrollRule={false}
      />
      {expense ? (
        <Text testID="expense-timestamp" style={[s.caption, { textAlign: 'left' }]}>
          {expense.updated_at === expense.created_at ? 'Created' : 'Last updated'} {whenLabel(new Date(expense.updated_at))}
        </Text>
      ) : null}
      <ErrorMessage message={back.error ?? remove.error} />
    </>
  );
}

/** The shared main action, kept at the foot while the split scrolls. */
export function ExpenseEditorFooter() {
  const save = useActionCall();

  return (
    <>
      <ErrorMessage message={save.error} />
      <FooterButton label="Save" busy={save.busy} disabled={!save.can('saveExpense')} onPress={() => { void save.call('saveExpense', {}); }}>
        {save.busy ? 'Saving…' : 'Save'}
      </FooterButton>
    </>
  );
}

/** “15.00 each” for an equal split, or how many people share a custom one. */
function splitSummary(draft: ExpenseDraft, preview: Map<string, number>): string {
  if (!draft.parts.length) return 'Pick at least one person';

  const people = draft.parts.length === 1 ? '1 person' : `${draft.parts.length} people`;

  if (draft.parts.some((part) => part.kind === 'exact' || part.shares !== 1)) return people;
  const each = preview.get(draft.parts[0]!.member_id);

  return each !== undefined ? `${moneyLabel(each, draft.currency)} each` : 'Enter an amount to split';
}

/** A − or + beside a person's shares, with a full touch target. */
function ShareStep(props: { sign: '−' | '+'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, props.disabled && s.dim]}
    >
      <Text style={{ fontFamily: monoFamily, fontSize: 16, color: colors.muted }}>{props.sign}</Text>
    </Pressable>
  );
}

/**
 * One person in the split: their colour in the bar, − and + for their shares,
 * their amount, which can be tapped to fix it while the others divide the
 * rest, and at the end whether they share it.
 * `sharing` counts the people dividing the rest by shares.
 */
function ExpenseSplitRow(props: { memberId: string; name: string; you: boolean; hue: string; part: ExpenseDraftPart | undefined; owed: number | undefined; currency: string; hasAmount: boolean; sharing: number; amountWidth: number }) {
  const edit = useActionCall();
  const [editing, setEditing] = useState(false);
  const input = useRef<AmountInputHandle>(null);
  const fixed = props.part?.kind === 'exact';
  const included = Boolean(props.part);
  const shares = props.part?.kind === 'shares' ? props.part.shares : 1;
  const value = props.part?.kind === 'exact' ? props.part.amount : formatAmount(props.owed ?? 0, props.currency);
  const parsed = parseAmount(value, props.currency);
  const shown = parsed === null ? value : moneyLabel(parsed, props.currency);
  const fixing = { memberId: props.memberId, amount: value };
  const member = { memberId: props.memberId };
  const canFix = props.hasAmount && edit.can('setExpenseFixedAmount', fixing);
  const canToggle = edit.can('toggleExpenseParticipant', member);
  // − shows beside + once someone has more than one share or a fixed amount,
  // and + while it changes the split; the checkbox always ends the row.
  // Until the expense has an amount there is nothing to divide, so only the
  // checkbox shows; the empty columns keep their room.
  const dividing = included && props.hasAmount;
  const stepping = dividing && (fixed || shares > 1);
  const canIncrease = dividing && (fixed || props.sharing > 1);

  // Opening the field does not fix the amount; only changing its value does.
  // Focus after it has mounted, selecting the share amount for replacement.
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  return (
    <View>
      <View style={withTransition({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, borderBottomWidth: 1, borderColor: colors.rule, opacity: included ? 1 : 0.4 }, 'opacity', 200)}>
        <View aria-hidden style={{ width: 4, height: 18, backgroundColor: props.hue }} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={[s.name, { flexShrink: 1 }]}>{props.name}</Text>
          {props.you ? <YouBadge /> : null}
        </View>
        <View style={{ flexDirection: 'row', marginRight: -10 }}>
          <View style={{ width: 44 }}>
            {stepping ? (
              <ShareStep sign="−" label={`Decrease share for ${props.name}`} disabled={!edit.can('decreaseExpenseShare', member)} onPress={() => { void edit.call('decreaseExpenseShare', member); }} />
            ) : null}
          </View>
          <View style={{ width: 44 }}>
            {canIncrease ? (
              <ShareStep sign="+" label={`Increase share for ${props.name}`} disabled={!edit.can('increaseExpenseShare', member)} onPress={() => { void edit.call('increaseExpenseShare', member); }} />
            ) : null}
          </View>
        </View>
        <View testID="split-amount-column" style={{ width: props.amountWidth, alignItems: 'flex-end' }}>
          {!dividing ? null : editing || fixed ? (
            // The same field as the expense's own amount: two fixed decimals, dot or comma.
            <View style={{ width: props.amountWidth }}>
              <AmountInput
                inline
                inputRef={input}
                label={`Amount for ${props.name}`}
                value={value}
                currency={props.currency}
                height={40}
                fontSize={15}
                editable={edit.can('setExpenseFixedAmount', { memberId: props.memberId, amount: '' })}
                onChangeText={(amount) => {
                  if (!fixed && (!amount.trim() || parseAmount(amount, props.currency) === props.owed)) return;
                  void edit.call('setExpenseFixedAmount', { memberId: props.memberId, amount });
                }}
                onFocus={() => setEditing(true)}
                onBlur={() => setEditing(false)}
                onSubmitEditing={() => setEditing(false)}
              />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Amount for ${props.name}: ${shown}. Change amount`}
              accessibilityState={{ disabled: !canFix }}
              disabled={!canFix}
              onPress={() => setEditing(true)}
              style={({ pressed }) => [{ height: 44, justifyContent: 'center' }, pressed && s.pressed]}
            >
              <Text numberOfLines={1} style={{ textAlign: 'right', fontFamily: monoFamily, fontSize: 15, fontWeight: '500', color: colors.ink }}>
                {shown}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={{ width: 44, marginHorizontal: -13 }}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`${props.name} shares this expense`}
            accessibilityState={{ checked: included, disabled: !canToggle }}
            aria-checked={included}
            disabled={!canToggle}
            onPress={() => { void edit.call('toggleExpenseParticipant', member); }}
            style={({ pressed }) => [{ width: 44, height: 60, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, !canToggle && included && s.dim]}
          >
            <View style={[s.checkbox, included && { backgroundColor: colors.ink }]}>
              {included ? <Text style={{ color: colors.actionInk, fontSize: 11, lineHeight: 12 }}>✓</Text> : null}
            </View>
          </Pressable>
        </View>
      </View>
      <ErrorMessage message={edit.error} />
    </View>
  );
}

/**
 * The expense's amount and what it was for, fixed at the top. Both shrink as
 * the split scrolls under them.
 */
export function ExpenseControls() {
  const draft = useUiState().expense;
  const amount = useRef<AmountInputHandle>(null);
  const progress = useCompactProgress();
  const actions = useActions();
  const save = useActionCall();

  // A new expense starts in its amount; changing one waits for a tap. Opening
  // a screen dismisses the keyboard after this screen's effects, so focus
  // waits a frame.
  useEffect(() => {
    if (draft.expenseId) return;
    const frame = requestAnimationFrame(() => amount.current?.focus({ preventScroll: true }));

    return () => cancelAnimationFrame(frame);
  }, []);

  function change(field: 'expense.description' | 'expense.amount', value: string): void {
    void actions.dispatch('changeDraft', { field, value }, { origin: 'ui' });
  }

  function submit(): void {
    if (save.can('saveExpense')) void save.call('saveExpense', {});
  }

  const descriptionStyle = { fontFamily, fontSize: 17, lineHeight: 24, fontWeight: '400', color: colors.ink } as const;
  const [descriptionHeight, setDescriptionHeight] = useState(0);
  const [editingDescription, setEditingDescription] = useState(false);
  // Read rather than edited: the cut text shows instead of the field's own.
  const shown = !editingDescription && Boolean(draft.description);
  const descriptionKey = draft.expenseId ? `etitle-${draft.expenseId}` : 'addexp';
  // The amount as shown, grouped in threes, fits the width: up to "999,999.99"
  // at full size, and longer figures in proportion.
  const whole = Math.max(1, (draft.amount.split('.')[0] ?? '').length);
  const shownLength = whole + Math.floor((whole - 1) / 3) + 1 + minorDigits(draft.currency);
  const amountFit = Math.min(1, 10 / shownLength);

  return (
    <View style={{ paddingBottom: between(14, 6, progress) }}>
      <View style={{ marginTop: between(12, 0, progress), paddingBottom: between(10, 6, progress), borderBottomWidth: 1.5, borderColor: colors.ink, flexDirection: 'row' }}>
        <View ref={morph(draft.expenseId ? `eamt-${draft.expenseId}` : null, { unclipped: true })} style={{ flex: 1, minWidth: 0, flexDirection: 'row' }}>
        <AmountInput
          inputRef={amount}
          align="right"
          value={draft.amount}
          currency={draft.currency}
          onChangeText={(value) => change('expense.amount', value)}
          onSubmitEditing={submit}
          height={between(60, 36, progress)}
          fontSize={between(56, 32, progress) * amountFit}
        />
        </View>
      </View>
      <View style={{ paddingTop: 8 }}>
        <Field
          label="Description"
          inputRef={morph(shown ? null : descriptionKey)}
          onFocus={() => setEditingDescription(true)}
          onBlur={() => setEditingDescription(false)}
          value={draft.description}
          onChangeText={(value) => change('expense.description', value.replace(/\n/g, ''))}
          maxLength={100}
          multiline
          submitBehavior="submit"
          returnKeyType="done"
          onSubmitEditing={submit}
          onKeyPress={(event) => {
            if (event.nativeEvent.key !== 'Enter') return;
            event.preventDefault();
            submit();
          }}
          displayValue={(
            <Text
              ref={morph(shown ? descriptionKey : null)}
              numberOfLines={2}
              onLayout={(event) => setDescriptionHeight(event.nativeEvent.layout.height)}
              style={[descriptionStyle, { opacity: shown ? 1 : 0 }]}
            >
              {draft.description || ' '}
            </Text>
          )}
          style={[descriptionStyle, { height: Math.max(44, descriptionHeight + 20), paddingHorizontal: 0, paddingVertical: 10, overflow: 'hidden' }, shown && { color: 'transparent' }]}
        />
      </View>
    </View>
  );
}

/**
 * One name to choose as who paid, drawn like their row in the balances: the
 * whole width, tinted when it is you, with their presence, the name and
 * “you”, and a check at the end on the one who paid.
 */
function PayerRow(props: { app: ExpenseEditorApp; memberId: string; you: boolean; selected: boolean; onPress: () => void }) {
  const state = props.app.snapshot();
  const replica = state.group;
  const name = memberName(replica?.projected_snapshot, props.memberId);
  const participants = replica ? participantMarkers(replica, props.memberId, props.app.client.presence(replica.group_id), state.online && state.reachable) : [];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${name}${props.you ? ' (you)' : ''}`}
      accessibilityState={{ checked: props.selected }}
      aria-checked={props.selected}
      onPress={props.onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, marginHorizontal: -24, paddingHorizontal: 24, borderBottomWidth: 1, borderColor: colors.rule }, props.you && { backgroundColor: colors.youRow }, pressed && s.rowPressed]}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <MemberIcon participants={participants} size={6} />
        <Text numberOfLines={1} style={[s.name, { flexShrink: 1 }]}>{name}</Text>
        {props.you ? <YouBadge /> : null}
      </View>
      {props.selected ? <Text aria-hidden style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>✓</Text> : null}
    </Pressable>
  );
}

/** Who paid, opening the names in place, then how it is split. */
export function ExpenseEditor(props: ExpenseEditorProps) {
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const you = preferredMember(snapshot, replica?.session?.identity.id)?.id;
  const draft = useUiState().expense;
  const edit = useActionCall();
  const [choosingPayer, setChoosingPayer] = useState(false);
  const payerToggle = useRef<View>(null);
  const allMembers = snapshot?.members ?? [];

  // Active members, and anyone the expense already names who was removed since.
  const members = allMembers.filter(
    (member) => member.status === 'active' || draft.parts.some((part) => part.member_id === member.id) || member.id === draft.paidBy,
  );

  const payers = allMembers.filter((member) => member.status === 'active' || member.id === draft.paidBy);
  const preview = previewAllocation(snapshot, draft);
  const entry = entryFromDraft(draft);
  const [amountWidth, setAmountWidth] = useState(0);

  const widestAmount = draft.parts.map((part) => {
    const plain = part.kind === 'exact' ? part.amount : formatAmount(preview.get(part.member_id) ?? 0, draft.currency);
    const parsed = parseAmount(plain, draft.currency);

    return parsed === null ? plain : moneyLabel(parsed, draft.currency);
  }).reduce((widest, value) => value.length > widest.length ? value : widest, '');

  const total = parseAmount(draft.amount, draft.currency) ?? 0;
  const hasAmount = total > 0;
  const hue = (memberId: string) => splitHues[Math.max(0, allMembers.findIndex((member) => member.id === memberId)) % splitHues.length] ?? colors.ink;
  const included = draft.parts.map((part) => part.member_id);
  const sharing = draft.parts.filter((part) => part.kind === 'shares').length;

  return (
    <View style={{ paddingBottom: 24 }}>
      <Pressable
        ref={payerToggle}
        accessibilityRole="button"
        accessibilityLabel={`Paid by ${draft.paidBy ? `${memberName(snapshot, draft.paidBy)}${draft.paidBy === you ? ' (you)' : ''}` : 'nobody yet'}. Change payer`}
        accessibilityState={{ expanded: choosingPayer }}
        onPress={() => setChoosingPayer(!choosingPayer)}
        style={({ pressed }) => [{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.rule }, pressed && s.pressed]}
      >
        <Text style={{ fontFamily, fontSize: 16, color: colors.muted }}>Paid by</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>{draft.paidBy ? memberName(snapshot, draft.paidBy) : 'Choose'}</Text>
          <Text style={withTransition({ fontSize: 14, color: colors.ink, transform: [{ rotate: choosingPayer ? '180deg' : '0deg' }] }, 'transform', 350)}>▾</Text>
        </View>
      </Pressable>
      <Reveal toggle={payerToggle} onOutsidePress={() => setChoosingPayer(false)}>
        {choosingPayer ? (
          <View role="radiogroup" aria-label="Paid by">
            {payers.map((member) => (
              <PayerRow
                key={member.id}
                app={props.app}
                memberId={member.id}
                you={member.id === you}
                selected={draft.paidBy === member.id}
                onPress={() => {
                  setChoosingPayer(false);
                  void edit.call('chooseExpensePayer', { memberId: member.id });
                }}
              />
            ))}
          </View>
        ) : null}
      </Reveal>
      <ErrorMessage message={edit.error} />

      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingTop: 16, paddingBottom: 4 }}>
        <Text testID="split-summary" style={{ fontFamily, fontSize: 14, fontWeight: '600', color: draft.parts.length ? colors.muted : colors.owes }}>{splitSummary(draft, preview)}</Text>
      </View>
      {/* Each share grows into the room left after the gaps, so the bar always fits. */}
      <View aria-hidden testID="split-bar" style={{ flexDirection: 'row', height: 10, gap: 2, overflow: 'hidden' }}>
        {included.map((memberId) => (
          <View
            key={memberId}
            style={withTransition({
              flexGrow: hasAmount ? Math.max(0, preview.get(memberId) ?? 0) / total : 1,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 0,
              backgroundColor: hue(memberId),
            }, 'flex-grow', 450)}
          />
        ))}
      </View>
      <View style={{ paddingTop: 8 }}>
        <Text aria-hidden pointerEvents="none" numberOfLines={1} onLayout={(event) => setAmountWidth(Math.ceil(event.nativeEvent.layout.width))} style={{ position: 'absolute', opacity: 0, fontFamily: monoFamily, fontSize: 15, fontWeight: '500' }}>{widestAmount}</Text>
        {members.map((member) => (
          <ExpenseSplitRow key={member.id} memberId={member.id} name={memberName(snapshot, member.id)} you={member.id === you} hue={hue(member.id)} part={draft.parts.find((part) => part.member_id === member.id)} owed={preview.get(member.id)} currency={draft.currency} hasAmount={hasAmount} sharing={sharing} amountWidth={amountWidth} />
        ))}
      </View>

      {hasAmount && !entry.ok && entry.problem !== 'Describe the expense.' ? <Text style={[s.body, { paddingTop: 12, color: colors.owes, fontWeight: '500' }]}>{entry.problem}</Text> : null}
      {!activeMembers(snapshot).length ? <Text style={s.caption}>Add a member first.</Text> : null}
    </View>
  );
}
