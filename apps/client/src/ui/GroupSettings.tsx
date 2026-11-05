import { Button, ErrorMessage, Field, Stack, Text, TextButton } from '../design';
import { ConfirmSheet } from './ConfirmSheet';
import type { MemberListApp } from './MemberList';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type GroupSettingsApp = MemberListApp;

type GroupSettingsProps = {
  app: GroupSettingsApp;
  close?: () => void;
};

function useSaveName(close?: () => void) {
  const rename = useActionCall();

  function save(): void {
    if (rename.can('saveGroupSettings')) void rename.call('saveGroupSettings', {}, close);
  }

  return { rename, save };
}

/** Saves a changed group name from settings. */
export function GroupSettingsFooter(props: { close?: () => void }) {
  const { rename, save } = useSaveName(props.close);
  const ui = useUiState();

  if (ui.settings.name.trim() === ui.settings.expectedName) return null;

  return (
    <>
      <ErrorMessage message={rename.error} />
      <Button busy={ui.phase === 'saving' || rename.busy} disabled={!rename.can('saveGroupSettings')} onPress={save}>
        {ui.phase === 'saving' || rename.busy ? 'Saving…' : 'Save group name'}
      </Button>
    </>
  );
}

/** Group settings: rename the group or leave it on this device. */
export function GroupSettings(props: GroupSettingsProps) {
  const ui = useUiState();
  const { name } = ui.settings;
  const actions = useActions();
  const { save } = useSaveName(props.close);
  const leave = useActionCall();

  return (
    <Stack gap={24}>
      <Field
        label="Group name"
        value={name}
        editable={actions.availability('changeDraft', { field: 'settings.name', value: name }).available}
        onChangeText={(value) => {
          void actions.dispatch('changeDraft', { field: 'settings.name', value }, { origin: 'ui' });
        }}
        maxLength={100}
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <Text variant="caption" tone="muted">Everyone in the group sees the new name.</Text>
      <TextButton
        tone="danger"
        label="Leave group on this device"
        disabled={!leave.can('leaveGroup')}
        onPress={() => { void leave.call('leaveGroup', {}); }}
      >
        Leave group
      </TextButton>
      <ErrorMessage message={leave.error} />
      {leave.confirmation ? (
        <ConfirmSheet
          title="Leave this group?"
          message={leave.confirmation.message}
          confirmLabel="Leave group"
          busy={leave.busy}
          onConfirm={leave.confirmation.confirm}
          onCancel={leave.cancel}
        />
      ) : null}
    </Stack>
  );
}
