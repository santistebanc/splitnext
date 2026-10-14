import { Text, View } from 'react-native';
import { Button, s } from './components';
import { MemberList, type MemberListApp } from './MemberList';
import type { Navigate } from './navigation';
import { useCompactLayout } from './useVisibleViewport';

type GroupViewProps = {
  app: MemberListApp;
  navigate: Navigate;
  showReview: boolean;
};

/** The open group: its name, invite action, and Members list. */
export function GroupView(props: GroupViewProps) {
  const mobile = useCompactLayout();
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;

  if (!snapshot || !replica) return null;

  const identityId = replica.session?.identity.id;

  const mine = snapshot.access_grants.find(
    (grant) => grant.identity_id === identityId,
  );

  // Inviting stays the primary action until someone else has joined.
  const othersJoined = snapshot.access_grants.some(
    (grant) => grant.identity_id !== identityId && !grant.hidden_at,
  );

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
            onPress={() => props.navigate('settings')}
          >
            Settings
          </Button>
        ) : null}
      </View>
      {replica.hidden ? (
        <View style={s.prompt}>
          <Text style={s.body}>You left this group.</Text>
          <Button onPress={() => props.navigate('rejoin')}>Rejoin group</Button>
        </View>
      ) : (
        <>
          {replica.notices.length && props.showReview ? (
            <Button secondary onPress={() => props.navigate('notices')}>
              Review changes · {replica.notices.length}
            </Button>
          ) : null}
          <Button
            secondary={othersJoined}
            onPress={() => props.navigate('invite')}
          >
            Share invite
          </Button>
          {!mine?.preferred_member_id ? (
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
