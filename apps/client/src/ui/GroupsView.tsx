import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ClientGroupSummary } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, s } from './components';
import { useActionCall, useActions, useUiState } from './useActionCall';
import { useCompactLayout } from './useVisibleViewport';

export type GroupsViewApp = Pick<AppController, 'snapshot'>;

type GroupsViewProps = { app: GroupsViewApp };

/** The installation's groups, with create, join, and rejoin entry points. */
export function GroupsView(props: GroupsViewProps) {
  const mobile = useCompactLayout();
  const state = props.app.snapshot();
  const showLeft = useUiState().showLeftGroups;
  const actions = useActions();
  // The row last pressed, so a failure to open it appears beside that row.
  const [target, setTarget] = useState<string | null>(null);
  const action = useActionCall();
  // A support report of recent activity, as ids and codes only.
  const report = useActionCall();
  const [copied, setCopied] = useState(false);
  const active = state.groups.filter((group) => group.status === 'active');
  const left = state.groups.filter((group) => group.status === 'left');

  function open(group: ClientGroupSummary): void {
    setTarget(group.group_id);
    void action.call('openGroup', { groupId: group.group_id });
  }

  function row(group: ClientGroupSummary) {
    const details = [
      group.member_count === null
        ? null
        : `${group.member_count} ${group.member_count === 1 ? 'member' : 'members'}`,
      group.you_name ? `you: ${group.you_name}` : null,
    ].filter(Boolean);

    return (
      <View key={group.group_id}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${group.status === 'left' ? 'Rejoin' : 'Open'} ${group.name}`}
          disabled={action.busy}
          onPress={() => open(group)}
          style={({ pressed }) => [s.person, pressed && s.dim]}
        >
          <View style={[s.avatar, group.status === 'left' && s.avatarLeft]}>
            <Text style={s.avatarText}>
              {group.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={s.personText}>
            <Text style={s.name}>{group.name}</Text>
            {details.length ? (
              <Text style={s.caption}>{details.join(' · ')}</Text>
            ) : null}
            {group.pending_commands ? (
              <Text style={s.caption}>
                {group.pending_commands} changes waiting
              </Text>
            ) : null}
            {state.reviewGroups.includes(group.group_id) ? (
              <Text style={s.error}>A change needs review</Text>
            ) : null}
          </View>
          {group.status === 'left' ? (
            <Text style={s.rowAction}>Rejoin</Text>
          ) : (
            <Text style={s.chevron}>›</Text>
          )}
        </Pressable>
        {target === group.group_id ? (
          <ErrorMessage message={action.error} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={s.stack}>
      <Text
        accessibilityRole="header"
        style={[s.title, mobile && s.mobileTitle]}
      >
        {active.length ? 'Your groups' : 'Start a group'}
      </Text>
      {!active.length ? (
        <Text style={s.subtitle}>
          Create one for a trip, home, or team, or join with an invite link.
        </Text>
      ) : null}
      {active.length ? (
        <View style={[s.card, s.listCard]}>{active.map(row)}</View>
      ) : null}
      <View style={s.actions}>
        <Button
          grow
          onPress={() => {
            void action.call('showCreateGroup', {});
          }}
        >
          + Create group
        </Button>
        <Button
          grow
          secondary
          onPress={() => {
            void action.call('showJoinGroup', {});
          }}
        >
          Join group
        </Button>
      </View>
      {left.length ? (
        <>
          <Button
            quiet
            onPress={() => {
              void actions.dispatch(
                'setLeftGroupsVisible',
                { visible: !showLeft },
                { origin: 'ui' },
              );
            }}
          >
            {showLeft ? 'Hide' : 'Show'} left groups · {left.length}
          </Button>
          {showLeft ? (
            <View style={[s.card, s.listCard]}>{left.map(row)}</View>
          ) : null}
        </>
      ) : null}
      {report.can('copyDiagnostics') || copied ? (
        <Button
          quiet
          disabled={!report.can('copyDiagnostics')}
          onPress={() => {
            void report.call('copyDiagnostics', {}, () => setCopied(true));
          }}
        >
          {copied ? 'Diagnostics copied' : 'Copy diagnostics'}
        </Button>
      ) : null}
      <ErrorMessage message={report.error} />
    </View>
  );
}
