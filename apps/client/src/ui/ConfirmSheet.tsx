import { Button, Row, Stack, Text } from '../design';
import { Drawer } from './Drawer';

type ConfirmSheetProps = {
  title: string;
  /** The action's own confirmation message, from the action layer. */
  message: string;
  confirmLabel: string;
  busy: boolean;
  /** Keeps the confirming button from being pressed, as while offline; Cancel still works. */
  disabled?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * An action's confirmation message, with Cancel beside the black button that
 * confirms it: in a sheet, or in place under what asked, such as Leave on a
 * group's row or Reset link in the invite sheet.
 */
export function Confirmation(props: Omit<ConfirmSheetProps, 'title'>) {
  return (
    <Stack gap={16}>
      <Text variant="body">{props.message}</Text>
      <Row gap={12} align="stretch">
        <Button grow variant="secondary" disabled={props.busy} onPress={props.onCancel}>
          Cancel
        </Button>
        <Button grow disabled={props.busy || props.disabled} onPress={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      </Row>
    </Stack>
  );
}

/** A sheet asking the person to approve an action that returned a confirmation; its Cancel closes it, so its title has no Close. */
export function ConfirmSheet(props: ConfirmSheetProps) {
  return (
    <Drawer title={props.title} closeText={null} onClose={props.onCancel}>
      <Confirmation {...props} />
    </Drawer>
  );
}
