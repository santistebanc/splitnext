import { z } from 'zod';
import { formatInviteLink } from '@splitnext/client';
import { draftFields, viewFits, viewNames } from '../uiState';
import { workflowGuard, type WorkflowIntent } from '../workflow';
import { unavailable, editorLock, navigationLock, defineAction, requireOpenable, requireMember, requireNotice, requireJoin, joinMembers, requireConfirmation, requireInvite, memberResource, noticeResources, empty, choice, type ActionHost, type ActionPlatform } from './define';

/** Navigation, drafts, local review state, device copy and share, and confirmation decisions. */
export const uiActions = {
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
  showNotices: defineAction({
    workflow: 'navigate',
    group: 'UI',
    description: 'Open changes that need review.',
    input: empty,
    example: {},
    requires: ['selectedGroup'],
    unavailable: ({ state }) => requireNotice(state),
    run: async (host, input, ui) => ui.show('notices'),
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
    run: async (host, input, ui) => ui.show('home'),
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
      ui.show(viewFits(input.view, host.snapshot()) ? input.view : 'home', 'restore');
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
                : 'settingsDraft';

      const guard = workflowGuard(ui, intent);

      if (guard) return unavailable(guard.error, guard.reason);

      if (!input)
        return ui.memberEdit ||
          ['create', 'settings', 'join', 'rejoin'].includes(ui.view)
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
  setNoticeSummaryVisible: defineAction({
    group: 'UI',
    description: 'Show or hide the changes-to-review banner.',
    input: z.object({ visible: z.boolean() }),
    example: { visible: false },
    run: async (host, input, ui) =>
      ui.update({ showNoticeSummary: input.visible }),
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
      else ui.show('home');
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
