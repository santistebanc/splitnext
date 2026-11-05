import { z } from 'zod';
import { inverseIntent, undoProblem, undoExplanation, memberHasRecords, repaymentMembers, allocate, currencyCodeSchema, expenseDescriptionSchema, groupNameSchema, memberLabel, memberNameSchema, nameOrdinals, parseAmount, requiresServerDecision } from '@splitnext/client';
import { balanceRows, entryFromDraft, equalParts, noCurrency } from '../expenses';
import { requireSettlement, unavailable, editorLock, defineAction, openSnapshot, requireExpense, requireExpenseEntry, expenseResource, requireMember, requireRemovedMember, requireNotice, requireName, memberResource, noticeResources, empty, choice, suggested } from './define';

/** Changes to the shared ledger; they can queue offline. */
export const ledgerActions = {
  undoChange: defineAction({
    group: 'Ledger changes', description: 'Reverse a recorded action with the ordinary opposite action, such as removing what it added or renaming back, without overwriting later changes.', input: z.object({ eventId: choice('activity', 'The Activity action to undo.') }), example: { eventId: 'event-1' }, requires: ['openGroup'],
    unavailable: ({ state }, input) => {
      const snapshot = openSnapshot(state);
      const event = state.group?.activity.find((entry) => input ? entry.id === input.eventId : snapshot && !undoProblem(snapshot, entry));

      if (!snapshot || !event) return unavailable('undo_not_found', 'Choose a saved Activity action.');
      const problem = undoProblem(snapshot, event, state.group?.activity);

      return problem ? unavailable(problem, undoExplanation(problem)) : null;
    },
    run: (host, input) => {
      const event = host.snapshot().group?.activity.find((entry) => entry.id === input.eventId);
      const intent = event ? inverseIntent(event) : null;

      if (!intent) throw new Error('undo_not_supported');

      return host.submit(intent);
    },
  }),
  saveRepayment: defineAction({
    workflow: 'draft', group: 'Ledger changes', description: 'Save the repayment at the version opened for editing.', input: empty, example: {}, requires: ['openGroup'],
    holds: ({ state, ui }) => ui.repayment.settlementId ? [`settlement:${state.group?.group_id}:${ui.repayment.settlementId}`] : [],
    unavailable: ({ state, ui }) => {
      const draft = ui.repayment;

      return ui.view === 'settlements' && draft.settlementId && draft.from !== draft.to && currencyCodeSchema.safeParse(draft.currency).success && [draft.from, draft.to].every((id) => openSnapshot(state)?.members.some((member) => member.id === id)) && (parseAmount(draft.amount, draft.currency) ?? 0) > 0 ? requireSettlement(state, draft.settlementId) : unavailable('invalid_input', 'Open a repayment and enter a positive amount.');
    },
    run: async (host, input, ui) => {
      const draft = ui.snapshot().repayment;

      if (!draft.settlementId || !draft.expectedVersion) throw new Error('settlement_not_found');
      await host.submit({ type: 'settlement.edit', payload: { settlement_id: draft.settlementId, expected_version: draft.expectedVersion, from_member_id: draft.from, to_member_id: draft.to, currency: draft.currency, amount: parseAmount(draft.amount, draft.currency) ?? 0 } });
      ui.changeRepayment({ amount: '', settlementId: null, expectedVersion: null });
    },
  }),
  removeSettlement: defineAction({
    holds: ({ state }, input) => input ? [`settlement:${state.group?.group_id}:${input.settlementId}`] : [],
    group: 'Ledger changes', description: 'Remove a repayment from balances.', input: z.object({ settlementId: choice('settlement', 'The repayment to remove.') }), example: { settlementId: 'settlement-1' }, requires: ['openGroup'],
    unavailable: ({ state }, input) => requireSettlement(state, input?.settlementId),
    run: (host, input) => host.submit({ type: 'settlement.remove', payload: { settlement_id: input.settlementId } }),
  }),
  restoreSettlement: defineAction({
    holds: ({ state }, input) => input ? [`settlement:${state.group?.group_id}:${input.settlementId}`] : [],
    group: 'Ledger changes', description: 'Restore a removed repayment exactly as recorded.', input: z.object({ settlementId: choice('removedSettlement', 'The repayment to restore.') }), example: { settlementId: 'settlement-1' }, requires: ['openGroup'],
    unavailable: ({ state }, input) => requireSettlement(state, input?.settlementId, 'removed'),
    run: (host, input) => host.submit({ type: 'settlement.restore', payload: { settlement_id: input.settlementId } }),
  }),
  recordSettlement: defineAction({
    group: 'Ledger changes', description: 'Record money already repaid outside Splitnext.',
    input: z.object({ from: choice('repaymentMember', 'Who paid.'), to: choice('repaymentMember', 'Who received it.'), amount: z.string(), currency: currencyCodeSchema.optional().meta({ description: 'Only for settling a balance recorded with a real currency before amounts became plain numbers.' }) }),
    example: { from: 'member-1', to: 'member-2', amount: '10.00' }, requires: ['openGroup'],
    unavailable: ({ state }, input) => {
      if (!input) return repaymentMembers(openSnapshot(state)).length > 1 ? null : unavailable('member_not_found', 'Add another member first.');
      const members = repaymentMembers(openSnapshot(state));

      return input.from !== input.to && members.some((member) => member.id === input.from) && members.some((member) => member.id === input.to) && (parseAmount(input.amount, input.currency ?? noCurrency) ?? 0) > 0
        ? null : unavailable('invalid_input', 'Choose two different members and a positive amount.');
    },
    run: async (host, input, ui) => {
      const currency = input.currency ?? noCurrency;

      await host.submit({ type: 'settlement.record', payload: { from_member_id: input.from, to_member_id: input.to, currency, amount: parseAmount(input.amount, currency) ?? 0 } });
      // Like a new expense, the repayment then leads the group's expenses.
      ui.update({ groupTab: 'expenses' });
    },
  }),
  saveMemberEdit: defineAction({
    holds: ({ state, ui }) => [editorLock, ...memberResource(state, ui.memberEdit?.memberId)],
    group: 'Ledger changes',
    description: 'Commit the current member-name draft.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    unavailable: ({ ui, state }) =>
      !ui.memberEdit
        ? unavailable('no_member_edit', 'Edit a member first.')
        : ((ui.memberEdit.memberId
            ? requireMember(state, ui.memberEdit.memberId)
            : null) ??
          (ui.memberEdit.name.trim()
            ? requireName(memberNameSchema, ui.memberEdit.name, 'member name')
            : null)),
    run: async (host, input, ui) => {
      const edit = ui.snapshot().memberEdit;

      if (!edit) return;
      const name = edit.name.trim();

      if (name && !edit.memberId) {
        await host.submit({ type: 'member.create', payload: { display_name: name } });
      } else if (name && name !== edit.expectedName && edit.memberId)
        await host.submit({
          type: 'member.rename',
          payload: { member_id: edit.memberId, display_name: name, expected_display_name: edit.expectedName },
        });
      ui.finishMemberEdit(edit);
    },
  }),
  saveGroupSettings: defineAction({
    holds: ({ state }) => [`groupName:${state.group?.group_id}`],
    workflow: 'saveSettings',
    group: 'Ledger changes',
    description: 'Save the group-name draft and return to the group.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    unavailable: ({ ui }) =>
      requireName(groupNameSchema, ui.settings.name, 'group name') ??
      (ui.settings.name.trim() === ui.settings.expectedName
        ? unavailable('draft_unchanged', 'Change the group name first.')
        : null),
    run: async (host, input, ui) => {
      const draft = ui.snapshot().settings;
      const name = groupNameSchema.parse(draft.name);

      await host.submit({ type: 'group.rename', payload: { name, expected_name: draft.expectedName } });
    },
  }),
  renameGroup: defineAction({
    holds: ({ state }) => [`groupName:${state.group?.group_id}`],
    group: 'Ledger changes',
    description: 'Rename the open group.',
    input: z.object({
      name: groupNameSchema.meta({ description: 'The new group name.' }),
      expectedName: suggested(
        z.string(),
        'groupName',
        'The name you saw; defaults to the current name.',
      ).optional(),
    }),
    example: { name: 'Lisbon long weekend' },
    requires: ['openGroup'],
    run: (host, input) =>
      host.submit({ type: 'group.rename', payload: { name: input.name, expected_name: input.expectedName } }),
  }),
  createMember: defineAction({
    group: 'Ledger changes',
    description: 'Add a member to the open group.',
    input: z.object({
      name: memberNameSchema.meta({ description: "The new member's name." }),
    }),
    example: { name: 'Ben' },
    requires: ['openGroup'],
    run: (host, input) => host.submit({ type: 'member.create', payload: { display_name: input.name } }),
  }),
  renameMember: defineAction({
    holds: ({ state }, input) => memberResource(state, input?.memberId),
    group: 'Ledger changes',
    description: 'Rename a member of the open group.',
    input: z.object({
      memberId: choice('member', 'The member to rename.'),
      name: memberNameSchema.meta({ description: 'The new member name.' }),
      expectedName: suggested(
        z.string(),
        'memberName',
        "The name you saw; defaults to the member's current name.",
      ).optional(),
    }),
    example: { memberId: 'member-2', name: 'Benjamin' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    run: (host, input) =>
      host.submit({
        type: 'member.rename',
        payload: { member_id: input.memberId, display_name: input.name, expected_display_name: input.expectedName },
      }),
  }),
  removeMember: defineAction({
    holds: ({ state }, input) => memberResource(state, input?.memberId),
    group: 'Ledger changes',
    description:
      'Take a settled member out of the open group: hidden when an expense or repayment names them, removed otherwise. Their name stays in history.',
    input: z.object({
      memberId: choice('preferredMember', 'The member to hide or remove.'),
    }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => {
      const missing = requireMember(state, input?.memberId);

      if (missing || !input) return missing;

      // Only a zero balance in every currency lets someone go.
      return balanceRows(openSnapshot(state)).some(({ rows }) => rows.some((row) => row.member.id === input.memberId && row.amount !== 0))
        ? unavailable('member_has_balance', 'Settle up with this person first.')
        : null;
    },
    run: async (host, input, ui) => {
      const snapshot = openSnapshot(host.snapshot());
      const name = memberLabel(snapshot?.members.find((member) => member.id === input.memberId)?.display_name ?? '', nameOrdinals(snapshot).get(input.memberId));
      // The group hides a member any expense or repayment has ever named, removed ones included, and deletes the rest.
      const hidden = Boolean(snapshot && memberHasRecords(snapshot, input.memberId));

      await host.submit({ type: 'member.remove', payload: { member_id: input.memberId } });

      if (ui.snapshot().memberEdit?.memberId === input.memberId)
        ui.finishMemberEdit();
      // Confirm whether the member was hidden or removed.
      ui.removed(input.memberId, name, hidden);
    },
  }),
  restoreMember: defineAction({
    holds: ({ state }, input) => memberResource(state, input?.memberId),
    group: 'Ledger changes',
    description: 'Make a removed member of the open group current again.',
    input: z.object({
      memberId: choice('removedMember', 'The removed member to restore.'),
    }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireRemovedMember(state, input?.memberId),
    run: async (host, input, ui) => {
      await host.submit({ type: 'member.restore', payload: { member_id: input.memberId } });

      if (ui.snapshot().removal?.memberId === input.memberId) ui.update({ removal: null });
    },
  }),
  saveExpense: defineAction({
    holds: ({ state, ui }) => expenseResource(state, ui.expense.expenseId),
    workflow: 'saveExpense',
    group: 'Ledger changes',
    description: 'Save the expense being entered and return to the group.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    unavailable: ({ state, ui }) => {
      const draft = ui.expense;
      const entry = entryFromDraft(draft);

      if (draft.expenseId) {
        const missing = requireExpense(state, draft.expenseId, 'active');

        if (missing) return missing;
      }

      return entry.ok ? null : unavailable('invalid_input', entry.problem);
    },
    run: async (host, input, ui) => {
      const draft = ui.snapshot().expense;
      const result = entryFromDraft(draft);

      if (!result.ok) throw new Error('invalid_input');

      await (draft.expenseId && draft.expectedVersion
        ? host.submit({
            type: 'expense.edit',
            payload: { ...result.entry, expense_id: draft.expenseId, expected_version: draft.expectedVersion },
          })
        : host.submit({ type: 'expense.record', payload: result.entry }));

      // A new expense returns to the expenses, where it now leads the list.
      if (!draft.expenseId) ui.update({ groupTab: 'expenses' });
    },
  }),
  recordExpense: defineAction({
    group: 'Ledger changes',
    description: 'Record an expense in the open group, split equally between its current members.',
    input: z.object({
      description: expenseDescriptionSchema.meta({ description: 'What the expense was for.' }),
      amount: z.string().meta({ description: 'The amount paid, such as 12.50.' }),
      paidBy: choice('member', 'The member who paid.'),
    }),
    example: { description: 'Dinner', amount: '42.50', paidBy: 'member-1' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireExpenseEntry(input) ?? requireMember(state, input?.paidBy),
    run: (host, input) =>
      host.submit({
        type: 'expense.record',
        payload: {
          description: input.description,
          currency: noCurrency,
          total: parseAmount(input.amount, noCurrency) ?? 0,
          paid_by: input.paidBy,
          parts: equalParts(openSnapshot(host.snapshot())),
        },
      }),
  }),
  editExpense: defineAction({
    holds: ({ state }, input) => expenseResource(state, input?.expenseId),
    group: 'Ledger changes',
    description: 'Change what was entered for an expense, keeping how it is split.',
    input: z.object({
      expenseId: choice('expense', 'The expense to change.'),
      description: expenseDescriptionSchema.meta({ description: 'What the expense was for.' }),
      amount: z.string().meta({ description: 'The amount paid, such as 12.50.' }),
      paidBy: choice('member', 'The member who paid.'),
    }),
    example: { expenseId: 'expense-1', description: 'Dinner', amount: '45.00', paidBy: 'member-1' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => {
      const blocked = requireExpense(state, input?.expenseId, 'active') ?? requireExpenseEntry(input) ?? requireMember(state, input?.paidBy);
      const expense = openSnapshot(state)?.expenses.find((entry) => entry.id === input?.expenseId);

      if (blocked || !input || !expense) return blocked;

      return allocate(parseAmount(input.amount, expense.currency) ?? 0, expense.parts).ok
        ? null
        : unavailable('invalid_input', 'The new amount does not fit how this expense is split.');
    },
    run: (host, input) => {
      const expense = openSnapshot(host.snapshot())?.expenses.find((entry) => entry.id === input.expenseId);

      if (!expense) throw new Error('expense_not_found');

      return host.submit({
        type: 'expense.edit',
        payload: {
          expense_id: expense.id,
          expected_version: expense.version,
          description: input.description,
          currency: expense.currency,
          total: parseAmount(input.amount, expense.currency) ?? 0,
          paid_by: input.paidBy,
          parts: expense.parts,
        },
      });
    },
  }),
  removeExpense: defineAction({
    holds: ({ state }, input) => expenseResource(state, input?.expenseId),
    group: 'Ledger changes',
    description: 'Take an expense out of the balances of the open group.',
    input: z.object({
      expenseId: choice('expense', 'The expense to remove.'),
    }),
    example: { expenseId: 'expense-1' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireExpense(state, input?.expenseId, 'active'),
    run: (host, input) => host.submit({ type: 'expense.remove', payload: { expense_id: input.expenseId } }),
  }),
  restoreExpense: defineAction({
    holds: ({ state }, input) => expenseResource(state, input?.expenseId),
    group: 'Ledger changes',
    description: 'Return a removed expense to the balances of the open group, as it was recorded.',
    input: z.object({
      expenseId: choice('removedExpense', 'The removed expense to restore.'),
    }),
    example: { expenseId: 'expense-1' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireExpense(state, input?.expenseId, 'removed'),
    run: (host, input) => host.submit({ type: 'expense.restore', payload: { expense_id: input.expenseId } }),
  }),
  retryNotice: defineAction({
    waitsFor: ({ state }, input) => state.group?.notices.some((entry) => entry.command.command_id === input?.commandId && entry.command.type === 'group.leave') ? [editorLock] : [],
    holds: ({ state }, input) => noticeResources(state, input?.commandId),
    group: 'Ledger changes',
    description: 'Retry a rejected or superseded change from its notice.',
    input: z.object({
      commandId: choice('notice', 'The change notice to apply again.'),
    }),
    example: { commandId: 'notice-command-id' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => {
      const absent = requireNotice(state, input?.commandId);

      if (absent) return absent;
      const candidates = state.group?.notices.filter((entry) => !input || entry.command.command_id === input.commandId) ?? [];

      return !state.online && candidates.every((entry) => requiresServerDecision(entry.command.type))
        ? unavailable('client_offline', 'Go online to retry this change.') : null;
    },
    run: (host, input) => host.retryNotice(input.commandId),
  }),
};
