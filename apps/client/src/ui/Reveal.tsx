import type { ReactNode, RefObject } from 'react';
import { View } from 'react-native';

export type RevealProps = {
  children: ReactNode;
  /** Closes the open content when a tap lands outside it and outside `toggle`. */
  onOutsidePress?: (() => void) | undefined;
  /** The control that opens and closes the content, whose own taps it handles. */
  toggle?: RefObject<View | null>;
  /** Opens upward from below, as from a button at the foot of the screen. */
  upward?: boolean;
};

/** Content that opens in place; native shows it at once and leaves dismissing to its controls. */
export function Reveal(props: RevealProps) {
  return <View>{props.children}</View>;
}
