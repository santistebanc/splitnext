import { useState } from 'react';
import { Text, View } from 'react-native';
import type { AppController } from '../model/controller';
import { ConfirmBanner } from './ConfirmBanner';
import { Button, ErrorMessage, Field, s } from './components';
import { useActionCall } from './useActionCall';

export type GroupSettingsApp = Pick<AppController, 'snapshot'>;

type GroupSettingsProps = {
  app: GroupSettingsApp;
  close: () => void;
  fullPage?: boolean;
};

/** Renaming and leaving the group, as a sheet or a full page on touch. */
export function GroupSettings(props: GroupSettingsProps) {
  const replica = props.app.snapshot().group;
  const online = props.app.snapshot().online;

  const [observedName] = useState(
    replica?.projected_snapshot?.group.name ?? '',
  );

  const [name, setName] = useState(observedName);
  const rename = useActionCall();
  const leave = useActionCall();
  const busy = rename.busy || leave.busy;

  function saveName(): void {
    if (!name.trim() || name.trim() === observedName) return;

    void rename.call(
      'renameGroup',
      { name, expectedName: observedName },
      props.close,
    );
  }

  return (
    <>
      <View style={s.between}>
        <Text accessibilityRole="header" style={s.heading}>
          Group settings
        </Text>
        <Button quiet onPress={props.close} disabled={busy}>
          {props.fullPage ? 'Back to group' : 'Done'}
        </Button>
      </View>
      <Field
        label="Group name"
        value={name}
        onChangeText={setName}
        maxLength={100}
        returnKeyType="done"
        onSubmitEditing={saveName}
      />
      {name.trim() !== observedName ? (
        <Button
          disabled={!name.trim() || busy || Boolean(replica?.hidden)}
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
