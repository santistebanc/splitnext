import { z } from 'zod';
import { activeMembers, preferredMember, formatInviteLink } from '@splitnext/client';
import type { AppState } from './controller';
import type { UiState } from './uiState';

export type InputState = AppState & { ui?: UiState };

export const valueSources = [
  'member', 'preferredMember', 'group', 'notice', 'inviteLink',
  'memberName', 'groupName', 'joinMember', 'confirmation',
] as const;

export const valueSourceSchema = z.enum(valueSources);

export type ValueSource = (typeof valueSources)[number];

export type ValueOption = { value: string; label: string };

/** The values app state offers for a source, labelled for people. */
export function sourceOptions(
  source: ValueSource,
  state: InputState,
  origin: string,
): ValueOption[] {
  const group = state.group;
  const snapshot = group?.projected_snapshot;
  const you = preferredMember(snapshot, group?.session?.identity.id)?.id;
  const members = activeMembers(snapshot);

  switch (source) {
    case 'confirmation':
      return state.ui?.confirmation
        ? [
            {
              value: state.ui.confirmation.id,
              label: state.ui.confirmation.name,
            },
          ]
        : [];
    case 'joinMember':
      return (state.ui?.join.preview?.members ?? members).map((member) => ({
        value: member.id,
        label: member.display_name,
      }));
    case 'member':
      return members.map((member) => ({
        value: member.id,
        label: `${member.display_name}${member.id === you ? ' (you)' : ''}`,
      }));
    case 'preferredMember':
      return [...members]
        .sort((a, b) => Number(a.id === you) - Number(b.id === you))
        .map((member) => ({
          value: member.id,
          label: `${member.display_name}${member.id === you ? ' (you)' : ''}`,
        }));
    case 'memberName':
      return members.map((member) => ({
        value: member.display_name,
        label: member.display_name,
      }));
    case 'group':
      return state.groups.map((entry) => ({
        value: entry.group_id,
        label: `${entry.name}${entry.status === 'left' ? ' (left)' : ''}`,
      }));
    case 'groupName':
      return snapshot
        ? [{ value: snapshot.group.name, label: snapshot.group.name }]
        : [];
    case 'notice':
      return (group?.notices ?? []).map((notice) => ({
        value: notice.command.command_id,
        label: `${notice.command.type} · ${notice.outcome.status}`,
      }));
    case 'inviteLink': {
      const invite = snapshot?.invite;

      return group && invite
        ? [
            {
              value: formatInviteLink(origin, group.group_id, invite.token),
              label: `${snapshot.group.name} invite link`,
            },
          ]
        : [];
    }
  }
}

