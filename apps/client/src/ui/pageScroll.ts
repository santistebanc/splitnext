import { createContext, useContext, useSyncExternalStore } from 'react';
import { between } from '../design/tokens';

export { between };

/**
 * A number read only by the parts that follow it, such as the page's scroll
 * position, so the page does not re-render each time it changes.
 */
export function createValueStore() {
  let current = 0;
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    set: (next: number) => {
      if (next === current) return;
      current = next;

      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type ValueStore = ReturnType<typeof createValueStore>;

/** How long the header takes to change between full and compact. */
const switchDuration = 240;

/**
 * How far a screen's fixed top has shrunk: 0 full, 1 compact. The top has
 * only these two states; a change between them plays at once as one short
 * eased movement, whatever the scroll does meanwhile, and a change that
 * arrives during one reverses it from where it is.
 */
export function createCompactProgress() {
  const store = createValueStore();
  let frame: number | null = null;

  return {
    get: store.get,
    subscribe: store.subscribe,
    /** Moves to full (0) or compact (1); `instant` takes it there without motion. */
    set(target: 0 | 1, instant: boolean): void {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const from = store.get();

      if (instant || from === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        store.set(target);

        return;
      }

      let start: number | null = null;

      const step = (time: number) => {
        start ??= time;
        const done = Math.min(1, (time - start) / switchDuration);

        // Eased in and out, so parts that travel across the header never leap on its first frame.
        const eased = done < 0.5 ? 4 * done ** 3 : 1 - (-2 * done + 2) ** 3 / 2;

        store.set(from + (target - from) * eased);
        frame = done < 1 ? requestAnimationFrame(step) : null;
      };

      frame = requestAnimationFrame(step);
    },
  };
}

/** The current screen's compact progress; outside a screen its top stays full size. */
export const CompactProgressContext = createContext<Pick<ValueStore, 'get' | 'subscribe'>>(createValueStore());

/** How far the screen's fixed top has shrunk: 0 at full size, 1 when compact. */
export function useCompactProgress(): number {
  const progress = useContext(CompactProgressContext);

  return useSyncExternalStore(progress.subscribe, progress.get, progress.get);
}

/** Receives how much a screen header gives up when compact, as soon as it is measured. */
export const HeaderShrinkContext = createContext<((shrink: number) => void) | null>(null);

/** Scrolls the page element with this id up to just under the compact header. */
export const RevealContext = createContext<((id: string) => void) | null>(null);

/** Return the current frame to its start from its title. */
export const ScrollToTopContext = createContext<(() => void) | null>(null);

/** Space available to page content with the full header, before footer clearance. */
export const PageHeightContext = createContext(0);
