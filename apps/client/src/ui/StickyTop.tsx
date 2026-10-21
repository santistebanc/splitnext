import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Keeps its content at the top of the scroll area it belongs to once it
 * scrolls there, taking no room in the page when given a height. Native has
 * no sticky positioning yet, so there it stays in place.
 */
export function StickyTop(props: { height?: number | undefined; top?: number; layer?: number; pinned?: boolean; children: ReactNode }) {
  return (
    <View style={[{ zIndex: props.layer ?? 2 }, props.height !== undefined && { height: props.height, marginBottom: -props.height }]}>
      {props.children}
    </View>
  );
}
