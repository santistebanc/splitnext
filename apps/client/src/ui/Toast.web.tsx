import { createPortal } from 'react-dom';
import { colors, fonts, sizes, typeScale } from '../design';
import { useScreenHost } from './screenHost';
import type { ToastProps } from './Toast';

const font = `"${fonts.body}", system-ui, sans-serif`;

/** A dark message at the foot of the screen, with one action such as Undo, above dialogs. */
export function Toast(props: ToastProps) {
  const host = useScreenHost();

  return props.message ? createPortal(
    <div role="status" aria-live="polite" style={{
      position: host ? 'absolute' : 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 10002, pointerEvents: 'auto',
      width: host ? 'calc(100% - 32px)' : 'min(528px, calc(100vw - 32px))', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 8px 8px 16px', background: colors.ink, color: colors.background, fontFamily: font,
    }}>
      <span data-testid="toast" style={{ flex: 1, fontSize: typeScale.caption.fontSize, lineHeight: 1.4 }}>{props.message}</span>
      {props.action ? <button type="button" onClick={props.action.onPress} style={{
        flex: 'none', height: sizes.touch, padding: '0 12px', border: 0, background: 'transparent', cursor: 'pointer',
        color: colors.positive, font: `600 ${typeScale.caption.fontSize}px ${font}`,
      }}>{props.action.text}</button> : null}
    </div>,
    host?.overlay ?? document.body,
  ) : null;
}
