import { z } from 'zod';
import { formatAmount, formatInviteLink, repaymentMembers, settlementSuggestions } from '@splitnext/client';
import { newActivity } from '../activity';
import { canExcludeExpensePart, decreaseExpenseShare, fixExpenseAmount, increaseExpenseShare, suggestedCurrency } from '../expenses';
import { draftFields, groupViews, personFits, viewFits, viewNames } from '../uiState';
import { workflowGuard, type WorkflowIntent } from '../workflow';
import { requireSettlement, unavailable, editorLock, navigationLock, defineAction, openSnapshot, requireExpense, requireOpenable, requireMember, requireNotice, requireJoin, joinMembers, requireConfirmation, requireInvite, memberResource, noticeResources, empty, choice, type ActionHost, type ActionPlatform } from './define';

/** Navigation, drafts, local review state, device copy and share, and confirmation decisions. */
export const uiActions = {
  showGroup: defineAction({
    workflow: 'navigate', group: 'UI', description: 'Show the group screen: balances and expenses.', input: empty, example: {}, requires: ['openGroup'],
    run: async (host, input, ui) => ui.show('home'),
  }),
  showPerson: defineAction({
    workflow: 'navigate', group: 'UI', description: 'Open a person’s details: balances, what they are made of, and their actions.',
    input: z.object({ memberId: choice('repaymentMember', 'The person to show.') }), example: { memberId: 'member-1' }, requires: ['openGroup'],
    unavailable: ({ state }, input) => personFits(state, input?.memberId) || (!input && repaymentMembers(openSnapshot(state)).length) ? null : unavailable('member_not_found', 'Choose someone in this group.'),
    run: async (host, input, ui) => ui.show('person', 'push', { person: input.memberId }),
  }),
  showSettleUp: defineAction({
    workflow: 'navigate', group: 'UI', description: 'Open the payments in the group’s settle-up plan, or only those involving a person.',
    input: z.object({ memberId: choice('repaymentMember', 'The person to settle up; omit it for the whole group.').optional() }), example: { memberId: 'member-1' }, requires: ['openGroup'],
    unavailable: ({ state }, input) => {
      const snapshot = openSnapshot(state);
      const memberId = input?.memberId;

      if (memberId && !personFits(state, memberId)) return unavailable('member_not_found', 'Choose someone in this group.');

      return snapshot && settlementSuggestions(snapshot).some((entry) => !memberId || entry.from_member_id === memberId || entry.to_member_id === memberId)
        ? null : unavailable('member_settled', 'Nothing is left to settle.');
    },
    run: async (host, input, ui) => ui.show('settle', 'push', { person: input.memberId ?? null }),
  }),
  setBalancesExpanded: defineAction({
    group: 'UI', description: 'Show everyone in the balances, or only as many as leave room for the first expenses.', input: z.object({ expanded: z.boolean() }), example: { expanded: false }, requires: ['openGroup'],
    run: async (host, input, ui) => ui.update({ balancesExpanded: input.expanded }),
  }),
  markActivitySeen: defineAction({
    group: 'UI', description: 'Mark every Activity change from other people as seen on this device.', input: empty, example: {}, requires: ['openGroup'],
    unavailable: ({ state, ui }) => newActivity(state.group, state.group ? ui.activitySeen[state.group.group_id] : undefined).length ? null : unavailable('nothing_new', 'Nothing new in Activity.'),
    run: async (host, input, ui) => {
      const group = host.snapshot().group;
      const latest = group?.activity.at(-1)?.sequence;

      if (group && latest !== undefined) ui.markActivitySeen(group.group_id, latest);
    },
  }),
  dismissRemoval: defineAction({
    group: 'UI', description: 'Close the notification for a member removed on this device.', input: empty, example: {},
    unavailable: ({ ui }) => ui.removal ? null : unavailable('nothing_removed', 'No removal notification.'),
    run: async (host, input, ui) => ui.update({ removal: null }),
  }),
  showActivity: defineAction({
    workflow: 'navigate', group: 'UI', description: 'Open the group Activity.', input: empty, example: {}, requires: ['openGroup'], run: async (host, input, ui) => ui.show('activity'),
  }),
  refreshActivity: defineAction({
    group: 'UI', description: 'Read Activity independently from snapshot synchronization.', input: empty, example: {}, requires: ['openGroup'],
    unavailable: ({ state }) => state.group ? null : unavailable('group_not_found', 'Open a group first.'),
    run: async (host) => {
      if (!host.client.activity) return;
      const id = host.snapshot().group?.group_id;

      if (id) await host.client.activity(id);
    },
  }),
  showSettlement: defineAction({
    workflow: 'draft', group: 'UI', description: 'Open a recorded repayment for editing.', input: z.object({ settlementId: choice('settlement', 'The repayment to change.') }), example: { settlementId: 'settlement-1' }, requires: ['openGroup'],
    unavailable: ({ state }, input) => requireSettlement(state, input?.settlementId),
    run: async (host, input, ui) => {
      const entry = openSnapshot(host.snapshot())?.settlements.find((item) => item.id === input.settlementId);

      if (!entry) throw new Error('settlement_not_found');
      ui.changeRepayment({ manual: false, settlementId: entry.id, expectedVersion: entry.version, from: entry.from_member_id, to: entry.to_member_id, currency: entry.currency, amount: formatAmount(entry.amount, entry.currency) });
      ui.show('settlements');
    },
  }),
  showSettlements: defineAction({
    workflow: 'navigate', group: 'UI', description: 'Open repayment suggestions and recorded repayments.', input: empty, example: {}, requires: ['openGroup'],
    run: async (host, input, ui) => ui.show('settlements'),
  }),
  prepareRepayment: defineAction({
    workflow: 'draft', group: 'UI', description: 'Review a suggested or manual repayment.',
    input: z.object({ from: choice('repaymentMember', 'Who paid.'), to: choice('repaymentMember', 'Who received it.'), amount: z.string(), currency: z.string(), keepEditing: z.boolean().optional(), manual: z.boolean().optional() }),
    example: { from: 'member-1', to: 'member-2', amount: '10.00', currency: 'EUR' }, requires: ['openGroup'],
    run: async (host, input, ui) => ui.changeRepayment({ ...input, manual: input.manual ?? false, settlementId: input.keepEditing ? ui.snapshot().repayment.settlementId : null, expectedVersion: input.keepEditing ? ui.snapshot().repayment.expectedVersion : null }),
  }),
  showCreateGroup: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the create-group form.',
    input: empty,
    example: {},
    run: async (host, input, ui) => ui.show('create'),
  }),
  showJoinGroup: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the join form, optionally with an invite link.',
    input: z.object({ link: z.string().optional() }),
    example: {},
    run: async (host, input, ui) => ui.showJoin(input.link),
  }),
  showSettings: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open settings for the current group.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    run: async (host, input, ui) => ui.show('settings'),
  }),
  showInvite: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the current group’s shared invite link.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    run: async (host, input, ui) => ui.show('invite'),
  }),
  showRejoin: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open member choices to rejoin the selected group.',
    input: empty,
    example: {},
    requires: ['selectedGroup'],
    unavailable: ({ state }) =>
      state.group?.hidden
        ? null
        : unavailable('group_already_joined', 'This group is already joined.'),
    run: async (host, input, ui) => ui.showJoin('', true),
  }),
  closePanel: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Return from a form or panel to the group or groups list.',
    input: empty,
    example: {},
    unavailable: ({ ui }) =>
      ui.view !== 'home'
        ? null
        : unavailable('panel_not_open', 'No form or panel is open.'),
    run: async (host, input, ui) => ui.back(),
  }),
  showHomepage: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the public homepage.',
    input: empty,
    example: {},
    unavailable: ({ platform }) =>
      platform.openHomepage
        ? null
        : unavailable(
            'platform_unavailable',
            'Homepage navigation is unavailable.',
          ),
    run: async (host, input, ui, platform) => {
      if (!platform.openHomepage) throw new Error('platform_unavailable');
      platform.openHomepage();
    },
  }),
  restoreNavigation: defineAction({
    workflow: 'navigate',
    holds: ({ state }, input) => (input && input.groupId !== state.group?.group_id ? [navigationLock] : []),
    group: 'UI',
    description: 'Restore a view when using Back or Forward.',
    input: z.object({
      view: z.enum(viewNames),
      trail: z.array(z.enum(groupViews)).optional(),
      person: z.string().optional(),
      groupId: choice(
        'group',
        'The group to show, or omit for the groups list.',
      ).optional(),
    }),
    example: { view: 'home' },
    unavailable: ({ state }, input) => (input?.groupId ? requireOpenable(state, input.groupId) : null),
    run: async (host, input, ui) => {
      if (input.groupId && input.groupId !== host.snapshot().group?.group_id)
        await host.openGroup(input.groupId);
      else if (!input.groupId) host.showGroups();

      // History can outlive a group's state, such as an invite sheet for a
      // group since left; a panel without its group restores the group view.
      const person = input.person ?? null;

      if (viewFits(input.view, host.snapshot(), person)) ui.show(input.view, 'restore', { person, trail: input.trail?.filter((view) => viewFits(view, host.snapshot(), person)) ?? [] });
      else ui.show('home', 'restore');
    },
  }),
  changeDraft: defineAction({
    waitsFor: ({ ui }, input) => (!input ? ui.memberEdit : input.field === 'member.name') ? [editorLock] : [],
    group: 'UI',
    description: 'Change a form field without submitting it.',
    input: z.object({
      field: z.enum(draftFields),
      value: z.string(),
    }),
    example: { field: 'create.name', value: 'Lisbon weekend' },
    unavailable: ({ ui }, input) => {
      const intent: WorkflowIntent = !input
        ? 'draft'
        : input.field === 'member.name'
          ? 'groupEditor'
          : input.field === 'join.link'
            ? 'joinLink'
            : input.field === 'join.name'
              ? 'joinName'
              : input.field.startsWith('create.')
                ? 'createDraft'
                : input.field.startsWith('repayment.')
                  ? 'draft'
                  : input.field.startsWith('expense.')
                  ? 'expenseDraft'
                  : 'settingsDraft';

      const guard = workflowGuard(ui, intent);

      if (guard) return unavailable(guard.error, guard.reason);

      if (!input)
        return ui.memberEdit ||
          ['create', 'settings', 'expense', 'join', 'rejoin', 'settlements'].includes(ui.view)
          ? null
          : unavailable('form_not_open', 'Open a form or edit a member first.');

      if (input.field === 'member.name')
        return ui.memberEdit
          ? null
          : unavailable('no_member_edit', 'Edit a member first.');

      return null;
    },
    run: async (host, input, ui) => ui.changeDraft(input.field, input.value),
  }),
  chooseJoinMember: defineAction({
    workflow: 'chooseMember',
    group: 'UI',
    description: 'Choose an existing member, or someone new, in the join form.',
    input: z.object({
      as: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('existing'),
          memberId: choice('joinMember', 'The name to join as.'),
        }),
        z.object({ kind: z.literal('new') }),
      ]),
    }),
    example: { as: { kind: 'new' } },
    unavailable: (context, input) => {
      const choice = input?.as;

      return (
        requireJoin(context) ??
        (choice?.kind === 'existing' &&
        !joinMembers(context).some((member) => member.id === choice.memberId)
          ? unavailable('member_not_found', 'Choose a member from this group.')
          : null)
      );
    },
    run: async (host, input, ui) =>
      ui.chooseJoinMember(input.as.kind === 'new' ? 'new' : input.as.memberId),
  }),
  clearInvitePreview: defineAction({
    workflow: 'clearPreview',
    group: 'UI',
    description: 'Return to editing the invite link.',
    input: empty,
    example: {},
    run: async (host, input, ui) => ui.clearInvitePreview(),
  }),
  setLeftGroupsVisible: defineAction({
    group: 'UI',
    description: 'Show or hide groups this installation left.',
    input: z.object({ visible: z.boolean() }),
    example: { visible: true },
    unavailable: ({ state }) =>
      state.groups.some((group) => group.status === 'left')
        ? null
        : unavailable('no_left_groups', 'No left groups.'),
    run: async (host, input, ui) =>
      ui.update({ showLeftGroups: input.visible }),
  }),
  showExpense: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open the expense form, for a new expense or one to change.',
    input: z.object({
      expenseId: choice('expense', 'The expense to change; omit it to add one.').optional(),
    }),
    example: {},
    requires: ['openGroup'],
    unavailable: ({ state }, input) => (input?.expenseId ? requireExpense(state, input.expenseId, 'active') : null),
    run: async (host, input, ui, platform) =>
      ui.showExpense(input.expenseId ?? null, suggestedCurrency(openSnapshot(host.snapshot()), platform.localeRegion)),
  }),
  chooseExpensePayer: defineAction({
    workflow: 'expenseDraft',
    group: 'UI',
    description: 'Choose who paid the expense being entered.',
    input: z.object({ memberId: choice('member', 'The member who paid.') }),
    example: { memberId: 'member-1' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    run: async (host, input, ui) => ui.changeExpense(() => ({ paidBy: input.memberId })),
  }),
  toggleExpenseParticipant: defineAction({
    workflow: 'expenseDraft',
    group: 'UI',
    description: 'Include a member in the expense being entered, or leave them out.',
    input: z.object({ memberId: choice('expenseMember', 'The member to include or leave out.') }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    unavailable: ({ state, ui }, input) => {
      if (!input) return ui.expense.parts.length ? null : requireMember(state);

      if (!ui.expense.parts.some((part) => part.member_id === input.memberId)) return requireMember(state, input.memberId);

      return canExcludeExpensePart(ui.expense, input.memberId) ? null : unavailable('last_share', 'Keep one person sharing the remainder.');
    },
    run: async (host, input, ui) => {
      ui.changeExpense((draft) => {
        const included = draft.parts.some((part) => part.member_id === input.memberId);

        return { parts: included ? draft.parts.filter((part) => part.member_id !== input.memberId) : increaseExpenseShare(draft, input.memberId) };
      });
    },
  }),
  increaseExpenseShare: defineAction({
    workflow: 'expenseDraft',
    group: 'UI',
    description: 'Increase a participant’s shares, include someone, or return a fixed amount to shares.',
    input: z.object({ memberId: choice('expenseMember', 'The person whose share increases.') }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    unavailable: ({ state, ui }, input) => {
      if (!input) return ui.expense.parts.length ? null : requireMember(state);
      const part = ui.expense.parts.find((entry) => entry.member_id === input?.memberId);

      if (!part) return requireMember(state, input?.memberId);

      return part.kind === 'shares' && part.shares >= 1_000_000 ? unavailable('share_limit', 'Use at most 1000000 shares.') : null;
    },
    run: async (host, input, ui) => ui.changeExpense((draft) => ({ parts: increaseExpenseShare(draft, input.memberId) })),
  }),
  decreaseExpenseShare: defineAction({
    workflow: 'expenseDraft',
    group: 'UI',
    description: 'Decrease a participant’s shares, or exclude a fixed person or someone at one share.',
    input: z.object({ memberId: choice('expenseMember', 'The person whose share decreases.') }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    unavailable: ({ ui }, input) => {
      if (!input) return ui.expense.parts.length ? null : unavailable('not_participant', 'Include a person first.');
      const part = ui.expense.parts.find((entry) => entry.member_id === input?.memberId);

      if (!part) return unavailable('not_participant', 'Include this person first.');

      return (part.kind === 'shares' && part.shares > 1) || canExcludeExpensePart(ui.expense, part.member_id)
        ? null : unavailable('last_share', 'Keep one person sharing the remainder.');
    },
    run: async (host, input, ui) => ui.changeExpense((draft) => ({ parts: decreaseExpenseShare(draft, input.memberId) })),
  }),
  setExpenseFixedAmount: defineAction({
    workflow: 'expenseDraft',
    group: 'UI',
    description: 'Fix one participant’s amount while the others divide the remainder by shares; clear it to return to one share.',
    input: z.object({
      memberId: choice('expenseMember', 'The participant.'),
      amount: z.string().meta({ description: 'An amount, such as 12.50; blank returns this person to one share.' }),
    }),
    example: { memberId: 'member-2', amount: '12.50' },
    requires: ['openGroup'],
    unavailable: ({ ui }, input) => {
      if (!input) return ui.expense.parts.length ? null : unavailable('not_participant', 'Include a person first.');
      const part = ui.expense.parts.find((entry) => entry.member_id === input?.memberId);

      if (!part) return unavailable('not_participant', 'Include this person first.');

      return part.kind === 'shares' && input?.amount.trim() && !canExcludeExpensePart(ui.expense, part.member_id)
        ? unavailable('last_share', 'Keep one person sharing the remainder.') : null;
    },
    run: async (host, input, ui) =>
      ui.changeExpense((draft) => ({ parts: fixExpenseAmount(draft, input.memberId, input.amount) })),
  }),
  beginAddMember: defineAction({
    waitsFor: () => [editorLock],
    workflow: 'groupEditor',
    group: 'UI',
    description: 'Insert a member row in edit mode.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    run: async (host, input, ui) => ui.beginMemberEdit(null),
  }),
  beginEditMember: defineAction({
    // A member being renamed or removed cannot be edited until that finishes.
    waitsFor: ({ state }, input) => [editorLock, ...memberResource(state, input?.memberId)],
    workflow: 'groupEditor',
    group: 'UI',
    description: 'Edit a member name in its row.',
    input: z.object({ memberId: choice('member', 'The member to edit.') }),
    example: { memberId: 'member-2' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireMember(state, input?.memberId),
    run: async (host, input, ui) => ui.beginMemberEdit(input.memberId),
  }),
  cancelMemberEdit: defineAction({
    waitsFor: () => [editorLock],
    group: 'UI',
    description: 'Discard the current member-name draft.',
    input: empty,
    example: {},
    unavailable: ({ ui }) =>
      ui.memberEdit
        ? null
        : unavailable('no_member_edit', 'Edit a member first.'),
    run: async (host, input, ui) => ui.finishMemberEdit(),
  }),
  copyInviteLink: defineAction({
    group: 'UI',
    description: 'Copy the open group’s invite link.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    unavailable: (context) => requireInvite(context, 'copyText'),
    run: async (host, input, ui, platform) => {
      if (!platform.copyText) throw new Error('platform_unavailable');
      const { link, snapshot } = openInviteLink(host, platform);

      await platform.copyText(link);
      ui.update({ copiedInviteId: snapshot.invite.id });
    },
  }),
  shareInviteLink: defineAction({
    group: 'UI',
    description:
      'Share the open group’s invite link using the device’s share sheet.',
    input: empty,
    example: {},
    requires: ['openGroup'],
    unavailable: (context) => requireInvite(context, 'shareLink'),
    run: async (host, input, ui, platform) => {
      if (!platform.shareLink) throw new Error('platform_unavailable');
      const { link, snapshot } = openInviteLink(host, platform);

      await platform.shareLink(link, `Join ${snapshot.group.name}`);
    },
  }),
  copyDiagnostics: defineAction({
    group: 'UI',
    description:
      'Copy a diagnostics report for support: recent actions and requests ' +
      'as ids and codes, without names, links, or inputs.',
    input: empty,
    example: {},
    unavailable: ({ platform }) =>
      platform.copyText && platform.diagnosticsReport
        ? null
        : unavailable('platform_unavailable', 'Clipboard is unavailable on this device.'),
    run: async (host, input, ui, platform) => {
      if (!platform.copyText || !platform.diagnosticsReport) throw new Error('platform_unavailable');
      await platform.copyText(platform.diagnosticsReport());
    },
  }),
  confirmAction: defineAction({
    group: 'UI',
    description: 'Approve and run the pending action.',
    input: z.object({
      requestId: choice('confirmation', 'The pending confirmation to approve.'),
    }),
    example: { requestId: 'confirmation-1' },
    unavailable: ({ ui, pendingConfirmation }, input) =>
      requireConfirmation(ui, input?.requestId) ??
      (pendingConfirmation && !pendingConfirmation.available
        ? pendingConfirmation
        : null),
    run: async (host, input, ui) => ui.confirm(input.requestId),
  }),
  cancelConfirmation: defineAction({
    group: 'UI',
    description: 'Cancel the pending action without applying it.',
    input: z.object({
      requestId: choice('confirmation', 'The pending confirmation to cancel.'),
    }),
    example: { requestId: 'confirmation-1' },
    unavailable: ({ ui }, input) => requireConfirmation(ui, input?.requestId),
    run: async (host, input, ui) => ui.cancelConfirmation(input.requestId),
  }),
  openGroup: defineAction({
    workflow: 'navigate',
    holds: () => [navigationLock],
    group: 'UI',
    description: 'Open one of this installation’s groups.',
    input: z.object({
      groupId: choice('group', "One of this installation's groups."),
    }),
    example: { groupId: 'uy9ogmKJRD2VRfbN4PDsAw' },
    unavailable: ({ state }, input) => requireOpenable(state, input?.groupId),
    run: async (host, input, ui) => {
      await host.openGroup(input.groupId);

      if (host.snapshot().group?.hidden) ui.showJoin('', true);
      else {
        ui.update({ balancesExpanded: false });
        ui.show('home');
      }
    },
  }),
  showGroups: defineAction({
    workflow: 'navigate',
    holds: () => [navigationLock],
    group: 'UI',
    description: 'Return to the groups list.',
    input: empty,
    example: {},
    run: async (host, input, ui) => {
      host.showGroups();
      ui.show('home');
    },
  }),
  dismissNotice: defineAction({
    holds: ({ state }, input) => noticeResources(state, input?.commandId),
    group: 'UI',
    description: 'Dismiss a rejected or superseded change notice.',
    input: z.object({
      commandId: choice('notice', 'The change notice to dismiss.'),
    }),
    example: { commandId: 'notice-command-id' },
    requires: ['openGroup'],
    unavailable: ({ state }, input) => requireNotice(state, input?.commandId),
    run: (host, input) => host.dismissNotice(input.commandId),
  }),
};

/** The open group's invite link as people share it, with the snapshot it came from. */
function openInviteLink(host: ActionHost, platform: ActionPlatform) {
  const group = host.snapshot().group;
  const snapshot = group?.projected_snapshot;

  if (!group || !snapshot || !platform.appUrl) throw new Error('invite_invalid');

  return {
    link: formatInviteLink(platform.appUrl, group.group_id, snapshot.invite.token),
    snapshot,
  };
}
