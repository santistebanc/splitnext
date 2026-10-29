import { useEffect, useLayoutEffect, useState } from 'react';
import { useScreenHost, useScreenSize } from './screenHost';

/**
 * Phone-width layouts. The server cannot measure the window, so server markup
 * and the hydrating render both use the compact layout before measuring.
 */
export function useCompactLayout(): boolean {
  const width = useScreenSize().width;
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => setMeasured(true), []);

  return !measured || width < 600;
}

/** Touch layouts use pages for editing, including phones in landscape. */
export function useTouchInput(): boolean {
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setTouch(query.matches);

    update();
    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  }, []);

  return touch;
}

/** Keep the page's scroll area reaching the visible bottom above the keyboard. */
export function useVisibleViewportHeight(enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  // A hosted screen has no keyboard of its own: the window's belongs to none of its devices.
  const hosted = useScreenHost() !== null;

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!enabled || hosted || !viewport) return;

    let frame: number | null = null;

    const revealInput = () => {
      if (frame !== null) cancelAnimationFrame(frame);

      const input = document.activeElement;

      if (!(input instanceof HTMLElement) ||
        !input.matches('input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])') ||
        viewport.scale !== 1) return;

      // Header/footer fields are already pinned above the keyboard. Revealing
      // one while its sheet slides in would pan the whole screen, including
      // its frozen underlay. Only the page's own content should scroll.
      const page = input.closest<HTMLElement>('#splitnext-page');

      if (!page) return;

      frame = requestAnimationFrame(() => {
        if (document.activeElement !== input) return;
        const field = input.getBoundingClientRect();
        const area = page.getBoundingClientRect();

        if (field.top < area.top) page.scrollTop += field.top - area.top;
        else if (field.bottom > area.bottom) page.scrollTop += field.bottom - area.bottom;
      });
    };

    const resize = () => {
      // Let the browser handle pinch zoom without changing the page layout.
      // The browser may also pan down to a focused field. The page starts at
      // the layout viewport's top, so height alone leaves a gap after that pan.
      setHeight(
        viewport.scale === 1 ? viewport.offsetTop + viewport.height : null,
      );
      revealInput();
    };

    resize();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    document.addEventListener('focusin', revealInput);

    return () => {
      viewport.removeEventListener('resize', resize);
      viewport.removeEventListener('scroll', resize);
      document.removeEventListener('focusin', revealInput);

      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, hosted]);

  return enabled && !hosted ? height : null;
}
