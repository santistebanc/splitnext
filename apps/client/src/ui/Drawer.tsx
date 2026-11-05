import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { Row, Text, TextButton, colors, layout, scrim } from '../design';
import { ScreenModal } from './ScreenModal';
import { useCompactLayout } from './useVisibleViewport';

/** Fills its parent, for a backdrop behind a dialog. */
export const backdrop = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

/** The page dimmed under a dialog, which rises from its foot unless `centered`. */
export function overlay(centered: boolean): ViewStyle {
  return centered
    ? { flex: 1, backgroundColor: scrim, justifyContent: 'center', padding: layout.gutter }
    : { flex: 1, backgroundColor: scrim, justifyContent: 'flex-end' };
}

/** A dialog's own panel: the column's width, on the page color. */
export const sheet = {
  width: '100%',
  maxWidth: layout.column,
  alignSelf: 'center',
  backgroundColor: colors.background,
  paddingTop: 24,
  paddingHorizontal: layout.gutter,
  paddingBottom: 32,
  gap: 12,
} as const;

const drawerHeight = '88%';

const popupHeight = '80%';

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
      <View style={overlay(!compact)}>
        <Pressable accessibilityLabel="Close" style={backdrop} onPress={props.onClose} />
        <View
          role="dialog"
          aria-modal
          aria-label={props.title}
          style={[sheet, { maxHeight: drawerHeight, paddingTop: 16 }, !compact && { maxWidth: layout.dialog, maxHeight: popupHeight, paddingBottom: 24 }, props.full && { height: compact ? drawerHeight : popupHeight }]}
        >
          {/* The same title row as a drawer rising from the footer. */}
          <Row gap={8} justify="between">
            <Text accessibilityRole="header" numberOfLines={1} variant="heading" style={{ flexShrink: 1 }}>{props.title}</Text>
            <TextButton tone="muted" underline={false} onPress={props.onClose} style={{ paddingLeft: 16 }}>Close</TextButton>
          </Row>
          {props.children}
        </View>
      </View>
    </ScreenModal>
  );
}
