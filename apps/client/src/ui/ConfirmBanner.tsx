import { Text, View } from 'react-native';
import { Button, s } from './components';

type ConfirmBannerProps = {
  /** The action's own confirmation message, from the action layer. */
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Asks the person to approve an app action that returned a confirmation. */
export function ConfirmBanner(props: ConfirmBannerProps) {
  return (
    <View accessibilityLiveRegion="polite" style={s.banner}>
      <Text style={s.body}>{props.message}</Text>
      <View style={s.row}>
        <Button quiet disabled={props.busy} onPress={props.onCancel}>
          Cancel
        </Button>
        <Button
          danger={Boolean(props.danger)}
          quiet={!props.danger}
          disabled={props.busy}
          onPress={props.onConfirm}
        >
          {props.confirmLabel}
        </Button>
      </View>
    </View>
  );
}
