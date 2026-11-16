import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Holds its content at the foot of the scroll area until it scrolls into its
 * place. Native has no sticky positioning yet, so there it stays in place,
 * fully docked.
 */
export function StickyFoot(props: { bottom: number; range: number; anchorId: string; held: boolean; children: (docked: number) => ReactNode }) {
  return (
    <>
      <View nativeID={props.anchorId} />
      <View>{props.children(1)}</View>
    </>
  );
}
