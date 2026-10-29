import { Pressable, Text, View } from 'react-native';
import { Button, s } from './components';
import { ScreenModal } from './ScreenModal';

type ConfirmSheetProps = {
  title: string;
  /** The action's own confirmation message, from the action layer. */
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** An action's confirmation message, with Cancel beside the dark button that confirms it. */
export function Confirmation(props: Omit<ConfirmSheetProps, 'title'>) {
  return (
    <>
      <Text style={s.lead}>{props.message}</Text>
      <View style={[s.actions, { marginTop: 8 }]}>
        <Button grow secondary disabled={props.busy} onPress={props.onCancel}>
          Cancel
        </Button>
        <Button grow dark disabled={props.busy} onPress={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      </View>
    </>
  );
}

/** A bottom sheet asking the person to approve an action that returned a confirmation. */
export function ConfirmSheet(props: ConfirmSheetProps) {
  return (
    <ScreenModal onRequestClose={props.onCancel}>
      <View style={s.overlay}>
        <Pressable accessibilityLabel="Cancel" style={s.backdrop} onPress={props.onCancel} />
        <View role="dialog" aria-modal aria-label={props.title} style={s.sheet}>
          <Text accessibilityRole="header" style={s.drawerTitle}>
            {props.title}
          </Text>
          <Confirmation {...props} />
        </View>
      </View>
    </ScreenModal>
  );
}
