import { useRef } from 'react';
import { Text, View, type TextInput } from 'react-native';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, Field, s } from './components';
import { useActionCall, useActions, useUiState } from './useActionCall';
import { useCompactLayout } from './useVisibleViewport';

export type CreateGroupApp = Pick<AppController, 'snapshot'>;

type CreateGroupProps = { app: CreateGroupApp; close?: () => void };

/** One form for the group name and the creator's own member name. */
export function CreateGroup(props: CreateGroupProps) {
  const mobile = useCompactLayout();
  const ui = useUiState();
  const { name, yourName: person } = ui.create;
  const actions = useActions();
  const personInput = useRef<TextInput>(null);
  const action = useActionCall();
  const back = useActionCall();
  const { online, reachable } = props.app.snapshot();

  function submit(): void {
    if (!action.can('submitCreateGroup')) return;

    void action.call('submitCreateGroup', {}, props.close);
  }

  return (
    <>
      <Text
        accessibilityRole="header"
        style={[s.title, mobile && s.mobileTitle]}
      >
        Create group
      </Text>
      <View style={s.card}>
        <Field
          label="Group name"
          placeholder="e.g. Lisbon weekend"
          value={name}
          editable={actions.availability('changeDraft', { field: 'create.name', value: name }).available}
          onChangeText={(value) => {
            void actions.dispatch(
              'changeDraft',
              { field: 'create.name', value },
              { origin: 'ui' },
            );
          }}
          maxLength={100}
          autoFocus
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => personInput.current?.focus()}
        />
        <Field
          label="Your name"
          inputRef={personInput}
          placeholder="e.g. Santi"
          value={person}
          editable={actions.availability('changeDraft', { field: 'create.yourName', value: person }).available}
          onChangeText={(value) => {
            void actions.dispatch(
              'changeDraft',
              { field: 'create.yourName', value },
              { origin: 'ui' },
            );
          }}
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <ErrorMessage message={action.error ?? back.error} />
        <View style={s.actions}>
          <Button
            grow
            quiet
            disabled={!back.can('showGroups')}
            onPress={() => {
              void back.call('showGroups', {}, props.close);
            }}
          >
            Back to groups
          </Button>
          <Button grow onPress={submit} disabled={!action.can('submitCreateGroup')}>
            {ui.phase === 'creating' || action.busy
              ? 'Creating…'
              : 'Create group'}
          </Button>
        </View>
        {!online ? (
          <Text style={s.caption}>Offline · connect to create a group</Text>
        ) : !reachable ? (
          <Text style={s.caption}>
            Can’t reach Splitnext · connect to create a group
          </Text>
        ) : null}
      </View>
    </>
  );
}
