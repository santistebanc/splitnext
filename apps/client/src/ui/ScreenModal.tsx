import { useEffect, useRef, type ReactNode } from 'react';
import { Modal } from 'react-native';
import { createPortal } from 'react-dom';
import { useScreenHost } from './screenHost';

/**
 * A dialog layer over the screen. The window shows it in a native modal; a
 * hosted screen shows it in its own box, which a native modal would cover
 * with the whole document.
 */
export function ScreenModal(props: { onRequestClose: () => void; children: ReactNode }) {
  const host = useScreenHost();
  const layer = useRef<HTMLDivElement>(null);
  const close = useRef(props.onRequestClose);

  close.current = props.onRequestClose;

  // The keyboard stays inside the dialog and Escape closes it, as a modal does.
  useEffect(() => {
    const node = layer.current;

    if (!host || !node) return;
    const returnTo = document.activeElement;

    node.focus();

    return () => {
      if (returnTo instanceof HTMLElement && host.frame.contains(returnTo)) returnTo.focus();
    };
  }, [host]);

  if (!host)
    return (
      <Modal transparent animationType="fade" visible onRequestClose={props.onRequestClose}>
        {props.children}
      </Modal>
    );

  return createPortal(
    <div
      ref={layer}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close.current();
        else if (event.key === 'Tab') trapTab(event, event.currentTarget);
      }}
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}
    >
      {props.children}
    </div>,
    host.overlay,
  );
}

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTab(event: React.KeyboardEvent, layer: HTMLElement): void {
  const items = Array.from(layer.querySelectorAll<HTMLElement>(focusable));
  const first = items[0];
  const last = items[items.length - 1];

  if (!first || !last) {
    event.preventDefault();

    return;
  }

  if (event.shiftKey && (document.activeElement === first || document.activeElement === layer)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
