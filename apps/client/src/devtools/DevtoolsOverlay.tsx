import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type OverlayProps = { children: ReactNode; close: () => void };

/** A viewport layer above React Native Web's separately portalled modals. */
export function DevtoolsOverlay(props: OverlayProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const layer = document.createElement('div');
    layer.dataset.splitnextDevtools = '';
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '10000',
      pointerEvents: 'none',
    });

    // Modal's document-level focus trap must let this developer layer receive
    // focus. React input handlers use focusin and continue to run normally.
    const allowFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && layer.contains(event.target))
        event.stopPropagation();
    };

    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
    };

    const keyup = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      props.close();
    };

    document.body.appendChild(layer);
    window.addEventListener('focus', allowFocus, true);
    layer.addEventListener('keydown', keydown);
    layer.addEventListener('keyup', keyup);
    setContainer(layer);

    return () => {
      window.removeEventListener('focus', allowFocus, true);
      layer.removeEventListener('keydown', keydown);
      layer.removeEventListener('keyup', keyup);
      layer.remove();
    };
  }, [props.close]);

  return container ? createPortal(props.children, container) : null;
}
