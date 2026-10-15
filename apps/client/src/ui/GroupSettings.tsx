import { Text, View } from 'react-native';
import type { AppController } from '../model/controller';
import { workflowBusy } from '../model/workflow';
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
  const replica = props.app.snapshot().group;
  const online = props.app.snapshot().online;

  const ui = useUiState();
  const { name, expectedName: observedName } = ui.settings;
  const actions = useActions();
  const rename = useActionCall();
  const leave = useActionCall();
  const busy = rename.busy || leave.busy || workflowBusy(ui);

  function saveName(): void {
    if (!actions.availability('saveGroupSettings', {}).available) return;

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
            void rename.call('closePanel', {}, props.close);
          }}
          disabled={busy}
        >
          {props.fullPage ? 'Back to group' : 'Done'}
        </Button>
      </View>
      <Field
        label="Group name"
        value={name}
        editable={!busy}
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
        <Button
          disabled={
            busy || !actions.availability('saveGroupSettings', {}).available
          }
          onPress={saveName}
        >
          Save group name
        </Button>
      ) : null}
      <ErrorMessage message={rename.error} />
      <View style={s.divider} />
      {leave.confirmation ? (
        <ConfirmBanner
          message={leave.confirmation.message}
          confirmLabel="Confirm leave"
          danger
          busy={busy}
          onConfirm={leave.confirmation.confirm}
          onCancel={leave.cancel}
        />
      ) : (
        <Button
          danger
          disabled={busy || !online || Boolean(replica?.hidden)}
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
