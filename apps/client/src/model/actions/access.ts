import { z } from 'zod';
import { groupNameSchema, identifierSchema, inviteTokenSchema, memberNameSchema, parseInviteLink, type InvitePreview } from '@splitnext/client';
import { createGroupInputSchema, memberChoiceSchema, performCreate, performJoin } from '../operations';
import { unavailable, editorLock, defineAction, requireJoin, joinMembers, requireName, empty, suggested } from './define';

export type InviteCheck =
  | { opened: true }
  | { opened: false; groupId: string; token: string; preview: InvitePreview };

/** Creating, joining, invites, leaving, and refreshing; they need a connection. */
export const accessActions = {
  submitCreateGroup: defineAction({
    waitsFor: () => [editorLock],
    workflow: 'submitCreate',
    group: 'Access & sync',
    description: 'Create the group using the current form draft.',
    input: empty,
    example: {},
    requires: ['reachable'],
    unavailable: ({ ui }) =>
      requireName(groupNameSchema, ui.create.name, 'group name') ??
      requireName(memberNameSchema, ui.create.yourName, 'your name'),
    run: async (host, input, ui) => {
      const draft = ui.snapshot().create;
      await performCreate(host, draft);
    },
  }),
  submitJoin: defineAction({
    waitsFor: () => [editorLock],
    workflow: 'submitJoin',
    group: 'Access & sync',
    description:
      'Join or rejoin using the current member choice and name draft.',
    input: empty,
    example: {},
    requires: ['online'],
    unavailable: (context) =>
      requireJoin(context) ??
      (!context.ui.join.chosen
        ? unavailable('join_choice_required', 'Choose a name first.')
        : context.ui.join.chosen === 'new'
          ? requireName(memberNameSchema, context.ui.join.name, 'your name')
          : joinMembers(context).some(
                (member) => member.id === context.ui.join.chosen,
              )
            ? null
            : unavailable('member_not_found', 'Choose a current member.')),
    run: async (host, input, ui) => {
      const draft = ui.snapshot().join;

      const groupId =
        ui.snapshot().view === 'rejoin'
          ? host.snapshot().group?.group_id
          : draft.preview?.group.id;

      const chosen = draft.chosen;

      if (!groupId || !chosen) throw new Error('join_choice_required');
      await performJoin(host, {
        groupId,
        as: chosen === 'new' ? { kind: 'new', name: draft.name } : { kind: 'existing', memberId: chosen },
        token: draft.token ?? undefined,
      });
    },
  }),
  refreshGroups: defineAction({
    group: 'Access & sync',
    description: 'Retry loading and synchronizing saved groups.',
    input: empty,
    example: {},
    requires: ['online'],
    run: (host) => host.refresh(),
  }),
  createGroup: defineAction({
    waitsFor: () => [editorLock],
    workflow: 'createDirect',
    group: 'Access & sync',
    description:
      'Create a group and join it as a new member with your name; it opens.',
    input: createGroupInputSchema,
    example: { name: 'Lisbon weekend', yourName: 'Ana' },
    requires: ['reachable'],
    run: (host, input) => performCreate(host, input),
  }),
  checkInvite: defineAction({
    waitsFor: () => [editorLock],
    workflow: 'checkInvite',
    group: 'Access & sync',
    description:
      'Read an invite link. Opens the group if this installation already ' +
      'joined it; otherwise returns the group and members to choose from.',
    input: z.object({
      link: suggested(
        z.string().trim().min(1),
        'inviteLink',
        'An invite link, as shared.',
      ),
    }),
    example: { link: 'https://splitnext.app/j#Xk3m9QpL2vT7' },
    requires: ['online'],
    unavailable: (context, input) =>
      input && !parseInviteLink(input.link)
        ? unavailable('invite_invalid', 'Enter a valid invite link.')
        : null,
    run: async (host, input, ui): Promise<InviteCheck> => {
      const parsed = parseInviteLink(input.link);

      if (!parsed) throw new Error('invite_invalid');

      const check = ui.startInviteCheck(input.link);

      try {
        const current = () => ui.inviteCheckIsCurrent(check);

        if (parsed.group_id && (await host.openJoinedGroup(parsed.group_id, current))) {
          ui.openedInvite(check);

          return { opened: true };
        }

        // A short link names no group; its preview does.
        const preview = await host.client.previewInvite(parsed.group_id, parsed.token);

        if (!parsed.group_id && (await host.openJoinedGroup(preview.group.id, current))) {
          ui.openedInvite(check);

          return { opened: true };
        }

        const result: InviteCheck = {
          opened: false,
          groupId: preview.group.id,
          token: parsed.token,
          preview,
        };

        ui.checkedInvite(input.link, result.token, result.preview, check);

        return result;
      } catch (cause) {
        ui.failedInvite(check);
        throw cause;
      }
    },
  }),
  joinGroup: defineAction({
    waitsFor: () => [editorLock],
    workflow: 'joinDirect',
    group: 'Access & sync',
    description:
      'Join or rejoin a group as an existing member or as someone new. ' +
      'A token is needed unless rejoining a group this installation left.',
    input: z.object({
      groupId: suggested(
        identifierSchema,
        'group',
        'The group to join, from the invite link or a left group.',
      ),
      as: memberChoiceSchema,
      token: inviteTokenSchema
        .optional()
        .meta({ description: 'The invite token; not needed to rejoin.' }),
    }),
    example: {
      groupId: 'uy9ogmKJRD2VRfbN4PDsAw',
      as: { kind: 'new', name: 'Ana' },
    },
    requires: ['online'],
    unavailable: ({ state }, input) =>
      !input ||
      input.token ||
      state.groups.some((group) => group.group_id === input.groupId) ||
      state.group?.group_id === input.groupId
        ? null
        : unavailable(
            'invite_required',
            'Provide an invite token for a new group.',
          ),
    run: (host, input) => performJoin(host, input),
  }),
  regenerateInvite: defineAction({
    holds: ({ state }) => [`invite:${state.group?.group_id}`],
    group: 'Access & sync',
    description:
      'Replace the open group’s invite link with a new one for everyone.',
    input: empty,
    example: {},
    requires: ['online', 'openGroup'],
    confirm: () => 'Regenerate the invite link to create a new one. The old link will stop working. Everyone already in the group keeps their access.',
    run: (host) => host.regenerateInvite(),
  }),
  leaveGroup: defineAction({
    waitsFor: () => [editorLock],
    holds: ({ state }) => [`access:${state.group?.group_id}`],
    group: 'Access & sync',
    description:
      'Leave the open group on this installation. It can be rejoined later.',
    input: empty,
    example: {},
    requires: ['online', 'openGroup'],
    confirm: () => 'Leave this group?',
    run: async (host, input, ui) => {
      const navigation = ui.snapshot().navigation.revision;

      await host.submit({ type: 'group.leave', payload: {} });
      ui.showAfter(navigation, 'home');
    },
  }),
};
