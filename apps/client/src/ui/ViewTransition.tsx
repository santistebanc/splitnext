import type { ReactNode } from 'react';
import { View } from 'react-native';
import { layout } from '../design';

type ViewTransitionProps = { children: ReactNode; mobile: boolean };

/** A page's content column. Changes of screen move in ScreenMorph, around Frame. */
export function ViewTransition(props: ViewTransitionProps) {
  return <View style={{ flexGrow: 1, width: '100%', maxWidth: layout.prose, alignSelf: 'center', gap: 28 }}>{props.children}</View>;
}
