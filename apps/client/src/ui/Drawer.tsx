import { useEffect, useRef, useState, type ReactNode } from 'react';
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

/**
 * Whether a dialog is on the page and whether it is up. It goes up a frame
 * after it arrives, so it can rise, and stays on the page while it falls
 * away after closing.
 */
function useRaised(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [raised, setRaised] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setRaised(true));

      return () => cancelAnimationFrame(frame);
    }

    setRaised(false);
    const timer = setTimeout(() => setMounted(false), durations.medium + 40);

    return () => clearTimeout(timer);
  }, [open]);

  return { mounted, raised };
}

/**
 * A dialog over the screen: a drawer rising from the bottom on phones, a popup
 * in the middle of wider screens. Tapping outside it, Escape, or its close
 * button dismisses it. Content too tall for it scrolls in a child with
 * `flexShrink: 1`. A `full` drawer keeps its whole height, so a list that
 * filters as someone types does not make it jump. `closeText` names the
 * title's close action, or `null` leaves it out; `busy` keeps it open, as
 * while what it holds is being saved. It stays above an on-screen keyboard.
 * Keep it rendered and set `open`, so it rises on opening and falls away on
 * closing, as New group's drawer does; it holds what it showed until it has gone.
 */
export function Drawer(props: { open?: boolean | undefined; title: string; onClose: () => void; full?: boolean; closeText?: string | null; busy?: boolean | undefined; children: ReactNode }) {
  const open = props.open ?? true;
  const compact = useCompactLayout();
  const { mounted, raised: shown } = useRaised(open);
  const held = useRef<ReactNode>(null);
  const screen = useScreenSize().height;
  // The part of the screen the keyboard leaves, where the drawer rises from.
  const visible = useVisibleViewportHeight(compact) ?? screen;
  // A number rather than a share, since the rising wrapper has no height of its own to take a share of.
  const drawerHeight = visible * drawerShare;
  const close = () => { if (!props.busy && open) props.onClose(); };

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

  if (open) held.current = panel;

  if (!mounted) return null;

  return (
    <ScreenModal onRequestClose={close}>
      {/* While it falls away, taps already reach the screen below. */}
      <View pointerEvents={open ? 'auto' : 'none'} style={[withTransition({ ...overlay(!compact), backgroundColor: shown ? scrim : 'transparent' }, 'background-color', durations.medium), compact && { maxHeight: visible }]}>
        <Pressable accessibilityLabel="Close" style={backdrop} onPress={close} />
        {/* On phones it rises from the foot and falls back, as New group's drawer does; on wide screens it fades. */}
        {compact
          ? <Reveal upward>{shown ? held.current : null}</Reveal>
          : <View style={[{ width: '100%', alignItems: 'center' }, withTransition({ opacity: shown ? 1 : 0, transform: [{ translateY: shown ? 0 : 8 }] }, 'opacity, transform', durations.medium)]}>{held.current}</View>}
      </View>
    </ScreenModal>
  );
}
