import { View } from 'react-native';
import { ToastContent, layout, type ToastProps } from '../design';

/** A message above the screen; content is shared with the web host. */
export function Toast(props: ToastProps) {
  return props.message ? (
    <View style={{ position: 'absolute', left: layout.gutter, right: layout.gutter, bottom: 28 }}>
      <ToastContent {...props} />
    </View>
  ) : null;
}
