import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { Row, Text, TextButton, colors, durations, layout, scrim, withTransition } from '../design';
import { Reveal } from './Reveal';
import { useScreenSize } from './screenHost';
import { ScreenModal } from './ScreenModal';
import { useCompactLayout, useVisibleViewportHeight } from './useVisibleViewport';

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
  paddingTop: 16,
  paddingHorizontal: layout.gutter,
  paddingBottom: 32,
  gap: 12,
} as const;

/** How much of the screen a drawer may take. */
const drawerShare = 0.88;

const popupHeight = '80%';

/**
 * Every sheet's title row: its title, and a quiet text action that closes it
 * (Close, or Cancel where closing drops what was started). Left out when the
 * sheet's own buttons already close it, as a confirmation's Cancel does.
 */
export function SheetTitle(props: { title: string; closeText?: string | null | undefined; closeLabel?: string | undefined; disabled?: boolean | undefined; onClose: () => void }) {
  const close = props.closeText === undefined ? 'Close' : props.closeText;

  return (
    <Row gap={8} justify="between">
      <Text accessibilityRole="header" numberOfLines={1} variant="heading" style={{ flexShrink: 1 }}>{props.title}</Text>
      {close ? (
        <TextButton label={props.closeLabel} tone="muted" underline={false} disabled={props.disabled} onPress={props.onClose} style={{ paddingLeft: 16 }}>{close}</TextButton>
      ) : null}
    </Row>
  );
}

/** The page dimmed under a dialog, fading in as the dialog opens, as under a footer's drawer. */
function useScrimShown(): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));

    return () => cancelAnimationFrame(frame);
  }, []);

  return shown;
}

/**
 * A dialog over the screen: a drawer rising from the bottom on phones, a popup
 * in the middle of wider screens. Tapping outside it, Escape, or its close
 * button dismisses it. Content too tall for it scrolls in a child with
 * `flexShrink: 1`. A `full` drawer keeps its whole height, so a list that
 * filters as someone types does not make it jump. `closeText` names the
 * title's close action, or `null` leaves it out; `busy` keeps it open, as
 * while what it holds is being saved. It stays above an on-screen keyboard.
 */
export function Drawer(props: { title: string; onClose: () => void; full?: boolean; closeText?: string | null; busy?: boolean | undefined; children: ReactNode }) {
  const compact = useCompactLayout();
  const shown = useScrimShown();
  const screen = useScreenSize().height;
  // The part of the screen the keyboard leaves, where the drawer rises from.
  const visible = useVisibleViewportHeight(compact) ?? screen;
  // A number rather than a share, since the rising wrapper has no height of its own to take a share of.
  const drawerHeight = visible * drawerShare;
  const close = () => { if (!props.busy) props.onClose(); };

  const panel = (
    <View
      role="dialog"
      aria-modal
      aria-label={props.title}
      style={[sheet, { maxHeight: compact ? drawerHeight : popupHeight }, !compact && { maxWidth: layout.dialog, paddingBottom: 24 }, props.full && { height: compact ? drawerHeight : popupHeight }]}
    >
      <SheetTitle title={props.title} closeText={props.closeText} disabled={props.busy} onClose={close} />
      {props.children}
    </View>
  );

  return (
    <ScreenModal onRequestClose={close}>
      <View style={[withTransition({ ...overlay(!compact), backgroundColor: shown ? scrim : 'transparent' }, 'background-color', durations.medium), compact && { maxHeight: visible }]}>
        <Pressable accessibilityLabel="Close" style={backdrop} onPress={close} />
        {/* On phones it rises from the foot, as a footer's drawer does. */}
        {compact ? <Reveal upward>{panel}</Reveal> : panel}
      </View>
    </ScreenModal>
  );
}
