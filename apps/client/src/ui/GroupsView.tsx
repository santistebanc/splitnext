import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { parseInviteLink, type ClientGroupSummary } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Reveal } from './Reveal';
import { morph } from './ScreenMorph';
import { BalanceBar, Button, ErrorMessage, FooterButton, ScreenHeader, balanceColor, s, signedFigure } from './components';
import { TrashIcon } from './icons';
import { colors, fontFamily, monoFamily } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type GroupsViewApp = Pick<AppController, 'snapshot'>;

type GroupsViewProps = { app: GroupsViewApp };

/** The groups list's main action, pinned at the foot of the screen. */
export function GroupsFooter() {
  const action = useActionCall();

  return (
    <>
      <ErrorMessage message={action.error} />
      <FooterButton
        morph="newgroup"
        disabled={!action.can('showCreateGroup')}
        onPress={() => {
          void action.call('showCreateGroup', {});
        }}
      >
        New group
      </FooterButton>
    </>
  );
}

/**
 * The name and Join with a link above a large Your groups. Join opens a link
 * field in place; Open checks the link on the join screen.
 */
export function GroupsHeader() {
  const join = useActionCall();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [invalid, setInvalid] = useState(false);
  const field = useRef<TextInput>(null);

  function submit(): void {
    if (!parseInviteLink(link.trim())) {
      setInvalid(true);

      return;
    }

    void join.call('showJoinGroup', { link: link.trim() });
  }

  return (
    <>
      <ScreenHeader
        start={<Text style={[s.headerActionText, { paddingLeft: 24, fontWeight: '700' }]}>splitnext</Text>}
        end={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join with an invite link"
            accessibilityState={{ expanded: open }}
            disabled={!join.can('showJoinGroup', {})}
            onPress={() => {
              setOpen(!open);
              setInvalid(false);
            }}
            style={({ pressed }) => [{ height: 44, justifyContent: 'center', paddingLeft: 16, paddingRight: 24, marginRight: -12 }, pressed && s.pressed]}
          >
            <Text style={[s.headerActionText, s.link]}>Join with a link</Text>
          </Pressable>
        )}
        below={(
          <Reveal>
            {open ? (
              <View style={{ gap: 8, paddingTop: 4 }}>
                <View style={[s.fieldRow, invalid && { borderColor: colors.owes }]}>
                  <TextInput
                    ref={field}
                    autoFocus
                    accessibilityLabel="Invite link"
                    value={link}
                    onChangeText={(value) => {
                      setLink(value);
                      setInvalid(false);
                    }}
                    onSubmitEditing={submit}
                    placeholder="Paste invite link"
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    style={[s.input, { fontFamily: monoFamily, fontSize: 15 }]}
                  />
                  <Pressable accessibilityRole="button" onPress={submit} style={({ pressed }) => [s.fieldButton, pressed && s.pressed]}>
                    <Text style={s.fieldButtonText}>Open</Text>
                  </Pressable>
                </View>
                {invalid ? <Text style={[s.caption, { color: colors.owes }]}>That isn’t a splitnext invite link.</Text> : null}
              </View>
            ) : null}
          </Reveal>
        )}
        title="Your groups"
      />
      <ErrorMessage message={join.error} />
    </>
  );
}

/** The first screen, before any group: the same list, empty, with how to begin. */
export function WelcomeView() {
  return (
    <View style={s.emptyState}>
      <Text style={s.emptyTitle}>No groups yet</Text>
      <Text style={s.emptyText}>Start a group for a trip or a shared home, or join one with an invite link.</Text>
    </View>
  );
}

/** Your balance and how it compares with your other groups, or why there is none. */
function GroupBalance(props: { group: ClientGroupSummary }) {
  const balances = props.group.stored_locally ? props.group.you_balances : undefined;

  if (balances === null) return <Text style={[s.amount, { color: colors.muted }]}>choose who you are</Text>;

  if (balances === undefined) return <Text style={[s.amount, { color: colors.muted }]}>—</Text>;

  if (!balances.length) return <Text style={[s.amount, { color: colors.muted }]}>settled</Text>;

  return (
    <View style={{ alignItems: 'flex-end', gap: 6 }}>
      {balances.map(({ currency, amount }) => (
        <Text key={currency} ref={morph(`gamt-${props.group.group_id}-${currency}`)} style={[s.amount, { color: balanceColor(amount) }]}>{signedFigure(amount, currency)}</Text>
      ))}
    </View>
  );
}

/** Your groups as ruled rows with your balance as a bar, then the groups you left. */
export function GroupsView(props: GroupsViewProps) {
  const state = props.app.snapshot();
  const showLeft = useUiState().showLeftGroups;
  const actions = useActions();
  // The row last pressed, so a failure appears beside that row.
  const [target, setTarget] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const action = useActionCall();
  const active = state.groups.filter((group) => group.status === 'active');
  const left = state.groups.filter((group) => group.status === 'left');
  const firstBalance = (group: ClientGroupSummary) => (group.stored_locally ? group.you_balances?.[0]?.amount ?? 0 : 0);
  const max = Math.max(1, ...active.map((group) => Math.abs(firstBalance(group))));

  function open(group: ClientGroupSummary): void {
    setTarget(group.group_id);
    void action.call('openGroup', { groupId: group.group_id });
  }

  function leave(group: ClientGroupSummary): void {
    setTarget(group.group_id);
    void action.call('openGroup', { groupId: group.group_id }, () => {
      void action.call('leaveGroup', {}, () => setLeaving(null), true);
    });
  }

  function row(group: ClientGroupSummary) {
    const people = group.member_count === null ? null : group.member_count === 1 ? '1 person' : `${group.member_count} people`;
    const meta = [people, group.you_name ? `You’re ${group.you_name}` : null].filter(Boolean).join(' · ');
    const review = state.reviewGroups.includes(group.group_id);

    return (
      <View key={group.group_id}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${group.name}`}
          disabled={action.busy}
          onPress={() => open(group)}
          style={({ pressed }) => [s.groupCard, pressed && s.pressed]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
              <Text ref={morph(`gname-${group.group_id}`)} numberOfLines={1} style={{ maxWidth: '100%', fontFamily, fontSize: 20, lineHeight: 21, fontWeight: '600', color: colors.ink }}>{group.name}</Text>
            </View>
            <GroupBalance group={group} />
          </View>
          <BalanceBar track amount={firstBalance(group)} max={max} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={s.caption}>{meta || ' '}</Text>
              {group.pending_commands ? <Text style={s.caption}>{group.pending_commands === 1 ? '1 change waiting' : `${group.pending_commands} changes waiting`}</Text> : null}
              {review ? <Text style={[s.caption, { fontWeight: '600', color: colors.warningInk }]}>A change needs review</Text> : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Leave ${group.name}`}
              onPress={() => setLeaving(leaving === group.group_id ? null : group.group_id)}
              style={({ pressed }) => [{ width: 44, height: 44, margin: -12, marginLeft: 0, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed]}
            >
              <TrashIcon size={18} color={colors.muted} />
            </Pressable>
          </View>
        </Pressable>
        <Reveal>
          {leaving === group.group_id ? (
            <View style={{ gap: 10, paddingBottom: 18 }}>
              <Text style={s.body}>Leave {group.name} on this device? You can rejoin it later.</Text>
              <View style={s.actions}>
                <Button grow secondary disabled={action.busy} onPress={() => setLeaving(null)}>Cancel</Button>
                <Button grow disabled={action.busy || !state.online} onPress={() => leave(group)}>Leave</Button>
              </View>
              {!state.online ? <Text style={s.caption}>You’re offline. Connect to leave.</Text> : null}
            </View>
          ) : null}
        </Reveal>
        {target === group.group_id ? <ErrorMessage message={action.error} /> : null}
      </View>
    );
  }

  function leftRow(group: ClientGroupSummary) {
    return (
      <View key={group.group_id}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rejoin ${group.name}`}
          disabled={action.busy}
          onPress={() => open(group)}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18 }, s.ruled, pressed && s.pressed]}
        >
          <Text numberOfLines={1} style={{ flex: 1, fontFamily, fontSize: 20, fontWeight: '600', color: colors.faint }}>{group.name}</Text>
          <Text style={s.rowAction}>Rejoin</Text>
        </Pressable>
        {target === group.group_id ? <ErrorMessage message={action.error} /> : null}
      </View>
    );
  }

  return (
    <View>
      {active.length ? active.map(row) : <WelcomeView />}
      {left.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showLeft }}
          onPress={() => {
            void actions.dispatch('setLeftGroupsVisible', { visible: !showLeft }, { origin: 'ui' });
          }}
          style={({ pressed }) => [{ minHeight: 52, justifyContent: 'center' }, s.ruled, pressed && s.pressed]}
        >
          <Text style={[s.caption, s.link, { fontSize: 14 }]}>{`${showLeft ? 'Hide' : 'Show'} ${left.length === 1 ? '1 group' : `${left.length} groups`} you left`}</Text>
        </Pressable>
      ) : null}
      <Reveal>{showLeft && left.length ? <View>{left.map(leftRow)}</View> : null}</Reveal>
      <View style={s.ruled} />
    </View>
  );
}
