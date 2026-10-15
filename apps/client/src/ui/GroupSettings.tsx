import { Text, View } from 'react-native';
import type { AppController } from '../model/controller';
import { ConfirmBanner } from './ConfirmBanner';
import { Button, ErrorMessage, Field, s } from './components';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type GroupSettingsApp = Pick<AppController, 'snapshot'>;

type GroupSettingsProps = {
  app: GroupSettingsApp;
  close?: () => void;
  fullPage?: boolean;
};

/** Renaming and leaving the group, as a sheet or a full page on touch. */
export function GroupSettings(props: GroupSettingsProps) {
  const online = props.app.snapshot().online;

  const ui = useUiState();
  const { name, expectedName: observedName } = ui.settings;
  const actions = useActions();
  const back = useActionCall();
  const rename = useActionCall();
  const leave = useActionCall();

  function saveName(): void {
    if (!rename.can('saveGroupSettings')) return;

    void rename.call('saveGroupSettings', {}, props.close);
  }

  return (
    <>
      <View style={s.between}>
        <Text accessibilityRole="header" style={s.heading}>
          Group settings
        </Text>
        <Button
          quiet
          onPress={() => {
            void back.call('closePanel', {}, props.close);
          }}
          disabled={!back.can('closePanel')}
        >
          {props.fullPage ? 'Back to group' : 'Done'}
        </Button>
      </View>
      <Field
        label="Group name"
        value={name}
        editable={actions.availability('changeDraft', { field: 'settings.name', value: name }).available}
        onChangeText={(value) => {
          void actions.dispatch(
            'changeDraft',
            { field: 'settings.name', value },
            { origin: 'ui' },
          );
        }}
        maxLength={100}
        returnKeyType="done"
        onSubmitEditing={saveName}
      />
      {name.trim() !== observedName ? (
        <Button disabled={!rename.can('saveGroupSettings')} onPress={saveName}>
          Save group name
        </Button>
      ) : null}
      <ErrorMessage message={rename.error ?? back.error} />
      <View style={s.divider} />
      {leave.confirmation ? (
        <ConfirmBanner
          message={leave.confirmation.message}
          confirmLabel="Confirm leave"
          danger
          busy={leave.busy}
          onConfirm={leave.confirmation.confirm}
          onCancel={leave.cancel}
        />
      ) : (
        <Button
          danger
          disabled={!leave.can('leaveGroup')}
          onPress={() => {
            void leave.call('leaveGroup', {}, props.close);
          }}
        >
          Leave group
        </Button>
      )}
      {!online ? (
        <Text style={s.caption}>Offline · connect to leave this group</Text>
      ) : null}
      <ErrorMessage message={leave.error} />
    </>
  );
}
