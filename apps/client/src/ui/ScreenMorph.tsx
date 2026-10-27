import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Changes of screen; native shows the new screen at once. */
export function ScreenMorph(props: { screen: string; depth: number; children: ReactNode }) {
  return <View style={{ flex: 1 }}>{props.children}</View>;
}

/** Marks a part that appears on two screens; native has nothing to fly. */
export function morph(_key: string | null | undefined, _options?: { stretch?: boolean }) {
  return undefined;
}
