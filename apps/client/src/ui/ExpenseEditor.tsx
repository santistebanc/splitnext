import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { activeMembers, formatAmount, parseAmount, preferredMember } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { entryFromDraft, expenseLabel, memberName, previewAllocation, type ExpenseDraft, type ExpenseDraftPart } from '../model/expenses';
import { ErrorMessage, HeaderAction, RadioRow, ScreenHeader, colors, s } from './components';
import { AmountInput, type AmountInputHandle } from './AmountInput';
import { between, useCompactProgress } from './pageScroll';
import { Reveal } from './Reveal';
import { morph } from './ScreenMorph';
import { YouBadge } from './YouBadge';
import { fontFamily, monoFamily, splitHues, withTransition } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type ExpenseEditorApp = Pick<AppController, 'snapshot'>;

type ExpenseEditorProps = { app: ExpenseEditorApp };

/** The editor's header: Cancel and Save, with Delete for a recorded expense. */
export function ExpenseEditorHeader(props: ExpenseEditorProps) {
  const back = useActionCall();
  const save = useActionCall();
  const remove = useActionCall();
  const draft = useUiState().expense;
  const expense = props.app.snapshot().group?.projected_snapshot?.expenses.find((entry) => entry.id === draft.expenseId);

  return (
    <>
      <ScreenHeader
        start={<HeaderAction quiet text="Cancel" label="Cancel" disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
        end={(
          <>
            {expense ? (
              <HeaderAction danger text="Delete" label={`Delete ${expenseLabel(expense)}`} disabled={!remove.can('removeExpense', { expenseId: expense.id })} onPress={() => { void remove.call('removeExpense', { expenseId: expense.id }, () => { void back.call('closePanel', {}); }); }} />
            ) : null}
            <HeaderAction primary text={save.busy ? 'Saving…' : 'Save'} label="Save" disabled={!save.can('saveExpense')} onPress={() => { void save.call('saveExpense', {}); }} />
          </>
        )}
      />
      <ErrorMessage message={back.error ?? save.error ?? remove.error} />
    </>
  );
}

/** “15.00 each” for an equal split, or how many people share a custom one. */
function splitSummary(draft: ExpenseDraft, preview: Map<string, number>): string {
  if (!draft.parts.length) return 'Pick at least one person';

  const people = draft.parts.length === 1 ? '1 person' : `${draft.parts.length} people`;

  if (draft.parts.some((part) => part.kind === 'exact' || part.shares !== 1)) return people;
  const each = preview.get(draft.parts[0]!.member_id);

  return each !== undefined ? `${formatAmount(each, draft.currency)} each` : 'Enter an amount to split';
}

/** Whether a draft differs from everyone sharing equally. */
function isCustom(draft: ExpenseDraft, members: readonly { id: string; status: string }[]): boolean {
  const active = members.filter((member) => member.status === 'active');

  return active.some((member) => !draft.parts.some((part) => part.member_id === member.id)) ||
    draft.parts.some((part) => part.kind === 'exact' || part.shares !== 1);
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
 * One person in the split: their colour in the bar, + for another share,
 * their amount, which can be tapped to fix it while the others divide the
 * rest, and at the end whether they share it, or − to take a share away.
 * `sharing` counts the people dividing the rest by shares.
 */
function ExpenseSplitRow(props: { memberId: string; name: string; you: boolean; hue: string; part: ExpenseDraftPart | undefined; owed: number | undefined; currency: string; hasAmount: boolean; sharing: number }) {
  const edit = useActionCall();
  const [editing, setEditing] = useState(false);
  const input = useRef<TextInput>(null);
  const fixed = props.part?.kind === 'exact';
  const included = Boolean(props.part);
  const shares = props.part?.kind === 'shares' ? props.part.shares : 1;
  const value = props.part?.kind === 'exact' ? props.part.amount : formatAmount(props.owed ?? 0, props.currency);
  const parsed = parseAmount(value, props.currency);
  const shown = parsed === null ? value : formatAmount(parsed, props.currency);
  const fixing = { memberId: props.memberId, amount: value };
  const member = { memberId: props.memberId };
  const canFix = props.hasAmount && edit.can('setExpenseFixedAmount', fixing);
  const canToggle = edit.can('toggleExpenseParticipant', member);
  // As in the earlier app: the checkbox becomes − once someone has more than
  // one share or a fixed amount, and + shows while it changes the split.
  const stepping = included && (fixed || shares > 1);
  const canIncrease = included && (fixed || props.sharing > 1);

  // Fixing the amount shows the field before editing starts, so autoFocus
  // would come too late; focus it once editing begins.
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
        <View style={{ width: 44, marginRight: -10 }}>
          {canIncrease ? (
            <ShareStep sign="+" label={`Increase share for ${props.name}`} disabled={!edit.can('increaseExpenseShare', member)} onPress={() => { void edit.call('increaseExpenseShare', member); }} />
          ) : null}
        </View>
        <View style={{ width: 72, alignItems: 'flex-end' }}>
          {!included ? null : editing || fixed ? (
            <TextInput
              ref={input}
              accessibilityLabel={`Amount for ${props.name}`}
              selectTextOnFocus
              inputMode="decimal"
              value={fixed ? value : ''}
              editable={edit.can('setExpenseFixedAmount', { memberId: props.memberId, amount: '' })}
              onChangeText={(amount) => { void edit.call('setExpenseFixedAmount', { memberId: props.memberId, amount }); }}
              onFocus={() => setEditing(true)}
              onBlur={() => setEditing(false)}
              onSubmitEditing={() => setEditing(false)}
              returnKeyType="done"
              style={{ width: 72, height: 40, paddingVertical: 2, textAlign: 'right', fontFamily: monoFamily, fontSize: 15, fontWeight: '500', color: colors.ink, borderBottomWidth: 1.5, borderColor: colors.ink }}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={props.hasAmount ? `Amount for ${props.name}: ${shown}. Change amount` : `${props.name}: no amount`}
              accessibilityState={{ disabled: !canFix }}
              disabled={!canFix}
              onPress={() => { void edit.call('setExpenseFixedAmount', fixing, () => setEditing(true)); }}
              style={({ pressed }) => [{ height: 44, justifyContent: 'center' }, pressed && s.pressed]}
            >
              <Text numberOfLines={1} style={{ textAlign: 'right', fontFamily: monoFamily, fontSize: 15, fontWeight: '500', color: colors.ink }}>
                {props.hasAmount ? shown : '—'}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={{ width: 44, marginHorizontal: -13 }}>
          {stepping ? (
            <ShareStep sign="−" label={`Decrease share for ${props.name}`} disabled={!edit.can('decreaseExpenseShare', member)} onPress={() => { void edit.call('decreaseExpenseShare', member); }} />
          ) : (
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
          )}
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
    const frame = requestAnimationFrame(() => amount.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, []);

  function change(field: 'expense.description' | 'expense.amount', value: string): void {
    void actions.dispatch('changeDraft', { field, value }, { origin: 'ui' });
  }

  function submit(): void {
    if (save.can('saveExpense')) void save.call('saveExpense', {});
  }

  const titleSize = between(24, 18, progress);

  return (
    <View style={{ paddingBottom: between(14, 6, progress) }}>
      <View style={{ marginTop: between(12, 0, progress), paddingBottom: between(10, 6, progress), borderBottomWidth: 1.5, borderColor: colors.ink, flexDirection: 'row' }}>
        <View ref={morph(draft.expenseId ? `eamt-${draft.expenseId}` : null)} style={{ flex: 1, minWidth: 0, flexDirection: 'row' }}>
        <AmountInput
          inputRef={amount}
          value={draft.amount}
          currency={draft.currency}
          onChangeText={(value) => change('expense.amount', value)}
          onSubmitEditing={submit}
          height={between(60, 36, progress)}
          fontSize={between(56, 32, progress)}
        />
        </View>
      </View>
      <View style={{ paddingTop: between(16, 8, progress), paddingBottom: between(14, 8, progress), borderBottomWidth: 1, borderColor: colors.rule }}>
        <TextInput
          ref={morph(draft.expenseId ? `etitle-${draft.expenseId}` : 'addexp')}
          accessibilityLabel="Description"
          placeholder="New expense"
          placeholderTextColor={colors.placeholder}
          value={draft.description}
          onChangeText={(value) => change('expense.description', value)}
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={submit}
          style={{ height: titleSize * 1.2, padding: 0, fontFamily, fontSize: titleSize, fontWeight: '600', letterSpacing: -0.02 * titleSize, color: colors.ink }}
        />
      </View>
    </View>
  );
}

/** Who paid, opening the names in place, then how it is split. */
export function ExpenseEditor(props: ExpenseEditorProps) {
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const you = preferredMember(snapshot, replica?.session?.identity.id)?.id;
  const draft = useUiState().expense;
  const edit = useActionCall();
  const reset = useActionCall();
  const [choosingPayer, setChoosingPayer] = useState(false);
  const allMembers = snapshot?.members ?? [];

  // Active members, and anyone the expense already names who was removed since.
  const members = allMembers.filter(
    (member) => member.status === 'active' || draft.parts.some((part) => part.member_id === member.id) || member.id === draft.paidBy,
  );

  const payers = allMembers.filter((member) => member.status === 'active' || member.id === draft.paidBy);
  const preview = previewAllocation(snapshot, draft);
  const entry = entryFromDraft(draft);
  const total = parseAmount(draft.amount, draft.currency) ?? 0;
  const hasAmount = total > 0;
  const hue = (memberId: string) => splitHues[Math.max(0, allMembers.findIndex((member) => member.id === memberId)) % splitHues.length] ?? colors.ink;
  const custom = isCustom(draft, allMembers);
  const included = draft.parts.map((part) => part.member_id);
  const sharing = draft.parts.filter((part) => part.kind === 'shares').length;

  return (
    <View style={{ paddingBottom: 24 }}>
      <Pressable
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
      <Reveal>
        {choosingPayer ? (
          <View role="radiogroup" aria-label="Paid by">
            {payers.map((member) => (
              <RadioRow
                compact
                key={member.id}
                label={memberName(snapshot, member.id)}
                selected={draft.paidBy === member.id}
                style={{ borderTopWidth: 0, borderBottomWidth: 1, borderColor: colors.rule }}
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

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingTop: 16, paddingBottom: 4 }}>
        <Text testID="split-summary" style={{ fontFamily, fontSize: 14, fontWeight: '600', color: draft.parts.length ? colors.muted : colors.owes }}>{splitSummary(draft, preview)}</Text>
        {custom ? (
          <Pressable
            accessibilityRole="button"
            disabled={!reset.can('splitExpenseEqually')}
            onPress={() => { void reset.call('splitExpenseEqually', {}); }}
            style={({ pressed }) => [{ height: 44, justifyContent: 'center', paddingLeft: 16, paddingRight: 24, marginRight: -24 }, pressed && s.pressed]}
          >
            <Text style={[s.headerActionText, s.link, { fontSize: 14 }]}>Split equally</Text>
          </Pressable>
        ) : null}
      </View>
      <View aria-hidden style={{ flexDirection: 'row', height: 10, gap: 2 }}>
        {included.map((memberId) => (
          <View
            key={memberId}
            style={withTransition({
              width: `${hasAmount ? (Math.max(0, preview.get(memberId) ?? 0) / total) * 100 : 100 / included.length}%`,
              backgroundColor: hue(memberId),
            }, 'width', 450)}
          />
        ))}
      </View>
      <View style={{ paddingTop: 8 }}>
        {members.map((member) => (
          <ExpenseSplitRow key={member.id} memberId={member.id} name={memberName(snapshot, member.id)} you={member.id === you} hue={hue(member.id)} part={draft.parts.find((part) => part.member_id === member.id)} owed={preview.get(member.id)} currency={draft.currency} hasAmount={hasAmount} sharing={sharing} />
        ))}
      </View>

      {hasAmount && !entry.ok && entry.problem !== 'Describe the expense.' ? <Text style={[s.body, { paddingTop: 12, color: colors.owes, fontWeight: '500' }]}>{entry.problem}</Text> : null}
      {!activeMembers(snapshot).length ? <Text style={s.caption}>Add a member first.</Text> : null}
      <ErrorMessage message={reset.error} />
    </View>
  );
}
