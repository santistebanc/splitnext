import { previewFromSnapshot } from '@splitnext/client';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, Field, s } from './components';
import { useActionCall, useActions, useUiState } from './useActionCall';
import { useCompactLayout } from './useVisibleViewport';

export type JoinGroupApp = Pick<AppController, 'snapshot'>;

type JoinGroupProps = {
  app: JoinGroupApp;
  close?: () => void;
  rejoining: boolean;
  initialLink: string;
};

/** Preview an invite, or a left group, and choose who you are in it. */
export function JoinGroup(props: JoinGroupProps) {
  const mobile = useCompactLayout();
  const ui = useUiState();
  const { link, preview, chosen, name } = ui.join;
  const actions = useActions();
  const back = useActionCall();
  const previewing = useActionCall();
  const joining = useActionCall();
  const checking = ui.phase === 'checking';
  const online = props.app.snapshot().online;
  const replica = props.app.snapshot().group;
  const rejoinSnapshot = props.rejoining ? replica?.projected_snapshot : null;
  const group = rejoinSnapshot?.group ?? preview?.group;

  // Names already used by a current participant, matching the invite preview.
  const people = (rejoinSnapshot ? previewFromSnapshot(rejoinSnapshot).members : preview?.members) ?? [];

  const orderedPeople = [...people].sort(
    (left, right) => Number(left.in_use) - Number(right.in_use),
  );

  function loadPreview(): void {
    void previewing.call(
      'checkInvite',
      { link: link || props.initialLink },
      (result) => {
        if (result.opened) props.close?.();
      },
    );
  }

  useEffect(() => {
    if (props.rejoining && actions.ui.snapshot().view !== 'rejoin')
      void actions.dispatch('showRejoin', {}, { origin: 'lifecycle' });

    if (props.initialLink && !props.rejoining) loadPreview();
  }, []);

  return (
    <>
      <View style={s.between}>
        <Text style={s.eyebrow}>
          {props.rejoining ? 'WELCOME BACK' : 'YOU’RE INVITED'}
        </Text>
        <View style={s.inlineActions}>
          {group && !props.rejoining ? (
            <Button
              quiet
              disabled={!previewing.can('clearInvitePreview')}
              onPress={() => {
                void previewing.call('clearInvitePreview', {});
              }}
            >
              Change link
            </Button>
          ) : null}
          <Button
            quiet
            disabled={!back.can('closePanel')}
            onPress={() => {
              void back.call('closePanel', {}, props.close);
            }}
          >
            ← Back
          </Button>
        </View>
      </View>
      <ErrorMessage message={back.error} />
      <Text
        accessibilityRole="header"
        style={[s.title, mobile && s.mobileTitle]}
      >
        {group ? group.name : 'Join a group'}
      </Text>
      <View style={s.card}>
        {!props.rejoining && !preview ? (
          <>
            <Field
              label="Invite link"
              value={link}
              editable={actions.availability('changeDraft', { field: 'join.link', value: link }).available}
              onChangeText={(text) => {
                void actions.dispatch(
                  'changeDraft',
                  { field: 'join.link', value: text },
                  { origin: 'ui' },
                );
              }}
              placeholder="https://…/join/…#…"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              secondary
              disabled={!previewing.can('checkInvite', { link: link || props.initialLink })}
              onPress={loadPreview}
            >
              {checking || previewing.busy ? 'Checking…' : 'Preview group'}
            </Button>
            <ErrorMessage message={previewing.error} />
          </>
        ) : null}
        {group ? (
          <>
            <Text style={s.heading}>Who are you?</Text>
            {orderedPeople.map((person) => (
              <Pressable
                key={person.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen === person.id }}
                aria-checked={chosen === person.id}
                disabled={
                  !actions.availability('chooseJoinMember', {
                    as: { kind: 'existing', memberId: person.id },
                  }).available
                }
                accessibilityLabel={`${person.display_name}${person.in_use ? ', in use' : ''}`}
                onPress={() => {
                  void actions.dispatch(
                    'chooseJoinMember',
                    { as: { kind: 'existing', memberId: person.id } },
                    { origin: 'ui' },
                  );
                }}
                style={[
                  s.choice,
                  s.between,
                  person.in_use && chosen !== person.id && s.choiceInUse,
                  chosen === person.id && s.chosen,
                ]}
              >
                <Text style={s.name}>{person.display_name}</Text>
                {person.in_use ? <Text style={s.caption}>In use</Text> : null}
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen === 'new' }}
              aria-checked={chosen === 'new'}
              disabled={
                !actions.availability('chooseJoinMember', {
                  as: { kind: 'new' },
                }).available
              }
              onPress={() => {
                void actions.dispatch(
                  'chooseJoinMember',
                  { as: { kind: 'new' } },
                  { origin: 'ui' },
                );
              }}
              style={[s.choice, chosen === 'new' && s.chosen]}
            >
              <Text style={s.name}>+ I’m someone new</Text>
            </Pressable>
            {chosen === 'new' ? (
              <Field
                label="Your name"
                value={name}
                editable={actions.availability('changeDraft', { field: 'join.name', value: name }).available}
                onChangeText={(value) => {
                  void actions.dispatch(
                    'changeDraft',
                    { field: 'join.name', value },
                    { origin: 'ui' },
                  );
                }}
                maxLength={100}
                autoFocus
              />
            ) : null}
            <Button
              disabled={!joining.can('submitJoin')}
              onPress={() => {
                void joining.call('submitJoin', {}, props.close);
              }}
            >
              {ui.phase === 'joining' || joining.busy
                ? 'Joining…'
                : props.rejoining
                  ? 'Rejoin group'
                  : 'Join group'}
            </Button>
            <ErrorMessage message={joining.error} />
          </>
        ) : null}
        {!online ? (
          <Text style={s.caption}>
            Offline · connect to {props.rejoining ? 'rejoin' : 'join'}
          </Text>
        ) : null}
      </View>
    </>
  );
}
