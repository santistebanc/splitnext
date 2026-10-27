import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Content that opens in place; native shows it at once. */
export function Reveal(props: { children: ReactNode }) {
  return <View>{props.children}</View>;
}
