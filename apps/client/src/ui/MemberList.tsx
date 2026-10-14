import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ClientReplicaState } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, colors, s } from './components';
import { useActionCall } from './useActionCall';
import { MemberRowTransition } from './MemberRowTransition';
import { YouBadge } from './YouBadge';

type LedgerMember = NonNullable<
  ClientReplicaState['projected_snapshot']
>['members'][number];

/** The controller surface the list uses, so previews can supply a fake. */
export type MemberListApp = Pick<AppController, 'snapshot'> & {
  client: Pick<AppController['client'], 'presence'>;
};

type MemberListProps = { app: MemberListApp; replica: ClientReplicaState };

export type ParticipantMarker = {
  identityId: string;
  label: string;
  you: boolean;
  status: 'online' | 'offline' | 'unknown';
};

type MemberRowProps = MemberListProps & {
  member: LedgerMember;
  editing: boolean;
  beginEdit: () => void;
  finishEdit: () => void;
};

/** A compact editable list; names and preferred-member selection stay in place. */
export function MemberList(props: MemberListProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const preferredId = props.replica.projected_snapshot?.access_grants.find(
    (grant) => grant.identity_id === props.replica.session?.identity.id,
  )?.preferred_member_id;

  const claimedMemberIds = new Set(
    props.replica.projected_snapshot?.access_grants
      .filter((grant) => !grant.hidden_at)
      .map((grant) => grant.preferred_member_id) ?? [],
  );

  const members =
    props.replica.projected_snapshot?.members.filter(
      (member) => member.status === 'active',
    ) ?? [];

  members.sort(
    (left, right) =>
      Number(right.id === preferredId) - Number(left.id === preferredId) ||
      Number(claimedMemberIds.has(right.id)) -
        Number(claimedMemberIds.has(left.id)),
  );
  const order = members.map((member) => member.id).join(',');

  return (
    <View>
      {members.map((member) => (
        <MemberRowTransition
          key={member.id}
          order={order}
          selected={member.id === preferredId}
          reducedMotion={reducedMotion}
        >
          <MemberRow
            app={props.app}
            replica={props.replica}
            member={member}
            editing={editingId === member.id}
            beginEdit={() => setEditingId(member.id)}
            finishEdit={() =>
              setEditingId((current) =>
                current === member.id ? null : current,
              )
            }
          />
        </MemberRowTransition>
      ))}
      {adding ? (
        <NewMemberRow finish={() => setAdding(false)} />
      ) : (
        <Button
          quiet
          onPress={() => {
            setEditingId(null);
            setAdding(true);
          }}
        >
          + Add member
        </Button>
      )}
    </View>
  );
}

export function MemberIcon(props: {
  joined: boolean;
  participants: ParticipantMarker[];
}) {
  const markers = [...props.participants].sort(
    (left, right) => Number(right.you) - Number(left.you),
  );

  const you = markers.some((participant) => participant.you);
  const capacity = you ? 5 : 6;

  const visibleMarkers =
    markers.length > capacity ? markers.slice(0, capacity - 1) : markers;

  const overflow = markers.length > visibleMarkers.length;

  return (
    <View style={s.memberSelectIcon} aria-hidden>
      <View style={[s.memberFigure, you && s.memberFigureYou]}>
        <View
          style={[
            s.memberSelectHead,
            props.joined && s.memberSelectJoined,
            you && s.memberSelectYou,
            you && s.memberSelectYouHead,
          ]}
        />
        <View
          style={[
            s.memberSelectBody,
            props.joined && s.memberSelectJoined,
            you && s.memberSelectYou,
            you && s.memberSelectYouBody,
          ]}
        />
      </View>
      <View style={s.memberPresence} pointerEvents="none">
        {visibleMarkers.map((participant) => (
          <View
            key={participant.identityId}
            style={[s.presenceMarker, participant.you && s.presenceYouSlot]}
          >
            {participant.you ? (
              <View style={s.presenceMarkerYou}>
                <YouBadge status={participant.status} />
              </View>
            ) : (
              <>
                <View
                  style={[
                    s.presenceRing,
                    participant.status === 'online' && s.presenceRingOnline,
                  ]}
                />
                <View
                  style={[
                    s.presenceDot,
                    participant.status === 'online' && s.presenceDotOnline,
                    participant.status === 'offline' && s.presenceDotOffline,
                  ]}
                />
              </>
            )}
          </View>
        ))}
        {overflow ? (
          <View style={s.presenceMarker}>
            <View style={s.presenceRing} />
            <Text style={s.presenceOverflowText}>…</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function NewMemberRow(props: { finish: () => void }) {
  const [name, setName] = useState('');
  const input = useRef<TextInput>(null);
  const action = useActionCall();

  function save(): void {
    if (!name.trim()) {
      props.finish();

      return;
    }

    void action.call('addMember', { name }, props.finish);
  }

  return (
    <View style={s.memberRow}>
      <View style={s.memberLine}>
        <View style={s.memberSelectButton}>
          <MemberIcon joined={false} participants={[]} />
        </View>
        <View style={s.personText}>
          <TextInput
            ref={input}
            accessibilityLabel="Member name"
            placeholder="Member name"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            editable={!action.busy}
            autoFocus
            maxLength={100}
            style={[s.name, s.memberNameInput]}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onBlur={save}
            onSubmitEditing={() => input.current?.blur()}
            onKeyPress={(event) => {
              if (event.nativeEvent.key === 'Escape') input.current?.blur();
            }}
          />
        </View>
        <View style={s.memberActionsButton} />
      </View>
      <ErrorMessage message={action.error} />
    </View>
  );
}

function MemberRow(props: MemberRowProps) {
  const member = props.member;
  const [name, setName] = useState(member.display_name);
  const [observedName, setObservedName] = useState(member.display_name);
  const select = useActionCall();
  const remove = useActionCall();
  const busy = select.busy || remove.busy;
  const editAction = useActionCall();
  const input = useRef<TextInput>(null);

  const actors =
    props.replica.projected_snapshot?.access_grants.filter(
      (grant) => grant.preferred_member_id === member.id && !grant.hidden_at,
    ) ?? [];

  const isYou = actors.some(
    (grant) => grant.identity_id === props.replica.session?.identity.id,
  );

  const presence = props.app.client.presence(props.replica.group_id);

  const participants: ParticipantMarker[] = actors.map((grant) => {
    const you = grant.identity_id === props.replica.session?.identity.id;

    const disconnected =
      !props.app.snapshot().online || !props.app.snapshot().reachable;

    return {
      identityId: grant.identity_id,
      label: `${grant.actor_handle}${you ? ' (you)' : ''}`,
      you,
      status: presence
        ? presence.includes(grant.identity_id)
          ? 'online'
          : 'offline'
        : you && disconnected
          ? 'offline'
          : 'unknown',
    };
  });

  const participantLabels = participants
    .map((participant) => `${participant.label}: ${participant.status}`)
    .join('; ');

  const needsReview = props.replica.notices.some(
    (notice) =>
      notice.outcome.target.kind === 'member' &&
      notice.outcome.target.id === member.id,
  );

  function edit(): void {
    if (!editAction.error) {
      setName(member.display_name);
      setObservedName(member.display_name);
    }

    props.beginEdit();
  }

  function save(): void {
    const submitted = name.trim();

    if (!submitted || submitted === observedName) {
      props.finishEdit();

      return;
    }

    void editAction.call(
      'renameMember',
      { memberId: member.id, name, expectedName: observedName },
      props.finishEdit,
    );
  }

  return (
    <View style={s.memberRow}>
      <View style={s.memberLine}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${isYou ? 'You' : 'This is me'}: ${member.display_name}, ${participantLabels || 'unclaimed'}`}
          accessibilityState={{ selected: isYou, disabled: busy }}
          aria-pressed={isYou}
          disabled={busy}
          onPress={() => {
            if (!isYou) void select.call('selectYou', { memberId: member.id });
          }}
          style={({ pressed }) => [
            s.memberSelectButton,
            (pressed || busy) && s.dim,
          ]}
        >
          <MemberIcon joined={actors.length > 0} participants={participants} />
        </Pressable>
        <View style={s.personText}>
          {props.editing ? (
            <TextInput
              ref={input}
              accessibilityLabel="Member name"
              value={name}
              onChangeText={setName}
              editable={!editAction.busy && !busy}
              maxLength={100}
              autoFocus
              style={[s.name, s.memberNameInput]}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onBlur={() => {
                save();
              }}
              onSubmitEditing={() => input.current?.blur()}
              onKeyPress={(event) => {
                if (event.nativeEvent.key === 'Escape') input.current?.blur();
              }}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${member.display_name}`}
              disabled={busy || editAction.busy}
              onPress={edit}
              style={s.editableMemberName}
            >
              <Text numberOfLines={1} style={[s.name, s.memberName]}>
                {member.display_name}
              </Text>
            </Pressable>
          )}
        </View>
        {!isYou ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${member.display_name}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => {
              void remove.call('removeMember', { memberId: member.id });
            }}
            style={s.memberActionsButton}
          >
            <Text style={s.name}>×</Text>
          </Pressable>
        ) : null}
      </View>
      {select.confirmation && !isYou ? (
        <View style={s.stack}>
          <Text style={s.caption}>{select.confirmation.message}</Text>
          <View style={s.row}>
            <Button quiet disabled={busy} onPress={select.cancel}>
              Cancel
            </Button>
            <Button
              quiet
              disabled={busy}
              onPress={select.confirmation.confirm}
            >
              Use anyway
            </Button>
          </View>
        </View>
      ) : null}
      {needsReview ? <Text style={s.error}>A change needs review</Text> : null}
      <ErrorMessage message={editAction.error} />
      <ErrorMessage message={select.error} />
      <ErrorMessage message={remove.error} />
    </View>
  );
}
