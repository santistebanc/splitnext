import type { ReactNode } from 'react';
import { View, type Text, type TextInput } from 'react-native';

/** Changes of screen; native shows the new screen at once. */
export function ScreenMorph(props: { screen: string; depth: number; sheet?: boolean; children: ReactNode }) {
  return <View style={{ flex: 1 }}>{props.children}</View>;
}

/** Marks a part that appears on two screens; native has nothing to fly. */
export function morph(_key: string | null | undefined, _options?: { stretch?: boolean; unclipped?: boolean; foot?: boolean }): ((node: HTMLElement | View | Text | TextInput | null) => void) | undefined {
  return undefined;
}
