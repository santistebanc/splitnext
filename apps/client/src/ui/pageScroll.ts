import { createContext, useContext, useSyncExternalStore } from 'react';

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

/** Content travel, including the header's own collapse. Larger than its shrink
 * so expanding back to the top converges rather than amplifying layout changes. */
const shrinkDistance = 72;

/** The largest change followed at once: a finger or trackpad moves the page in steps this small. */
const followedStep = 0.15;

/** How quickly an eased change closes its distance, in milliseconds per e-fold. */
const easing = 60;

/**
 * How far a screen's fixed top has shrunk, following the page's scroll: 0 at
 * the top of the page, 1 once scrolled past the shrink. Small scrolls move it
 * directly; a jump, such as a wheel step or a position restored on returning
 * to a screen, eases there instead of resizing the top at once.
 */
export function createCompactProgress() {
  const store = createValueStore();
  let target = 0;
  let frame: number | null = null;
  let last: number | null = null;

  function step(time: number): void {
    const elapsed = last === null ? 16 : time - last;
    const current = store.get();
    const next = current + (target - current) * (1 - Math.exp(-elapsed / easing));

    last = time;

    if (Math.abs(target - next) < 0.005) {
      store.set(target);
      frame = null;

      return;
    }

    store.set(next);
    frame = requestAnimationFrame(step);
  }

  return {
    get: store.get,
    subscribe: store.subscribe,
    /** Moves toward the shrink for this scroll position. */
    follow(scrolled: number): void {
      target = Math.min(1, Math.max(0, scrolled / shrinkDistance));

      if (frame !== null) return;

      if (Math.abs(target - store.get()) <= followedStep || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        store.set(target);

        return;
      }

      last = null;
      frame = requestAnimationFrame(step);
    },
  };
}

/** The current screen's compact progress; outside a screen its top stays full size. */
export const CompactProgressContext = createContext<Pick<ValueStore, 'get' | 'subscribe'>>(createValueStore());

/** A size between its full and compact values, unrounded so it changes smoothly. */
export function between(full: number, compact: number, progress: number): number {
  return full + (compact - full) * progress;
}

/** How far the screen's fixed top has shrunk: 0 at full size, 1 when compact. */
export function useCompactProgress(): number {
  const progress = useContext(CompactProgressContext);

  return useSyncExternalStore(progress.subscribe, progress.get, progress.get);
}
