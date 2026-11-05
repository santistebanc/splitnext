import { useEffect, useRef } from 'react';
import type { TextInput } from 'react-native';
import { Chip, Field, Row, Stack, durations } from '../design';
import type { AppController } from '../model/controller';
import { useFieldFocused } from './screenHost';
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
  const fieldFocused = useFieldFocused();

  // Opening dismisses the keyboard after this form's effects, so focus waits a
  // frame, and tries again once the drawer has opened in case it was taken.
  useEffect(() => {
    const focus = () => {
      if (!fieldFocused()) nameInput.current?.focus();
    };

    const frame = requestAnimationFrame(focus);
    const opened = setTimeout(focus, durations.medium + 60);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(opened);
    };
  }, []);

  const { submit } = useSubmitCreate(props.close);
  // The names you go by in your other groups, once each, other than the one entered.
  const typed = person.trim().toLowerCase();

  const suggestions = [...new Map(props.app.snapshot().groups.flatMap((group) => (group.you_name ? [[group.you_name.trim().toLowerCase(), group.you_name.trim()] as const] : []))).values()]
    .filter((suggestion) => suggestion.toLowerCase() !== typed)
    .slice(0, 6);

  return (
    <Stack gap={12} paddingTop={4}>
      <Field
        label="Group name"
        inputRef={nameInput}
        placeholder="Lisbon trip"
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
      {suggestions.length ? (
        <Row role="list" aria-label="Names you use in other groups" wrap gap={8} style={{ marginTop: -4 }}>
          {suggestions.map((suggestion) => (
            <Chip
              key={suggestion}
              text={suggestion}
              label={`Use ${suggestion}`}
              onPress={() => {
                void actions.dispatch('changeDraft', { field: 'create.yourName', value: suggestion }, { origin: 'ui' });
              }}
            />
          ))}
        </Row>
      ) : null}
    </Stack>
  );
}
