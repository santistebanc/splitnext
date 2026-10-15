import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const focusable =
  'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

/**
 * Escape closes an open sheet, and Tab cycles within it instead of reaching
 * the page behind. React Native Web's Modal does neither on its own.
 */
export function useSheetKeyboard(open: boolean, close: () => void): void {
  const latestClose = useRef(close);

  useEffect(() => {
    latestClose.current = close;
  });

  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;

    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-splitnext-devtools]')
      )
        return;

      if (event.key === 'Escape') {
        event.preventDefault();
        latestClose.current();

        return;
      }

      if (event.key !== 'Tab') return;

      const sheet = document.querySelector('[aria-modal="true"]');

      if (!sheet) return;

      const targets = [
        ...sheet.querySelectorAll<HTMLElement>(focusable),
      ].filter(
        (target) =>
          !target.hasAttribute('disabled') &&
          target.getAttribute('aria-disabled') !== 'true',
      );

      const first = targets[0];
      const last = targets.at(-1);
      const active = document.activeElement;

      if (!first || !last) return;

      if (!sheet.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', keydown);

    return () => document.removeEventListener('keydown', keydown);
  }, [open]);
}
