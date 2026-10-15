import { joinedParticipants, preferredMember } from '@splitnext/client';
import { Text, View } from 'react-native';
import { Button, s } from './components';
import { MemberList, type MemberListApp } from './MemberList';
import { useActionCall, useActions } from './useActionCall';
import { useCompactLayout } from './useVisibleViewport';

type GroupViewProps = {
  app: MemberListApp;
  showReview: boolean;
};

/** The open group: its name, invite action, and Members list. */
export function GroupView(props: GroupViewProps) {
  const mobile = useCompactLayout();
  const action = useActionCall();
  const actions = useActions();
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;

  if (!snapshot || !replica) return null;

  const identityId = replica.session?.identity.id;

  const you = preferredMember(snapshot, identityId);

  // Inviting stays the primary action until someone else has joined.
  const othersJoined = joinedParticipants(snapshot).some((grant) => grant.identity_id !== identityId);

  return (
    <>
      <View style={s.groupHeader}>
        <View style={s.groupTitle}>
          <Text
            accessibilityRole="header"
            style={[s.title, mobile && s.mobileTitle]}
          >
            {snapshot.group.name}
          </Text>
        </View>
        {!replica.hidden ? (
          <Button
            quiet
            label="Group settings"
            disabled={!actions.availability('showSettings', {}).available}
            onPress={() => {
              void action.call('showSettings', {});
            }}
          >
            Settings
          </Button>
        ) : null}
      </View>
      {replica.hidden ? (
        <View style={s.prompt}>
          <Text style={s.body}>You left this group.</Text>
          <Button
            disabled={!actions.availability('showRejoin', {}).available}
            onPress={() => {
              void action.call('showRejoin', {});
            }}
          >
            Rejoin group
          </Button>
        </View>
      ) : (
        <>
          {replica.notices.length && props.showReview ? (
            <Button
              secondary
              disabled={!actions.availability('showNotices', {}).available}
              onPress={() => {
                void action.call('showNotices', {});
              }}
            >
              Review changes · {replica.notices.length}
            </Button>
          ) : null}
          <Button
            secondary={othersJoined}
            disabled={!actions.availability('showInvite', {}).available}
            onPress={() => {
              void action.call('showInvite', {});
            }}
          >
            Share invite
          </Button>
          {!you ? (
            <View style={s.banner}>
              <Text style={s.body}>
                Which one is you? Tap the person icon beside your name.
              </Text>
            </View>
          ) : null}
          <View style={[s.card, s.peopleCard]}>
            <View style={s.between}>
              <Text style={s.heading}>Members</Text>
            </View>
            <MemberList app={props.app} replica={replica} />
          </View>
        </>
      )}
    </>
  );
}
