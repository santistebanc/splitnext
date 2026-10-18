import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { memberLabel, nameOrdinals, preferredMember, type ClientReplicaState } from '@splitnext/client';
import { orderedMembers, participantMarkers, memberStatus, type ParticipantMarker } from '../model/memberPresentation';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, colors, s } from './components';
import { useActionCall, useActions, useUiState } from './useActionCall';
import { MemberRowTransition } from './MemberRowTransition';
import { YouBadge } from './YouBadge';

export type { ParticipantMarker } from '../model/memberPresentation';

type LedgerMember = NonNullable<
  ClientReplicaState['projected_snapshot']
>['members'][number];

/** The controller surface the list uses, so previews can supply a fake. */
export type MemberListApp = Pick<AppController, 'snapshot'> & {
  client: Pick<AppController['client'], 'presence'>;
};

type MemberListProps = { app: MemberListApp; replica: ClientReplicaState };

type MemberRowProps = MemberListProps & {
  member: LedgerMember;
};

/** A compact editable list; names and preferred-member selection stay in place. */
export function MemberList(props: MemberListProps) {
  const edit = useUiState().memberEdit;
  const adding = edit !== null && edit.memberId === null;
  const action = useActionCall();
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

  const preferredId = preferredMember(props.replica.projected_snapshot, props.replica.session?.identity.id)?.id;
  const members = orderedMembers(props.replica);
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
          <MemberRow app={props.app} replica={props.replica} member={member} />
        </MemberRowTransition>
      ))}
      {adding ? (
        <NewMemberRow />
      ) : (
        <Button
          quiet
          disabled={!action.can('beginAddMember')}
          onPress={() => {
            void action.call('beginAddMember', {});
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
  const you = props.participants.some((participant) => participant.you);
  const count = props.participants.length;
  const status = memberStatus(props.participants);

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
      {count > 1 ? (
        <View style={s.participantMore} pointerEvents="none">
          <Text numberOfLines={1} style={s.participantMoreLabel}>
            +{count - 1}
          </Text>
        </View>
      ) : null}
      {count > 0 ? (
        <View style={s.memberPresence} pointerEvents="none">
          <View style={[s.presenceMarker, you && s.presenceMarkerYou]}>
            {you ? (
              <YouBadge status={status} />
            ) : (
              <>
                <View
                  style={[
                    s.presenceRing,
                    status === 'online' && s.presenceRingOnline,
                  ]}
                />
                <View
                  style={[
                    s.presenceDot,
                    status === 'online' && s.presenceDotOnline,
                    status === 'offline' && s.presenceDotOffline,
                  ]}
                />
              </>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** A member-name draft in its row; leaving the field saves it, and Enter or Escape leave it. */
function MemberNameInput(props: {
  name: string;
  placeholder?: string;
  onSave: () => void;
}) {
  const actions = useActions();
  const input = useRef<TextInput>(null);

  return (
    <TextInput
      ref={input}
      accessibilityLabel="Member name"
      placeholder={props.placeholder}
      placeholderTextColor={colors.muted}
      value={props.name}
      onChangeText={(value) => {
        void actions.dispatch(
          'changeDraft',
          { field: 'member.name', value },
          { origin: 'ui' },
        );
      }}
      editable={actions.availability('changeDraft', { field: 'member.name', value: props.name }).available}
      autoFocus
      maxLength={100}
      style={[s.name, s.memberNameInput]}
      returnKeyType="done"
      submitBehavior="blurAndSubmit"
      onBlur={props.onSave}
      onSubmitEditing={() => input.current?.blur()}
      onKeyPress={(event) => {
        if (event.nativeEvent.key === 'Escape') input.current?.blur();
      }}
    />
  );
}

function NewMemberRow() {
  const name = useUiState().memberEdit?.name ?? '';
  const action = useActionCall();

  function save(): void {
    void action.call('saveMemberEdit', {});
  }

  return (
    <View style={s.memberRow}>
      <View style={s.memberLine}>
        <View style={s.memberSelectButton}>
          <MemberIcon joined={false} participants={[]} />
        </View>
        <View style={s.personText}>
          <MemberNameInput name={name} placeholder="Member name" onSave={save} />
        </View>
        <View style={s.memberActionsButton} />
      </View>
      <ErrorMessage message={action.error} />
    </View>
  );
}

function MemberRow(props: MemberRowProps) {
  const member = props.member;
  const draft = useUiState().memberEdit;
  const editing = draft?.memberId === member.id;
  const name = editing ? draft.name : member.display_name;
  const label = memberLabel(member.display_name, nameOrdinals(props.replica.projected_snapshot).get(member.id));
  const select = useActionCall();
  const remove = useActionCall();
  const editAction = useActionCall();
  const canSelect = select.can('setPreferredMember', { memberId: member.id });
  const canRemove = remove.can('removeMember', { memberId: member.id });

  const state = props.app.snapshot();
  const participants = participantMarkers(props.replica, member.id, props.app.client.presence(props.replica.group_id), state.online && state.reachable);
  const isYou = participants.some((participant) => participant.you);

  const participantLabels = participants
    .map((participant) => `${participant.label}: ${participant.status}`)
    .join('; ');

  const needsReview = props.replica.notices.some(
    (notice) =>
      notice.outcome.target.kind === 'member' &&
      notice.outcome.target.id === member.id,
  );

  function edit(): void {
    void editAction.call('beginEditMember', { memberId: member.id });
  }

  function save(): void {
    if (editing) void editAction.call('saveMemberEdit', {});
  }

  return (
    <View style={s.memberRow}>
      <View style={s.memberLine}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${isYou ? 'You' : 'This is me'}: ${label}, ${participantLabels || 'unclaimed'}`}
          accessibilityState={{ selected: isYou, disabled: !canSelect }}
          aria-pressed={isYou}
          disabled={!canSelect}
          onPress={() => {
            if (!isYou) void select.call('setPreferredMember', { memberId: member.id });
          }}
          style={({ pressed }) => [
            s.memberSelectButton,
            (pressed || select.busy) && s.dim,
          ]}
        >
          <MemberIcon joined={participants.length > 0} participants={participants} />
        </Pressable>
        <View style={s.personText}>
          {editing ? (
            <MemberNameInput name={name} onSave={save} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${label}`}
              disabled={!editAction.can('beginEditMember', { memberId: member.id })}
              onPress={edit}
              style={s.editableMemberName}
            >
              <Text numberOfLines={1} style={[s.name, s.memberName]}>
                {label}
              </Text>
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          accessibilityState={{ disabled: !canRemove }}
          disabled={!canRemove}
          onPress={() => {
            void remove.call('removeMember', { memberId: member.id });
          }}
          style={s.memberActionsButton}
        >
          <Text style={s.name}>×</Text>
        </Pressable>
      </View>
      {select.confirmation && !isYou ? (
        <View style={s.stack}>
          <Text style={s.caption}>{select.confirmation.message}</Text>
          <View style={s.row}>
            <Button quiet disabled={select.busy} onPress={select.cancel}>
              Cancel
            </Button>
            <Button quiet disabled={select.busy} onPress={select.confirmation.confirm}>
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
