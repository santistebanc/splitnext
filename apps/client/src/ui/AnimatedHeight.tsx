import type { ReactNode } from 'react';
import { View } from 'react-native';

/** How long a height change takes; native changes height at once. */
export const heightDuration = 0;

/** Native has no height transitions yet. */
export function usePrefersReducedMotion(): boolean {
  return true;
}

/** Shows its content up to a height, clipping the rest. */
export function AnimatedHeight(props: { height: number | undefined; animate?: boolean; children: ReactNode }) {
  return <View style={props.height === undefined ? undefined : { height: props.height, overflow: 'hidden' }}>{props.children}</View>;
}
