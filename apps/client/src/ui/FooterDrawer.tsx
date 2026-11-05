import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Row, Text, TextButton, durations, scrim, withTransition } from '../design';
import { Reveal } from './Reveal';

export type FooterDrawerProps = {
  open: boolean;
  title: string;
  /** Names the close control for assistive technology, as in "Back to groups". */
  closeLabel: string;
  closeText?: string;
  /** Keeps it open, as while what it holds is being saved. */
  busy?: boolean;
  onClose: () => void;
  /** What the drawer holds, above the footer. */
  children: ReactNode;
  /** The footer's main button, which opens the drawer and then acts for it. */
  footer: ReactNode;
};

/**
 * A drawer rising from the footer's main button, as New group does: while it
 * is open the screen above dims, and a tap on it or the close control closes
 * it. The button stays below it.
 */
export function FooterDrawer(props: FooterDrawerProps) {
  return (
    // The footer's own top padding belongs to the drawer.
    <View style={{ gap: 12, marginTop: -12, paddingTop: 12, zIndex: 10 }}>
      <Pressable
        accessibilityLabel={`Close ${props.title}`}
        aria-hidden={!props.open}
        tabIndex={-1}
        disabled={!props.open || props.busy}
        onPress={props.onClose}
        style={withTransition({ position: 'absolute', bottom: '100%', top: -4000, left: -4000, right: -4000, backgroundColor: scrim, opacity: props.open ? 1 : 0, pointerEvents: props.open ? 'auto' : 'none' }, 'opacity', props.open ? durations.medium : durations.medium)}
      />
      <Reveal upward>
        {props.open ? (
          <View role="region" aria-label={props.title} style={{ paddingBottom: 8 }}>
            <Row justify="between">
              <Text accessibilityRole="header" variant="heading">{props.title}</Text>
              <TextButton label={props.closeLabel} tone="muted" underline={false} disabled={props.busy} onPress={props.onClose} style={{ paddingLeft: 16 }}>
                {props.closeText ?? 'Cancel'}
              </TextButton>
            </Row>
            {props.children}
          </View>
        ) : null}
      </Reveal>
      {props.footer}
    </View>
  );
}
