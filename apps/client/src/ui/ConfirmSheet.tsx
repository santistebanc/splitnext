import { Modal, Pressable, Text, View } from 'react-native';
import { Button, s } from './components';
import { colors, fontFamily } from './theme';

type ConfirmSheetProps = {
  title: string;
  /** The action's own confirmation message, from the action layer. */
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A bottom sheet asking the person to approve an action that returned a confirmation. */
export function ConfirmSheet(props: ConfirmSheetProps) {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={props.onCancel}>
      <View style={s.overlay}>
        <Pressable accessibilityLabel="Cancel" style={s.backdrop} onPress={props.onCancel} />
        <View role="dialog" aria-modal aria-label={props.title} style={s.sheet}>
          <Text accessibilityRole="header" style={s.drawerTitle}>
            {props.title}
          </Text>
          <Text style={{ fontFamily, fontSize: 15, lineHeight: 22, color: colors.soft }}>{props.message}</Text>
          <View style={[s.actions, { marginTop: 8 }]}>
            <Button grow secondary disabled={props.busy} onPress={props.onCancel}>
              Cancel
            </Button>
            <Button grow dark disabled={props.busy} onPress={props.onConfirm}>
              {props.confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
