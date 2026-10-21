import { z } from 'zod';
import { repaymentMembers, activeMembers, memberLabel, nameOrdinals, preferredMember, formatInviteLink } from '@splitnext/client';
import { currentExpenses, expenseLabel, recentCurrencies } from './expenses';
import type { AppState } from './controller';
import type { UiState } from './uiState';

export type InputState = AppState & { ui?: UiState };

export const valueSources = [
  'activity', 'settlement', 'removedSettlement', 'repaymentMember', 'member', 'preferredMember', 'removedMember', 'expense', 'removedExpense', 'currency', 'group', 'notice', 'inviteLink',
  'memberName', 'groupName', 'joinMember', 'confirmation', 'expenseMember',
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
  const ordinals = nameOrdinals(snapshot);
  const label = (member: { id: string; display_name: string }) => memberLabel(member.display_name, ordinals.get(member.id));

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
      return state.ui?.join.preview
        ? state.ui.join.preview.members.map((member) => ({
            value: member.id,
            label: memberLabel(member.display_name, member.name_ordinal),
          }))
        : members.map((member) => ({ value: member.id, label: label(member) }));
    case 'activity':
      return (group?.activity ?? []).map((event) => ({ value: event.id, label: event.change.action }));
    case 'settlement':
    case 'removedSettlement':
      return (snapshot?.settlements ?? []).filter((entry) => entry.status === (source === 'settlement' ? 'active' : 'removed')).map((entry) => ({ value: entry.id, label: `${entry.amount} ${entry.currency}` }));
    case 'repaymentMember':
      return repaymentMembers(snapshot).map((member) => ({ value: member.id, label: label(member) }));
    case 'member':
      return members.map((member) => ({
        value: member.id,
        label: `${label(member)}${member.id === you ? ' (you)' : ''}`,
      }));
    case 'expenseMember':
      return (snapshot?.members ?? []).filter((member) => member.status === 'active' || state.ui?.expense.parts.some((part) => part.member_id === member.id))
        .map((member) => ({ value: member.id, label: label(member) }));
    case 'preferredMember':
      return [...members]
        .sort((a, b) => Number(a.id === you) - Number(b.id === you))
        .map((member) => ({
          value: member.id,
          label: `${label(member)}${member.id === you ? ' (you)' : ''}`,
        }));
    case 'removedMember':
      return (snapshot?.members ?? [])
        .filter((member) => member.status !== 'active')
        .map((member) => ({ value: member.id, label: `${label(member)} (removed)` }));
    case 'expense':
      return currentExpenses(snapshot).map((expense) => ({ value: expense.id, label: expenseLabel(expense) }));
    case 'removedExpense':
      return (snapshot?.expenses ?? [])
        .filter((expense) => expense.status === 'removed')
        .map((expense) => ({ value: expense.id, label: `${expenseLabel(expense)} (removed)` }));
    case 'currency':
      return [...new Set([...recentCurrencies(snapshot), 'EUR'])].map((currency) => ({ value: currency, label: currency }));
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

