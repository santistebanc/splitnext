import { Pressable, Text, View } from 'react-native';
import { colors, fontFamily } from './theme';

export type ToastProps = { message: string | null; action?: { text: string; onPress: () => void } | undefined };

/** A dark message at the foot of the screen, with one action such as Undo. */
export function Toast(props: ToastProps) {
  return props.message ? (
    <View role="status" style={{ position: 'absolute', left: 16, right: 16, bottom: 28, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingLeft: 16, paddingRight: 8, borderRadius: 14, backgroundColor: colors.night }}>
      <Text testID="toast" style={{ flex: 1, fontFamily, fontSize: 14, lineHeight: 20, color: colors.surface }}>{props.message}</Text>
      {props.action ? (
        <Pressable accessibilityRole="button" onPress={props.action.onPress} style={{ height: 44, paddingHorizontal: 12, justifyContent: 'center' }}>
          <Text style={{ fontFamily, fontSize: 14, fontWeight: '600', color: colors.nightOwed }}>{props.action.text}</Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;
}
