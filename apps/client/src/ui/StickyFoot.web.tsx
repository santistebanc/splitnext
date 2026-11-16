import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createCompactProgress } from './pageScroll';

/**
 * Holds its content `bottom` pixels above the foot of the scroll area while
 * its place in the page is still below the screen, and lets it scroll into
 * that place once it gets there. `children` receives how far it has docked:
 * 0 while held at the foot, 1 at its place. The change plays at once as one
 * short eased movement when it reaches its place, and back when it leaves it
 * by more than `range` pixels, whatever the scroll does meanwhile. The element
 * with `anchorId` marks that place.
 * Its parent must reach the top of the page, so the content can rise to the
 * foot from anywhere below it.
 */
export function StickyFoot(props: { bottom: number; range: number; anchorId: string; held: boolean; children: (docked: number) => ReactNode }) {
  const place = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const progress = useMemo(createCompactProgress, []);
  const docked = useSyncExternalStore(progress.subscribe, progress.get, progress.get);
  // The state it is moving to, set again only when it changes, so the movement is not restarted.
  const target = useRef<0 | 1 | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    const anchor = place.current;
    const scroller = node?.closest('#splitnext-page');

    if (!node || !anchor || !scroller) return;
    let frame: number | null = null;

    // Sticky positioning keeps the motion on the scroll itself; only the
    // content's shape follows here, a frame at most behind.
    const update = (): void => {
      frame = null;
      const lifted = anchor.getBoundingClientRect().top - node.getBoundingClientRect().top;
      // Two states: docked once it reaches its place, floating again only well
      // below it, so a scroll resting near the line does not flip it back and forth.
      const next = !props.held || lifted <= 2 ? 1 : lifted > props.range || target.current === null ? 0 : target.current;

      if (next === target.current) return;
      progress.set(next, target.current === null);
      target.current = next;
    };

    function schedule(): void {
      if (frame === null) frame = requestAnimationFrame(update);
    }

    scroller.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);

    resize.observe(scroller);

    if (node.parentElement) resize.observe(node.parentElement);
    update();

    return () => {
      scroller.removeEventListener('scroll', schedule);
      resize.disconnect();

      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [props.range, props.held, progress]);

  const style: CSSProperties = { position: props.held ? 'sticky' : 'relative', bottom: props.bottom, zIndex: 3, display: 'flex', flexDirection: 'column', flexShrink: 0 };

  return (
    <>
      <div ref={place} id={props.anchorId} style={{ height: 0, flexShrink: 0 }} />
      <div ref={ref} style={style}>{props.children(docked)}</div>
    </>
  );
}
