import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SheetOverlayProps } from './SheetOverlay';

const fadeMs = 200;

const focusable =
  'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

function firstControl(layer: HTMLElement): HTMLElement | null {
  const sheet = layer.querySelector('[aria-modal="true"]') ?? layer;

  return sheet.querySelector<HTMLElement>(focusable);
}

/**
 * The web layer sheets open in, just below devtools. React Native Web's Modal
 * refocuses its opener when it unmounts after fading out, taking focus from
 * whatever the person chose meanwhile. This layer keeps focus inside the
 * sheet while open, returns it to the opener when closing would otherwise lose
 * it, and fades out without touching focus. Escape and Tab are handled by
 * useSheetKeyboard.
 */
export function SheetOverlay(props: SheetOverlayProps) {
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!props.visible) return;

    const element = document.createElement('div');

    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    Object.assign(element.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '9999',
      display: 'flex',
      flexDirection: 'column',
      opacity: '0',
      transition: `opacity ${fadeMs}ms ease`,
    });
    document.body.appendChild(element);
    setLayer(element);

    const frame = requestAnimationFrame(() => {
      element.style.opacity = '1';
      firstControl(element)?.focus();
    });

    // Focus stays in the open sheet; the devtools layer stops its own events first.
    const keepFocus = () => {
      if (!element.contains(document.activeElement)) firstControl(element)?.focus();
    };

    document.addEventListener('focus', keepFocus, true);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focus', keepFocus, true);

      // Closing removes the sheet's content first, so focus may already be lost.
      const active = document.activeElement;
      const lost = !active || active === document.body || element.contains(active);

      if (lost && opener.current?.isConnected) opener.current.focus();

      element.style.opacity = '0';
      element.style.pointerEvents = 'none';
      setTimeout(() => {
        element.remove();
        setLayer((current) => (current === element ? null : current));
      }, fadeMs);
    };
  }, [props.visible]);

  return layer ? createPortal(props.children, layer) : null;
}
