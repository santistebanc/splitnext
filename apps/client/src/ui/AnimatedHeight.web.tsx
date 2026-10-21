import { useState, type CSSProperties, type ReactNode } from 'react';

/** How long a height change takes: short, with an ease-out, so it reads as one movement. */
export const heightDuration = 220;

/** Heights change at once when people ask for less motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  return reduced;
}

/** Shows its content up to a height, clipping the rest; with `animate`, changes to the height animate. */
export function AnimatedHeight(props: { height: number | undefined; animate?: boolean; children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  // Behaves like a React Native view: absolutely placed content stays inside and is clipped with it, and a parent's flex layout never shrinks it.
  const style: CSSProperties = { position: 'relative', display: 'flex', flexDirection: 'column', flexShrink: 0 };

  if (props.height !== undefined) {
    style.height = props.height;
    style.overflow = 'hidden';

    if (props.animate && !reduced) style.transition = `height ${heightDuration}ms cubic-bezier(0.2, 0, 0, 1)`;
  }

  return <div style={style}>{props.children}</div>;
}
