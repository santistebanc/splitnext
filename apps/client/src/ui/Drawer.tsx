import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { s } from './components';
import { CloseIcon } from './icons';
import { ScreenModal } from './ScreenModal';
import { useCompactLayout } from './useVisibleViewport';

/**
 * A dialog over the screen: a drawer rising from the bottom on phones, a popup
 * in the middle of wider screens. Tapping outside it, Escape, or its close
 * button dismisses it. Content too tall for it scrolls in a child with
 * `flexShrink: 1`. A `full` drawer keeps its whole height, so a list that
 * filters as someone types does not make it jump.
 */
export function Drawer(props: { title: string; onClose: () => void; full?: boolean; children: ReactNode }) {
  const compact = useCompactLayout();

  return (
    <ScreenModal onRequestClose={props.onClose}>
      <View style={[s.overlay, !compact && s.overlayCentered]}>
        <Pressable accessibilityLabel="Close" style={s.backdrop} onPress={props.onClose} />
        <View role="dialog" aria-modal aria-label={props.title} style={[s.sheet, s.drawer, !compact && s.popup, props.full && { height: compact ? s.drawer.maxHeight : s.popup.maxHeight }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={[s.drawerTitle, { flex: 1 }]}>{props.title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={props.onClose}
              style={({ pressed }) => [s.drawerClose, pressed && s.pressed]}
            >
              <CloseIcon size={18} />
            </Pressable>
          </View>
          {props.children}
        </View>
      </View>
    </ScreenModal>
  );
}
