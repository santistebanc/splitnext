import { useEffect, useRef } from 'react';
import { View, type TextInput } from 'react-native';
import type { AppController } from '../model/controller';
import { Field } from './components';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type CreateGroupApp = Pick<AppController, 'snapshot'>;

type CreateGroupProps = { app: CreateGroupApp; close?: () => void };

export function useSubmitCreate(close?: () => void) {
  const action = useActionCall();

  function submit(): void {
    if (!action.can('submitCreateGroup')) return;

    void action.call('submitCreateGroup', {}, close);
  }

  return { action, submit };
}

/** One form for the group name and the creator's own member name. */
export function CreateGroup(props: CreateGroupProps) {
  const ui = useUiState();
  const { name, yourName: person } = ui.create;
  const actions = useActions();
  const personInput = useRef<TextInput>(null);
  const nameInput = useRef<TextInput>(null);

  // Opening dismisses the keyboard after this form's effects, so focus waits a frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => nameInput.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, []);
  const { submit } = useSubmitCreate(props.close);

  return (
    <View style={{ gap: 26, paddingTop: 12 }}>
      <Field
        label="Group name"
        hideLabel
        inputRef={nameInput}
        placeholder="Group name"
        value={name}
        editable={actions.availability('changeDraft', { field: 'create.name', value: name }).available}
        onChangeText={(value) => {
          void actions.dispatch('changeDraft', { field: 'create.name', value }, { origin: 'ui' });
        }}
        maxLength={100}
        autoFocus
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => personInput.current?.focus()}
      />
      <Field
        label="Your name in this group"
        hideLabel
        inputRef={personInput}
        placeholder="Your name"
        value={person}
        editable={actions.availability('changeDraft', { field: 'create.yourName', value: person }).available}
        onChangeText={(value) => {
          void actions.dispatch('changeDraft', { field: 'create.yourName', value }, { origin: 'ui' });
        }}
        maxLength={100}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
    </View>
  );
}
