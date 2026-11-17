import { createPortal } from 'react-dom';
import { ToastContent, layout, type ToastProps } from '../design';
import { useScreenHost } from './screenHost';

/** Keep toast placement in the host; content uses the shared design system. */
export function Toast(props: ToastProps) {
  const host = useScreenHost();

  return props.message ? createPortal(
    <div style={{
      position: host ? 'absolute' : 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 10002, pointerEvents: 'auto',
      width: `calc(100% - ${layout.gutter * 2}px)`, maxWidth: layout.column,
    }}>
      <ToastContent {...props} />
    </div>,
    host?.overlay ?? document.body,
  ) : null;
}
