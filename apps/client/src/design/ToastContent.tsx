import { View } from 'react-native';
import { Text } from './Text';
import { Touchable } from './layout';
import { colors, sizes } from './tokens';

export type ToastProps = { message: string | null; action?: { text: string; onPress: () => void } | undefined };

/** The message and action shared by the web and native toast hosts. */
export function ToastContent(props: ToastProps) {
  return (
    <View role="status" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingLeft: 16, paddingRight: 8, backgroundColor: colors.ink }}>
      <Text testID="toast" variant="caption" tone="inverse" style={{ flex: 1 }}>{props.message}</Text>
      {props.action ? (
        <Touchable accessibilityRole="button" onPress={props.action.onPress} style={{ minHeight: sizes.touch, paddingHorizontal: 12, justifyContent: 'center' }}>
          <Text variant="caption" tone="positive" weight="semibold">{props.action.text}</Text>
        </Touchable>
      ) : null}
    </View>
  );
}
