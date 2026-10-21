import { useRef } from 'react';
import { Text, View, type TextInput } from 'react-native';
import type { AppController } from '../model/controller';
import { ErrorMessage, Field, FooterButton, Notice, s } from './components';
import { LinkIcon } from './icons';
import { colors } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type CreateGroupApp = Pick<AppController, 'snapshot'>;

type CreateGroupProps = { app: CreateGroupApp; close?: () => void };

function useSubmitCreate(close?: () => void) {
  const action = useActionCall();

  function submit(): void {
    if (!action.can('submitCreateGroup')) return;

    void action.call('submitCreateGroup', {}, close);
  }

  return { action, submit };
}

/** The New group screen's footer: why it could not be created, and Create group. */
export function CreateGroupFooter(props: { app: CreateGroupApp; close?: () => void }) {
  const ui = useUiState();
  const { action, submit } = useSubmitCreate(props.close);
  const { online, reachable } = props.app.snapshot();
  const busy = ui.phase === 'creating' || action.busy;

  return (
    <>
      {!online || !reachable ? (
        <Notice
          tone="danger"
          role="alert"
          message={`Can’t create the group. ${!online ? 'You’re offline.' : 'Splitnext can’t be reached.'} Nothing you typed was lost.`}
        />
      ) : null}
      <ErrorMessage message={action.error} />
      <FooterButton onPress={submit} busy={busy} disabled={!action.can('submitCreateGroup')}>
        {busy ? 'Creating…' : action.error ? 'Try again' : 'Create group'}
      </FooterButton>
    </>
  );
}

/** One form for the group name and the creator's own member name. */
export function CreateGroup(props: CreateGroupProps) {
  const ui = useUiState();
  const { name, yourName: person } = ui.create;
  const actions = useActions();
  const personInput = useRef<TextInput>(null);
  const { submit } = useSubmitCreate(props.close);
  const big = { height: 56, fontSize: 18 };

  return (
    <View style={{ gap: 22 }}>
      <Field
        label="Group name"
        placeholder="Lisbon, May"
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
        style={big}
      />
      <Field
        label="Your name in this group"
        inputRef={personInput}
        placeholder="Carlos"
        value={person}
        editable={actions.availability('changeDraft', { field: 'create.yourName', value: person }).available}
        onChangeText={(value) => {
          void actions.dispatch('changeDraft', { field: 'create.yourName', value }, { origin: 'ui' });
        }}
        maxLength={100}
        returnKeyType="done"
        onSubmitEditing={submit}
        style={big}
      />
      <Notice tone="info" icon={<LinkIcon size={20} color={colors.muted} />}>
        <Text style={[s.body, { flex: 1, fontSize: 14, lineHeight: 20, color: colors.soft }]}>You’ll get an invite link to share right away.</Text>
      </Notice>
    </View>
  );
}
