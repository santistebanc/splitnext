import { View } from 'react-native';
import { Text, Touchable, colors, sizes } from '../design';

export type ToastProps = { message: string | null; action?: { text: string; onPress: () => void } | undefined };

/** A dark message at the foot of the screen, with one action such as Undo. */
export function Toast(props: ToastProps) {
  return props.message ? (
    <View role="status" style={{ position: 'absolute', left: 16, right: 16, bottom: 28, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingLeft: 16, paddingRight: 8, backgroundColor: colors.ink }}>
      <Text testID="toast" variant="caption" tone="inverse" style={{ flex: 1 }}>{props.message}</Text>
      {props.action ? (
        <Touchable accessibilityRole="button" feedback="none" onPress={props.action.onPress} style={{ height: sizes.touch, paddingHorizontal: 12, justifyContent: 'center' }}>
          <Text variant="caption" tone="positive" weight="semibold">{props.action.text}</Text>
        </Touchable>
      ) : null}
    </View>
  ) : null;
}
