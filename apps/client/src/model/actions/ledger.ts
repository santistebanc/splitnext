import { z } from 'zod';
import { groupNameSchema, memberNameSchema, participantsForMember, requiresServerDecision } from '@splitnext/client';
import { unavailable, editorLock, defineAction, openSnapshot, requireMember, requireRemovedMember, requireNotice, requireName, memberResource, noticeResources, empty, choice, suggested } from './define';

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
