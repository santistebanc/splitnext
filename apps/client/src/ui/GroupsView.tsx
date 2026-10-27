import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ClientGroupSummary } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { BrandMark } from './BrandMark';
import { Button, EmptyState, ErrorMessage, FooterButton, Pill, ScreenHeader, SectionHeading, balanceColor, s, signedMoney } from './components';
import { CheckIcon, ChevronDownIcon, LinkIcon, PeopleIcon, PlusIcon } from './icons';
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
        icon={<PlusIcon color={colors.actionInk} />}
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

/** The logo, the name, and Join, above the groups list. */
export function GroupsHeader() {
  const join = useActionCall();

  return (
    <>
      <ScreenHeader
        heading={(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <BrandMark size={32} />
            <Text numberOfLines={1} style={[s.screenTitle, { flexShrink: 1 }]}>splitnext</Text>
          </View>
        )}
        end={(
          <Button
            small
            secondary
            label="Join with an invite link"
            icon={<LinkIcon />}
            disabled={!join.can('showJoinGroup', {})}
            onPress={() => {
              void join.call('showJoinGroup', {});
            }}
          >
            Join
          </Button>
        )}
      />
      <ErrorMessage message={join.error} />
    </>
  );
}

/** The first screen, before any group: the logo and name, and Create or Join, centered. */
export function WelcomeView() {
  const action = useActionCall();

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 36, paddingVertical: 48 }}>
      <View style={{ alignItems: 'center', gap: 16 }}>
        <BrandMark size={128} />
        <Text accessibilityRole="header" style={s.screenTitle}>splitnext</Text>
      </View>
      <View style={{ width: '100%', maxWidth: 320, gap: 10 }}>
        <Button
          icon={<PlusIcon color={colors.actionInk} />}
          disabled={!action.can('showCreateGroup')}
          onPress={() => {
            void action.call('showCreateGroup', {});
          }}
        >
          Create a group
        </Button>
        <Button
          secondary
          icon={<LinkIcon />}
          disabled={!action.can('showJoinGroup', {})}
          onPress={() => {
            void action.call('showJoinGroup', {});
          }}
        >
          Join a group
        </Button>
        <ErrorMessage message={action.error} />
      </View>
    </View>
  );
}

/** The installation's groups as cards with your balance, and the groups you left. */
export function GroupsView(props: GroupsViewProps) {
  const state = props.app.snapshot();
  const showLeft = useUiState().showLeftGroups;
  const actions = useActions();
  // The card last pressed, so a failure to open it appears beside that card.
  const [target, setTarget] = useState<string | null>(null);
  const action = useActionCall();
  const active = state.groups.filter((group) => group.status === 'active');
  const left = state.groups.filter((group) => group.status === 'left');

  function open(group: ClientGroupSummary): void {
    setTarget(group.group_id);
    void action.call('openGroup', { groupId: group.group_id });
  }

  function card(group: ClientGroupSummary) {
    const isLeft = group.status === 'left';
    const people = group.member_count === null ? null : group.member_count === 1 ? '1 person' : `${group.member_count} people`;
    const balances = group.status === 'active' && group.stored_locally ? group.you_balances : undefined;
    const review = state.reviewGroups.includes(group.group_id);

    return (
      <View key={group.group_id} style={{ gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${isLeft ? 'Rejoin' : 'Open'} ${group.name}`}
          disabled={action.busy}
          onPress={() => open(group)}
          style={({ pressed }) => [s.groupCard, isLeft && { backgroundColor: colors.background }, pressed && s.pressed]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily, fontSize: 18, fontWeight: '600', color: colors.ink }}>{group.name}</Text>
            {people ? <Text style={s.caption}>{people}</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: balances?.length ? 'flex-end' : 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text numberOfLines={1} style={s.caption}>
                {isLeft ? 'You left this group' : group.you_name ? `You’re ${group.you_name}` : balances === null ? 'No name chosen' : ' '}
              </Text>
              {group.pending_commands ? <Text style={s.caption}>{group.pending_commands === 1 ? '1 change waiting' : `${group.pending_commands} changes waiting`}</Text> : null}
              {review ? <Text style={{ fontFamily, fontSize: 13, fontWeight: '600', color: colors.warningInk }}>A change needs review</Text> : null}
            </View>
            {isLeft ? (
              <Text style={s.rowAction}>Rejoin</Text>
            ) : balances === null ? (
              <Pill text="Choose who you are" />
            ) : balances === undefined ? (
              <Text style={[s.amount, { fontSize: 17, color: colors.muted }]}>—</Text>
            ) : balances.length ? (
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                {balances.map(({ currency, amount }) => (
                  <Text key={currency} style={{ fontFamily: monoFamily, fontSize: 17, fontWeight: '600', color: balanceColor(amount) }}>
                    {signedMoney(amount, currency)}
                  </Text>
                ))}
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <CheckIcon color={colors.settled} />
                <Text style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.settled }}>Settled</Text>
              </View>
            )}
          </View>
        </Pressable>
        {target === group.group_id ? <ErrorMessage message={action.error} /> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionHeading title="Your groups" />
      {active.length ? (
        active.map(card)
      ) : (
        <EmptyState
          icon={<PeopleIcon size={34} color={colors.action} strokeWidth={1.6} />}
          title="No groups yet"
          text="Create a group to start splitting expenses, or join one with an invite link."
        />
      )}
      {left.length ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            quiet
            small
            expanded={showLeft}
            icon={(
              <View style={showLeft ? { transform: [{ rotate: '180deg' }] } : null}>
                <ChevronDownIcon color={colors.action} strokeWidth={1.8} />
              </View>
            )}
            onPress={() => {
              void actions.dispatch('setLeftGroupsVisible', { visible: !showLeft }, { origin: 'ui' });
            }}
          >
            {`${showLeft ? 'Hide' : 'Show'} ${left.length === 1 ? '1 group' : `${left.length} groups`} you left`}
          </Button>
        </View>
      ) : null}
      {showLeft && left.length ? left.map(card) : null}
    </View>
  );
}
