import { createPortal } from 'react-dom';
import { colors, fontFamily, radius, shadows } from './theme';
import type { ToastProps } from './Toast';

/** A dark message at the foot of the screen, with one action such as Undo, above dialogs. */
export function Toast(props: ToastProps) {
  return props.message ? createPortal(
    <div role="status" aria-live="polite" style={{
      position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 10002,
      width: 'min(528px, calc(100vw - 32px))', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 8px 8px 16px', borderRadius: radius.card, background: colors.night, color: colors.surface,
      boxShadow: shadows.floating, fontFamily: `"${fontFamily}", system-ui, sans-serif`,
    }}>
      <span data-testid="toast" style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}>{props.message}</span>
      {props.action ? <button type="button" onClick={props.action.onPress} style={{
        flex: 'none', height: 44, padding: '0 12px', border: 0, background: 'transparent', cursor: 'pointer',
        color: colors.nightOwed, font: `600 14px "${fontFamily}", system-ui, sans-serif`,
      }}>{props.action.text}</button> : null}
    </div>,
    document.body,
  ) : null;
}
