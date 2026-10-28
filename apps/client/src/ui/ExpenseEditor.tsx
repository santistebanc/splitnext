import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { activeMembers, formatAmount, parseAmount, preferredMember } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { entryFromDraft, expenseLabel, memberName, previewAllocation, recentCurrencies, type ExpenseDraft, type ExpenseDraftPart } from '../model/expenses';
import { ErrorMessage, HeaderAction, RadioRow, ScreenHeader, colors, s } from './components';
import { CurrencyPicker } from './CurrencyPicker';
import { AmountInput, type AmountInputHandle } from './AmountInput';
import { Drawer } from './Drawer';
import { between, useCompactProgress } from './pageScroll';
import { CheckIcon, ChevronUpIcon, ChevronDownIcon } from './icons';
import { YouBadge } from './YouBadge';
import { fontFamily, monoFamily, radius } from './theme';
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
        start={<HeaderAction text="Cancel" label="Cancel" disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
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

/** A display symbol; the editable currency code still identifies the currency. */
function currencySymbol(currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) return currency;

  return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency;
}

/** One caption for equal shares or a mixture of weights and fixed amounts. */
function splitSummary(draft: ExpenseDraft, preview: Map<string, number>): string {
  if (!draft.parts.length) return 'Pick at least one person';

  const people = draft.parts.length === 1 ? '1 person' : `${draft.parts.length} people`;

  if (draft.parts.some((part) => part.kind === 'exact' || part.shares !== 1)) return `Custom split · ${people}`;
  const each = preview.get(draft.parts[0]!.member_id);

  return each !== undefined ? `${formatAmount(each, draft.currency)} each · ${people}` : 'Enter an amount to split';
}

/** A soft, solid fill shared by selected split checkboxes and share arrows. */
const splitControlFill = { backgroundColor: colors.actionSoft, borderColor: colors.actionSoft };

/** An arrow in a box the shape of the row's checkbox, with a full touch target around it. */
function ShareArrow(props: { up: boolean; label: string; disabled: boolean; onPress: () => void }) {
  const Icon = props.up ? ChevronUpIcon : ChevronDownIcon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [{ width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, props.disabled && s.dim]}
    >
      <View style={[s.checkbox, splitControlFill]}>
        <Icon size={16} color={colors.action} />
      </View>
    </Pressable>
  );
}

/** A person's amount is tappable to fix it; shares keep dividing the remainder. */
function ExpenseSplitRow(props: { memberId: string; name: string; you: boolean; part: ExpenseDraftPart | undefined; owed: number | undefined; currency: string; first: boolean; hasAmount: boolean; amountWidth: number }) {
  const edit = useActionCall();
  const [editing, setEditing] = useState(false);
  const fixed = props.part?.kind === 'exact';
  const included = Boolean(props.part);
  const value = props.part?.kind === 'exact' ? props.part.amount : formatAmount(props.owed ?? 0, props.currency);
  const parsed = parseAmount(value, props.currency);
  const shown = parsed === null ? value : formatAmount(parsed, props.currency);
  const fixing = { memberId: props.memberId, amount: value };
  const member = { memberId: props.memberId };
  const canFix = edit.can('setExpenseFixedAmount', fixing);

  return (
    <View style={[{ minHeight: 44 }, !props.first && s.ruled]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, minHeight: 44 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily, fontSize: 16, lineHeight: 24, color: included ? colors.ink : colors.faint }}>{props.name}</Text>
          {props.you ? <YouBadge /> : null}
        </View>
        <View style={{ width: props.hasAmount ? props.amountWidth + 88 : 44, flexShrink: 0, flexDirection: 'row', alignItems: 'center' }}>
          {props.hasAmount ? (
            <>
              {included ? (
                <ShareArrow up label={`Increase share for ${props.name}`} disabled={!edit.can('increaseExpenseShare', member)} onPress={() => { void edit.call('increaseExpenseShare', member); }} />
              ) : <View style={{ width: 44 }} />}
              <View style={{ width: props.amountWidth, flexShrink: 0, minHeight: 44, justifyContent: 'center' }}>
                {included && editing ? (
                  <TextInput
                    accessibilityLabel={`Amount for ${props.name}`}
                    autoFocus
                    selectTextOnFocus
                    inputMode="decimal"
                    value={fixed ? value : ''}
                    editable={edit.can('setExpenseFixedAmount', { memberId: props.memberId, amount: '' })}
                    onChangeText={(amount) => { void edit.call('setExpenseFixedAmount', { memberId: props.memberId, amount }); }}
                    onBlur={() => setEditing(false)}
                    onSubmitEditing={() => setEditing(false)}
                    returnKeyType="done"
                    style={[s.input, { paddingHorizontal: 4, height: 44, fontSize: 14, textAlign: 'right', fontFamily: monoFamily, color: colors.action }]}
                  />
                ) : included ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Amount for ${props.name}: ${shown} ${props.currency}${fixed ? ', fixed' : ''}. Change amount`}
                    accessibilityState={{ disabled: !canFix }}
                    disabled={!canFix}
                    onPress={() => { void edit.call('setExpenseFixedAmount', fixing, () => setEditing(true)); }}
                    style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center' }, pressed && s.pressed]}
                  >
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ textAlign: 'right', fontFamily: monoFamily, fontSize: 14, lineHeight: 20, fontWeight: '600', color: fixed ? colors.action : colors.muted }}>
                      {`${currencySymbol(props.currency)} ${shown}`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
          {props.hasAmount && (fixed || (props.part?.kind === 'shares' && props.part.shares > 1)) ? (
            <ShareArrow up={false} label={`Decrease share for ${props.name}`} disabled={!edit.can('decreaseExpenseShare', member)} onPress={() => { void edit.call('decreaseExpenseShare', member); }} />
          ) : (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`${props.name} shares this expense`}
              accessibilityState={{ checked: included, disabled: !edit.can('toggleExpenseParticipant', member) }}
              aria-checked={included}
              disabled={!edit.can('toggleExpenseParticipant', member)}
              onPress={() => { void edit.call('toggleExpenseParticipant', member); }}
              style={({ pressed }) => [{ width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, !edit.can('toggleExpenseParticipant', member) && s.dim]}
            >
              <View style={[s.checkbox, included && splitControlFill]}>
                {included ? <CheckIcon size={16} color={colors.action} strokeWidth={2.2} /> : null}
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
 * The expense's controls, fixed above the split: how much, what it was for,
 * who paid, and how it is split. They shrink as the split scrolls under them.
 */
export function ExpenseControls(props: ExpenseEditorProps) {
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const you = preferredMember(snapshot, replica?.session?.identity.id)?.id;
  const draft = useUiState().expense;
  const amount = useRef<AmountInputHandle>(null);
  const progress = useCompactProgress();

  // A new expense starts in its amount; changing one waits for a tap. Opening
  // a screen dismisses the keyboard after this screen's effects, so focus
  // waits a frame.
  useEffect(() => {
    if (draft.expenseId) return;
    const frame = requestAnimationFrame(() => amount.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, []);
  const actions = useActions();
  const save = useActionCall();
  const edit = useActionCall();
  const [choosingPayer, setChoosingPayer] = useState(false);
  const payers = (snapshot?.members ?? []).filter((member) => member.status === 'active' || member.id === draft.paidBy);
  const preview = previewAllocation(snapshot, draft);

  function change(field: 'expense.description' | 'expense.amount' | 'expense.currency', value: string): void {
    void actions.dispatch('changeDraft', { field, value }, { origin: 'ui' });
  }

  function submit(): void {
    if (save.can('saveExpense')) void save.call('saveExpense', {});
  }

  return (
    <View style={{ gap: between(14, 8, progress), paddingTop: between(8, 2, progress), paddingBottom: 4, paddingHorizontal: 8 }}>
      <View style={{ gap: between(8, 6, progress) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <AmountInput
            inputRef={amount}
            value={draft.amount}
            currency={draft.currency}
            onChangeText={(value) => change('expense.amount', value)}
            onSubmitEditing={submit}
            height={between(64, 40, progress)}
            fontSize={between(44, 28, progress)}
          />
          <CurrencyPicker height={between(44, 34, progress)} value={draft.currency} recent={recentCurrencies(snapshot)} onChange={(value) => change('expense.currency', value)} />
        </View>
        <TextInput
          accessibilityLabel="Description"
          placeholder="What was it for?"
          placeholderTextColor={colors.faint}
          value={draft.description}
          onChangeText={(value) => change('expense.description', value)}
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={submit}
          style={[s.textInput, { height: between(48, 38, progress), fontSize: between(17, 15, progress) }]}
        />
      </View>

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
          <Text style={{ fontFamily, fontSize: between(16, 14, progress), color: colors.muted }}>Paid by</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Paid by ${draft.paidBy ? `${memberName(snapshot, draft.paidBy)}${draft.paidBy === you ? ' (you)' : ''}` : 'nobody yet'}. Change payer`}
            accessibilityState={{ expanded: choosingPayer }}
            onPress={() => setChoosingPayer(!choosingPayer)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, height: between(36, 30, progress), paddingHorizontal: 8, borderRadius: radius.small }, choosingPayer && { backgroundColor: colors.track }, pressed && s.pressed]}
          >
            <Text style={{ fontFamily, fontSize: between(16, 14, progress), fontWeight: '600', color: colors.ink }}>
              {draft.paidBy ? (draft.paidBy === you ? 'you' : memberName(snapshot, draft.paidBy)) : 'Choose'}
            </Text>
            <ChevronDownIcon size={14} strokeWidth={2.2} />
          </Pressable>
        </View>
        {choosingPayer ? (
          <Drawer title="Paid by" onClose={() => setChoosingPayer(false)}>
            <ScrollView style={{ flexShrink: 1 }}>
              <View accessibilityRole="radiogroup" accessibilityLabel="Paid by" style={{ gap: 6 }}>
                {payers.map((member) => (
                  <RadioRow
                    compact
                    key={member.id}
                    label={`${memberName(snapshot, member.id)}${member.id === you ? ' (you)' : ''}`}
                    accessibilityLabel={memberName(snapshot, member.id)}
                    selected={draft.paidBy === member.id}
                    onPress={() => {
                      setChoosingPayer(false);
                      void edit.call('chooseExpensePayer', { memberId: member.id });
                    }}
                  />
                ))}
              </View>
            </ScrollView>
          </Drawer>
        ) : null}
        <ErrorMessage message={edit.error} />
      </View>

      <Text testID="split-summary" style={{ paddingHorizontal: 2, fontFamily, fontSize: 14, fontWeight: '600', color: draft.parts.length ? colors.soft : colors.owes }}>{splitSummary(draft, preview)}</Text>
    </View>
  );
}

/** How the expense is split, the one part of the editor that scrolls. */
export function ExpenseEditor(props: ExpenseEditorProps) {
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const you = preferredMember(snapshot, replica?.session?.identity.id)?.id;
  const draft = useUiState().expense;

  // Active members, and anyone the expense already names who was removed since.
  const members = (snapshot?.members ?? []).filter(
    (member) => member.status === 'active' || draft.parts.some((part) => part.member_id === member.id) || member.id === draft.paidBy,
  );

  const preview = previewAllocation(snapshot, draft);
  const entry = entryFromDraft(draft);
  const hasAmount = (parseAmount(draft.amount, draft.currency) ?? 0) > 0;
  const described = Boolean(draft.description.trim());
  const [amountWidth, setAmountWidth] = useState(0);

  // Plex Mono has equal-width glyphs, so the longest formatted value sizes every row.
  const widestAmount = draft.parts.map((part) => {
    const value = part.kind === 'exact' ? part.amount : formatAmount(preview.get(part.member_id) ?? 0, draft.currency);
    const parsed = parseAmount(value, draft.currency);

    return `${currencySymbol(draft.currency)} ${parsed === null ? value : formatAmount(parsed, draft.currency)}`;
  }).reduce((longest, value) => value.length > longest.length ? value : longest, '');

  return (
    <View style={{ gap: 12, paddingHorizontal: 4, paddingBottom: 24 }}>
      <Text aria-hidden pointerEvents="none" onLayout={(event) => setAmountWidth(Math.ceil(event.nativeEvent.layout.width))} style={{ position: 'absolute', opacity: 0, alignSelf: 'flex-start', fontFamily: monoFamily, fontSize: 14, fontWeight: '600', lineHeight: 20 }}>{widestAmount}</Text>
      <View style={{ borderRadius: radius.card, backgroundColor: colors.surface, overflow: 'hidden' }}>
        {members.map((member, index) => (
          <ExpenseSplitRow key={member.id} memberId={member.id} name={memberName(snapshot, member.id)} you={member.id === you} part={draft.parts.find((part) => part.member_id === member.id)} owed={preview.get(member.id)} currency={draft.currency} first={index === 0} hasAmount={hasAmount} amountWidth={amountWidth} />
        ))}
      </View>

      {described && !entry.ok ? <Text style={s.caption}>{entry.problem}</Text> : null}
      {!activeMembers(snapshot).length ? <Text style={s.caption}>Add a member first.</Text> : null}
    </View>
  );
}
