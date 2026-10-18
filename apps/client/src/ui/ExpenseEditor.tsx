import { Pressable, Text, TextInput, View } from 'react-native';
import { activeMembers } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { entryFromDraft, memberName, moneyLabel, previewAllocation, type ExpenseSplit } from '../model/expenses';
import { Button, Choice, ErrorMessage, Field, s } from './components';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type ExpenseEditorApp = Pick<AppController, 'snapshot'>;

type ExpenseEditorProps = {
  app: ExpenseEditorApp;
  fullPage?: boolean;
};

const splitLabels: Record<ExpenseSplit, string> = { equal: 'Equally', shares: 'By shares', amounts: 'By amounts' };

/** Adding or changing an expense, as a sheet or a full page on touch. */
export function ExpenseEditor(props: ExpenseEditorProps) {
  const snapshot = props.app.snapshot().group?.projected_snapshot;
  const draft = useUiState().expense;
  const actions = useActions();
  const back = useActionCall();
  const save = useActionCall();
  const edit = useActionCall();

  // Active members, and anyone the expense already names who was removed since.
  const members = (snapshot?.members ?? []).filter(
    (member) => member.status === 'active' || draft.participants.includes(member.id) || member.id === draft.paidBy,
  );

  const preview = previewAllocation(snapshot, draft);
  const entry = entryFromDraft(draft);
  const started = Boolean(draft.description.trim() || draft.amount.trim());

  function change(field: 'expense.description' | 'expense.amount' | 'expense.currency', value: string): void {
    void actions.dispatch('changeDraft', { field, value }, { origin: 'ui' });
  }

  function submit(): void {
    if (save.can('saveExpense')) void save.call('saveExpense', {});
  }

  return (
    <>
      <View style={s.between}>
        <Text accessibilityRole="header" style={s.heading}>
          {draft.expenseId ? 'Change expense' : 'Add expense'}
        </Text>
        <Button
          quiet
          disabled={!back.can('closePanel')}
          onPress={() => {
            void back.call('closePanel', {});
          }}
        >
          {props.fullPage ? 'Back to group' : 'Cancel'}
        </Button>
      </View>
      <Field
        label="Description"
        placeholder="Dinner, taxi, tickets…"
        value={draft.description}
        onChangeText={(value) => change('expense.description', value)}
        maxLength={100}
        returnKeyType="next"
      />
      <View style={s.row}>
        <View style={s.personText}>
          <Field
            label="Amount"
            placeholder="0.00"
            value={draft.amount}
            inputMode="decimal"
            onChangeText={(value) => change('expense.amount', value)}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
        </View>
        <View style={s.currencyField}>
          <Field
            label="Currency"
            value={draft.currency}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            onChangeText={(value) => change('expense.currency', value)}
          />
        </View>
      </View>
      <Text style={s.label}>Paid by</Text>
      <View style={[s.row, s.wrapRow]}>
        {members
          .filter((member) => member.status === 'active' || member.id === draft.paidBy)
          .map((member) => (
            <Choice
              key={member.id}
              selected={draft.paidBy === member.id}
              onPress={() => {
                void edit.call('chooseExpensePayer', { memberId: member.id });
              }}
            >
              {memberName(snapshot, member.id)}
            </Choice>
          ))}
      </View>
      <Text style={s.label}>Split</Text>
      <View style={s.row}>
        {(['equal', 'shares', 'amounts'] as const).map((split) => (
          <Choice
            key={split}
            selected={draft.split === split}
            onPress={() => {
              void edit.call('setExpenseSplit', { split });
            }}
          >
            {splitLabels[split]}
          </Choice>
        ))}
      </View>
      <View>
        {members.map((member) => {
          const included = draft.participants.includes(member.id);
          const owed = preview.get(member.id);
          const name = memberName(snapshot, member.id);

          return (
            <View key={member.id} style={s.ledgerRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`${name} shares this expense`}
                accessibilityState={{ checked: included }}
                aria-checked={included}
                onPress={() => {
                  void edit.call('toggleExpenseParticipant', { memberId: member.id });
                }}
                style={[s.ledgerRow, s.personText]}
              >
                <View style={[s.checkbox, included && s.checked]}>
                  {included ? <Text style={s.checkMark}>✓</Text> : null}
                </View>
                <Text numberOfLines={1} style={[s.name, s.memberName]}>
                  {name}
                </Text>
              </Pressable>
              {included && draft.split !== 'equal' ? (
                <TextInput
                  accessibilityLabel={`${draft.split === 'shares' ? 'Shares' : 'Amount'} for ${name}`}
                  placeholder={draft.split === 'shares' ? '1' : 'rest'}
                  inputMode={draft.split === 'shares' ? 'numeric' : 'decimal'}
                  value={draft.values[member.id] ?? ''}
                  onChangeText={(value) => {
                    void edit.call('setExpenseValue', { memberId: member.id, value });
                  }}
                  style={[s.input, s.splitInput]}
                />
              ) : null}
              <Text style={[s.amount, s.caption]}>
                {included && owed !== undefined ? moneyLabel(owed, draft.currency) : ''}
              </Text>
            </View>
          );
        })}
      </View>
      {started && !entry.ok ? <Text style={s.caption}>{entry.problem}</Text> : null}
      <Button disabled={!save.can('saveExpense')} onPress={submit}>
        {draft.expenseId ? 'Save changes' : 'Add expense'}
      </Button>
      <ErrorMessage message={save.error ?? edit.error ?? back.error} />
      {!activeMembers(snapshot).length ? <Text style={s.caption}>Add a member first.</Text> : null}
    </>
  );
}
