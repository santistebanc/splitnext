import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * Keeps its content `top` pixels from the top of the scroll area it belongs
 * to once it scrolls there, while staying part of that scroll area. Given a
 * height, it takes no room in the page. A higher `layer` stays above a lower
 * one. React Native styles have no `sticky`, so this is a plain element.
 * Not `pinned`, it stays in the page's flow, so content can switch between
 * pinned and not without being mounted again.
 * `onPinnedChange` reports whether it is covering scrolled content.
 */
export function StickyTop(props: { height?: number | undefined; top?: number; layer?: number; pinned?: boolean; onPinnedChange?: (pinned: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  // Sticky positioning remains CSS's job. Report when this heading actually
  // covers scrolled content, including when the next section pushes it away.
  useLayoutEffect(() => {
    const node = ref.current;
    const scroller = node?.closest('#splitnext-page');
    const report = props.onPinnedChange;

    if (!node || !scroller || !report) return;
    let frame: number | null = null;

    const update = (): void => {
      frame = null;
      const edge = scroller.getBoundingClientRect().top + (props.top ?? 0);
      const box = node.getBoundingClientRect();

      report(props.pinned !== false && scroller.scrollTop > 0 && box.top <= edge + 0.5 && box.bottom > edge);
    };

    function schedule(): void {
      if (frame === null) frame = requestAnimationFrame(update);
    }

    scroller.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);

    resize.observe(scroller);
    resize.observe(node);
    update();

    return () => {
      scroller.removeEventListener('scroll', schedule);
      resize.disconnect();

      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [props.onPinnedChange, props.top, props.pinned]);

  // Like a React Native view, a parent's flex layout never shrinks it.
  const style: CSSProperties = { position: props.pinned === false ? 'relative' : 'sticky', top: props.top ?? 0, zIndex: props.layer ?? 2, display: 'flex', flexDirection: 'column', flexShrink: 0 };

  if (props.height !== undefined) {
    style.height = props.height;
    style.marginBottom = -props.height;
  }

  return <div ref={ref} style={style}>{props.children}</div>;
}
