import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { s } from './components';

type SheetProps = { children: ReactNode; mobile: boolean };

/** A dialog panel whose content scrolls once it reaches the height limit. */
export function Sheet(props: SheetProps) {
  return (
    <View
      accessibilityViewIsModal
      style={[s.sheet, props.mobile && s.mobileSheet]}
    >
      <ScrollView contentContainerStyle={s.stack}>{props.children}</ScrollView>
    </View>
  );
}
