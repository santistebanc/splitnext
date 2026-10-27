import type { ReactNode } from 'react';
import { View } from 'react-native';
import { s } from './components';

type ViewTransitionProps = { children: ReactNode; mobile: boolean };

/** A page's content column. Changes of screen move in ScreenMorph, around Frame. */
export function ViewTransition(props: ViewTransitionProps) {
  return <View style={[s.main, props.mobile && s.mobileMain]}>{props.children}</View>;
}
