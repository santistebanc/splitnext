import { z } from 'zod';
import { allocate, currencyCodeSchema, expenseDescriptionSchema, groupNameSchema, memberNameSchema, parseAmount, participantsForMember, requiresServerDecision } from '@splitnext/client';
import { equalParts } from '../expenses';
import { unavailable, editorLock, defineAction, openSnapshot, requireExpense, requireExpenseEntry, expenseResource, requireMember, requireRemovedMember, requireNotice, requireName, memberResource, noticeResources, empty, choice, suggested } from './define';

/** Changes to the shared ledger; they can queue offline. */
export const ledgerActions = {
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

      if (name && !edit.memberId)
        await host.submit({ type: 'member.create', payload: { display_name: name } });
      else if (name && name !== edit.expectedName && edit.memberId)
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
      'Remove a member from the open group. Their name stays in history.',
    input: z.object({
      memberId: choice('preferredMember', 'The member to remove.'),
    }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    run: async (host, input, ui) => {
      await host.submit({ type: 'member.remove', payload: { member_id: input.memberId } });

      if (ui.snapshot().memberEdit?.memberId === input.memberId)
        ui.finishMemberEdit();
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
    run: (host, input) => host.submit({ type: 'member.restore', payload: { member_id: input.memberId } }),
  }),
  recordExpense: defineAction({
    group: 'Ledger changes',
    description: 'Record an expense in the open group, split equally between its current members.',
    input: z.object({
      description: expenseDescriptionSchema.meta({ description: 'What the expense was for.' }),
      amount: z.string().meta({ description: 'The amount paid, such as 12.50.' }),
      currency: suggested(currencyCodeSchema, 'currency', 'The ISO currency code, such as EUR.'),
      paidBy: choice('member', 'The member who paid.'),
    }),
    example: { description: 'Dinner', amount: '42.50', currency: 'EUR', paidBy: 'member-1' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireExpenseEntry(input) ?? requireMember(state, input?.paidBy),
    run: (host, input) =>
      host.submit({
        type: 'expense.record',
        payload: {
          description: input.description,
          currency: input.currency,
          total: parseAmount(input.amount, input.currency) ?? 0,
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
      currency: suggested(currencyCodeSchema, 'currency', 'The ISO currency code, such as EUR.'),
      paidBy: choice('member', 'The member who paid.'),
    }),
    example: { expenseId: 'expense-1', description: 'Dinner', amount: '45.00', currency: 'EUR', paidBy: 'member-1' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => {
      const blocked = requireExpense(state, input?.expenseId, 'active') ?? requireExpenseEntry(input) ?? requireMember(state, input?.paidBy);
      const expense = openSnapshot(state)?.expenses.find((entry) => entry.id === input?.expenseId);

      if (blocked || !input || !expense) return blocked;

      return allocate(parseAmount(input.amount, input.currency) ?? 0, expense.parts).ok
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
          currency: input.currency,
          total: parseAmount(input.amount, input.currency) ?? 0,
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
  setPreferredMember: defineAction({
    holds: ({ state }) => [`preference:${state.group?.group_id}`],
    // Choosing a member that is being removed would only produce a rejection.
    waitsFor: ({ state }, input) => memberResource(state, input?.memberId),
    group: 'Ledger changes',
    description:
      'Choose which member is you on this installation. Asks first when ' +
      'another participant already uses that member.',
    input: z.object({
      memberId: choice(
        'preferredMember',
        'The member to use as you on this installation.',
      ),
    }),
    example: { memberId: 'member-1' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    confirm: (input, state) => {
      const self = state.group?.session?.identity.id;

      const others = participantsForMember(openSnapshot(state), input.memberId).filter(
        (grant) => grant.identity_id !== self,
      );

      return others.length
        ? `${others.map((grant) => grant.actor_handle).join(', ')} already ${others.length === 1 ? 'uses' : 'use'} this name.`
        : null;
    },
    run: (host, input) => host.submit({ type: 'preference.set', payload: { member_id: input.memberId } }),
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
