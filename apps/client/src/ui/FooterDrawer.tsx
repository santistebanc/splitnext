import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Reveal } from './Reveal';
import { colors, s } from './components';
import { withTransition } from './theme';

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
    <View style={{ gap: 10, marginTop: -10, paddingTop: 10, zIndex: 10 }}>
      <Pressable
        accessibilityLabel={`Close ${props.title}`}
        aria-hidden={!props.open}
        tabIndex={-1}
        disabled={!props.open || props.busy}
        onPress={props.onClose}
        style={withTransition({ position: 'absolute', bottom: '100%', top: -4000, left: -4000, right: -4000, backgroundColor: 'rgba(20, 20, 19, 0.32)', opacity: props.open ? 1 : 0, pointerEvents: props.open ? 'auto' : 'none' }, 'opacity', props.open ? 340 : 260)}
      />
      <Reveal upward>
        {props.open ? (
          <View role="region" aria-label={props.title} style={{ paddingBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text accessibilityRole="header" style={[s.headerActionText, { fontSize: 17, fontWeight: '700' }]}>{props.title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={props.closeLabel}
                disabled={props.busy}
                onPress={props.onClose}
                style={({ pressed }) => [{ height: 44, justifyContent: 'center', paddingLeft: 16 }, pressed && s.pressed]}
              >
                <Text style={[s.headerActionText, { color: colors.muted }]}>{props.closeText ?? 'Cancel'}</Text>
              </Pressable>
            </View>
            {props.children}
          </View>
        ) : null}
      </Reveal>
      {props.footer}
    </View>
  );
}
