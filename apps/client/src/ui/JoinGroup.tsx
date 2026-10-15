import { previewFromSnapshot } from '@splitnext/client';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { AppController } from '../model/controller';
import { workflowBusy } from '../model/workflow';
import { Button, ErrorMessage, Field, s } from './components';
import { useActionCall, useActions, useUiState } from './useActionCall';
import { useCompactLayout } from './useVisibleViewport';

export type JoinGroupApp = Pick<AppController, 'snapshot' | 'lastYouName'>;

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
  const previewing = useActionCall();
  const joining = useActionCall();
  const busy = previewing.busy || joining.busy || workflowBusy(ui);
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
              disabled={
                !actions.availability('clearInvitePreview', {}).available
              }
              onPress={() => {
                void previewing.call('clearInvitePreview', {});
              }}
            >
              Change link
            </Button>
          ) : null}
          <Button
            quiet
            disabled={!actions.availability('closePanel', {}).available}
            onPress={() => {
              void previewing.call('closePanel', {}, props.close);
            }}
          >
            ← Back
          </Button>
        </View>
      </View>
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
              editable={!workflowBusy(ui)}
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
              disabled={
                busy ||
                !actions.availability('checkInvite', {
                  link: link || props.initialLink,
                }).available
              }
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
                  busy ||
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
                busy ||
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
                editable={!busy}
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
              disabled={
                busy || !actions.availability('submitJoin', {}).available
              }
              onPress={() => {
                if (!chosen) return;
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
