import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { parseInviteLink, type ClientGroupSummary } from '@splitnext/client';
import { ArrowRightIcon, BrandMark, CheckIcon, Button, Divider, EmptyState, ErrorMessage, Field, IconButton, ListRow, Notice, Row, Stack, Text, TextButton, Touchable, TrashIcon, between, colors, layout, rules, sizes, titleStyle } from '../design';
import { Confirmation } from './ConfirmSheet';
import type { AppController } from '../model/controller';
import { balanceColor, signedFigure } from './balance';
import { CreateGroup, useSubmitCreate } from './CreateGroup';
import { EditCover } from './EditCover';
import { FooterDrawer } from './FooterDrawer';
import { useCompactProgress } from './pageScroll';
import { Reveal } from './Reveal';
import { ScreenHeader } from './ScreenHeader';
import { morph } from './ScreenMorph';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type GroupsViewApp = Pick<AppController, 'snapshot'>;

type GroupsViewProps = { app: GroupsViewApp };

/** The groups list's main action, pinned at the foot of the screen. */
export function GroupsFooter(props: { app: GroupsViewApp }) {
  const ui = useUiState();
  const actions = useActions();
  const action = useActionCall();
  const { action: create, submit } = useSubmitCreate();
  const creating = ui.view === 'create';
  const busy = ui.phase === 'creating' || create.busy;
  const { online, reachable } = props.app.snapshot();

  function close(): void {
    void actions.dispatch('showGroups', {}, { origin: 'ui' });
  }

  return (
    <FooterDrawer
      open={creating}
      title="New group"
      closeLabel="Back to groups"
      busy={busy}
      onClose={close}
      footer={(
        <>
          <ErrorMessage message={action.error} />
          <Button
           
            ref={morph('newgroup')}
            busy={creating && busy}
            disabled={creating ? !create.can('submitCreateGroup') : !action.can('showCreateGroup')}
            onPress={() => {
              if (creating) submit();
              else void action.call('showCreateGroup', {});
            }}
          >
            {creating ? (busy ? 'Creating…' : create.error ? 'Try again' : 'Create group') : 'New group'}
          </Button>
        </>
      )}
    >
      <CreateGroup app={props.app} />
      {!online || !reachable ? (
        <Notice
          tone="danger"
          role="alert"
          message={`Can’t create the group. ${!online ? 'You’re offline.' : 'Splitnext can’t be reached.'} Nothing you typed was lost.`}
        />
      ) : null}
      <ErrorMessage message={create.error} />
    </FooterDrawer>
  );
}

/**
 * The name and Join with a link above the large mark. Join opens a link
 * field directly under it; Open checks the link on the join screen.
 */
export function GroupsHeader() {
  const progress = useCompactProgress();
  const join = useActionCall();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [invalid, setInvalid] = useState(false);
  const field = useRef<TextInput>(null);
  const joinToggle = useRef<View>(null);
  const joinPanel = useRef<View>(null);

  function close(): void {
    setOpen(false);
    setInvalid(false);
  }

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
        end={(
          <TextButton
            ref={joinToggle}
            label="Join with an invite link"
            expanded={open}
            disabled={!join.can('showJoinGroup', {})}
            onPress={() => {
              setOpen(!open);
              setInvalid(false);
            }}
            style={{ height: sizes.touch, paddingLeft: 16, paddingRight: 24, marginRight: -12 }}
          >
            Join with a link
          </TextButton>
        )}
        underRow={(
          <Reveal toggle={joinToggle} onOutsidePress={close}>
            {open ? (
              <Stack ref={joinPanel} paddingTop={4}>
                {/* The same field as the join screen's, with Open at its end. */}
                <Field
                  inputRef={field}
                  label="Invite link"
                  hideLabel
                  autoFocus
                  value={link}
                  onChangeText={(value) => {
                    setLink(value);
                    setInvalid(false);
                  }}
                  onSubmitEditing={submit}
                  placeholder="Paste invite link"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  error={invalid ? 'That isn’t a splitnext invite link.' : undefined}
                  trailing={<Button size="compact" label="Open" icon={<ArrowRightIcon size={16} color={colors.background} />} onPress={submit} />}
                />
              </Stack>
            ) : null}
          </Reveal>
        )}
        heading={(
          // The mark and the name stand where a title would be, as large and
          // shrinking the same way; together they are still the screen's heading.
          <View accessibilityRole="header" accessibilityLabel="Your groups" style={{ flexDirection: 'row', alignItems: 'center', gap: between(10, 7, progress) }}>
            <BrandMark size={between(34, 22, progress)} />
            <Text numberOfLines={1} style={titleStyle(progress)}>splitnext</Text>
          </View>
        )}
      />
      <EditCover open={open} target={joinPanel} onPress={close} />
      <ErrorMessage message={join.error} />
    </>
  );
}

/** The first screen, before any group: the same list, empty, with how to begin. */
export function WelcomeView() {
  return <EmptyState title="No groups yet" text="Start a group for a trip or a shared home, or join one with an invite link." />;
}

/** Your balance and how it compares with your other groups, or why there is none. */
function GroupBalance(props: { group: ClientGroupSummary }) {
  const balances = props.group.stored_locally ? props.group.you_balances : undefined;

  if (balances === null) return <Text variant="figure" tone="muted">choose who you are</Text>;

  if (balances === undefined) return <Text variant="figure" tone="muted">—</Text>;

  if (!balances.length) return <View accessibilityLabel="settled"><CheckIcon size={18} color={colors.owed} /></View>;

  return (
    <Stack gap={8} align="end">
      {balances.map(({ currency, amount }) => (
        <Text key={currency} ref={morph(`gamt-${props.group.group_id}-${currency}`, { unclipped: true })} variant="figure" color={balanceColor(amount)}>{signedFigure(amount, currency)}</Text>
      ))}
    </Stack>
  );
}

/** Your groups as ruled rows with your balance in each, then the groups you left. */
export function GroupsView(props: GroupsViewProps) {
  const state = props.app.snapshot();
  const showLeft = useUiState().showLeftGroups;
  const actions = useActions();
  // The row last pressed, so a failure appears beside that row.
  const [target, setTarget] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  // The open confirmation's own trash button, which toggles it.
  const leaveToggle = useRef<View>(null);
  const action = useActionCall();
  const active = state.groups.filter((group) => group.status === 'active');
  const left = state.groups.filter((group) => group.status === 'left');

  function open(group: ClientGroupSummary): void {
    setTarget(group.group_id);
    void action.call('openGroup', { groupId: group.group_id });
  }

  // Leaving waits for the group to open: a call made from inside another's
  // callback would find the control still busy and be dropped.
  async function leave(group: ClientGroupSummary): Promise<void> {
    let opened = false;

    setTarget(group.group_id);
    await action.call('openGroup', { groupId: group.group_id }, () => { opened = true; });

    if (opened) await action.call('leaveGroup', {}, () => setLeaving(null), true);
  }

  function row(group: ClientGroupSummary) {
    const review = state.reviewGroups.includes(group.group_id);

    return (
      <View key={group.group_id}>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`Open ${group.name}`}
          disabled={action.busy}
          feedback="tint"
          onPress={() => open(group)}
          style={[{ paddingVertical: 14, marginHorizontal: -layout.gutter, paddingHorizontal: layout.gutter }, rules.above]}
        >
          <Row gap={12} justify="between">
            <Stack fill gap={2} align="start">
              <Text ref={morph(`gname-${group.group_id}`)} numberOfLines={2} variant="headline" style={{ maxWidth: '100%' }}>{group.name}</Text>
              {group.pending_commands ? <Text variant="caption" tone="muted">{group.pending_commands === 1 ? '1 change waiting' : `${group.pending_commands} changes waiting`}</Text> : null}
              {review ? <Text variant="caption" tone="danger" weight="semibold">A change needs review</Text> : null}
            </Stack>
            <GroupBalance group={group} />
            <IconButton
              ref={leaving === group.group_id ? leaveToggle : undefined}
              label={`Leave ${group.name}`}
              onPress={() => setLeaving(leaving === group.group_id ? null : group.group_id)}
              style={{ marginVertical: -10, marginRight: -12 }}
            >
              <TrashIcon size={18} color={colors.muted} />
            </IconButton>
          </Row>
        </Touchable>
        <Reveal toggle={leaveToggle} onOutsidePress={() => setLeaving(null)}>
          {leaving === group.group_id ? (
            <Stack gap={12} paddingBottom={16}>
              <Confirmation
                message={`Leave ${group.name} on this device? You can rejoin it later.`}
                confirmLabel="Leave"
                busy={action.busy}
                disabled={!state.online}
                onConfirm={() => { void leave(group); }}
                onCancel={() => setLeaving(null)}
              />
              {!state.online ? <Text variant="caption" tone="muted">You’re offline. Connect to leave.</Text> : null}
            </Stack>
          ) : null}
        </Reveal>
        {target === group.group_id ? <ErrorMessage message={action.error} /> : null}
      </View>
    );
  }

  function leftRow(group: ClientGroupSummary) {
    return (
      <View key={group.group_id}>
        <ListRow label={`Rejoin ${group.name}`} disabled={action.busy} onPress={() => open(group)}>
          <Text numberOfLines={2} variant="headline" tone="faint" style={{ flex: 1 }}>{group.name}</Text>
          <Text variant="caption" weight="semibold" underline>Rejoin</Text>
        </ListRow>
        {target === group.group_id ? <ErrorMessage message={action.error} /> : null}
      </View>
    );
  }

  return (
    <View>
      {active.length ? active.map(row) : <WelcomeView />}
      {left.length ? (
        <Touchable
          accessibilityRole="button"
          accessibilityState={{ expanded: showLeft }}
          onPress={() => {
            void actions.dispatch('setLeftGroupsVisible', { visible: !showLeft }, { origin: 'ui' });
          }}
          style={[{ minHeight: sizes.row, justifyContent: 'center' }, rules.above]}
        >
          <Text variant="caption" tone="muted" underline>{`${showLeft ? 'Hide' : 'Show'} ${left.length === 1 ? '1 group' : `${left.length} groups`} you left`}</Text>
        </Touchable>
      ) : null}
      <Reveal>{showLeft && left.length ? <View>{left.map(leftRow)}</View> : null}</Reveal>
      <Divider />
    </View>
  );
}
