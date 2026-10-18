import { useState } from 'react';
import { Text, View } from 'react-native';
import { formatAmount, type ClientReplicaState } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, s } from './components';
import { useActionCall } from './useActionCall';

export type NoticesPanelApp = Pick<AppController, 'snapshot'>;

type NoticesPanelProps = { app: NoticesPanelApp; close?: () => void };

type Notice = ClientReplicaState['notices'][number];

function intendedChange(notice: Notice): string {
  const command = notice.command;

  switch (command.type) {
    case 'group.rename':
      return `Rename the group to “${command.payload.name}”`;
    case 'member.create':
      return `Add “${command.payload.display_name}”`;
    case 'member.rename':
      return `Rename “${command.payload.expected_display_name}” to “${command.payload.display_name}”`;
    case 'member.remove':
      return 'Remove this member';
    case 'member.restore':
      return 'Restore this member';
    case 'expense.record':
      return `Add “${command.payload.description}” for ${formatAmount(command.payload.total, command.payload.currency)} ${command.payload.currency}`;
    case 'expense.edit':
      return `Change “${command.payload.description}”`;
    case 'expense.remove':
      return 'Remove this expense';
    case 'expense.restore':
      return 'Restore this expense';
    case 'preference.set':
      return 'Change who this installation calls “you”';
    case 'group.leave':
      return 'Leave the group';
  }
}

function currentResult(notice: Notice): string {
  const current = notice.outcome.server_state;

  if (current?.kind === 'group')
    return `The group is currently called “${current.group.name}”.`;

  if (current?.kind === 'expense')
    return `The expense is currently “${current.expense.description}” for ${formatAmount(current.expense.total, current.expense.currency)} ${current.expense.currency}${current.expense.status === 'removed' ? ' (removed)' : ''}.`;

  if (current?.kind === 'member')
    return `The member is currently “${current.member.display_name}” (${current.member.status === 'active' ? 'active' : 'removed'}).`;

  return 'This change could not be applied to the current group state.';
}

/** Rejected or superseded local changes, each to apply again or dismiss. */
export function NoticesPanel(props: NoticesPanelProps) {
  const notices = props.app.snapshot().group?.notices ?? [];
  const back = useActionCall();
  const action = useActionCall();
  // The notice last acted on, so a failure appears beside that notice.
  const [target, setTarget] = useState<string | null>(null);

  function act(
    commandId: string,
    name: 'retryNotice' | 'dismissNotice',
  ): void {
    setTarget(commandId);
    void action.call(name, { commandId });
  }

  return (
    <>
      <View style={s.between}>
        <Text accessibilityRole="header" style={s.heading}>
          Changes to review
        </Text>
        <Button
          quiet
          disabled={!back.can('closePanel')}
          onPress={() => {
            void back.call('closePanel', {}, props.close);
          }}
        >
          Done
        </Button>
      </View>
      {!notices.length ? (
        <Text style={s.body}>You’re all caught up.</Text>
      ) : null}
      {notices.map((notice) => {
        const commandId = notice.command.command_id;

        return (
          <View key={commandId} style={s.stack}>
            <Text style={s.name}>{intendedChange(notice)}</Text>
            <Text style={s.body}>{currentResult(notice)}</Text>
            <Text style={s.caption}>
              {notice.outcome.status === 'superseded'
                ? 'Another accepted change made your original edit out of date.'
                : notice.outcome.reason === 'member_removed'
                  ? 'That member was removed before the change arrived.'
                  : notice.outcome.reason === 'expense_removed'
                    ? 'That expense was removed before the change arrived.'
                  : notice.outcome.reason === 'group_left'
                    ? 'You left this group before the change arrived.'
                    : 'The group’s current state does not allow this change.'}
            </Text>
            <View style={s.row}>
              <Button
                secondary
                disabled={!action.can('retryNotice', { commandId })}
                onPress={() => act(commandId, 'retryNotice')}
              >
                Apply again
              </Button>
              <Button
                quiet
                disabled={!action.can('dismissNotice', { commandId })}
                onPress={() => act(commandId, 'dismissNotice')}
              >
                Dismiss
              </Button>
            </View>
            {target === commandId ? (
              <ErrorMessage message={action.error} />
            ) : null}
            <View style={s.divider} />
          </View>
        );
      })}
      <ErrorMessage message={back.error} />
    </>
  );
}
