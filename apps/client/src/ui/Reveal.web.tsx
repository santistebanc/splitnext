import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import type { RevealProps } from './Reveal';
import { useScreenHost } from './screenHost';
import { durations, easeOut } from '../design';

type Frame = { height: string; opacity: string | number; transform: string };

/**
 * Content that opens in place, such as the invite link or the join field: it
 * grows from nothing and settles down into place, and on closing shrinks away
 * before it leaves. Without content it takes no room. With `onOutsidePress`,
 * a tap anywhere else closes it, and still reaches what was tapped.
 */
export function Reveal(props: RevealProps) {
  const present = props.children !== null && props.children !== undefined && props.children !== false;
  const element = useRef<HTMLDivElement>(null);
  const last = useRef<ReactNode>(null);
  const shown = useRef(present);
  const running = useRef<Animation | null>(null);
  const [closing, setClosing] = useState(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const dismiss = useRef(props.onOutsidePress);
  const host = useScreenHost();

  dismiss.current = props.onOutsidePress;

  if (present) last.current = props.children;

  // A finished tap, not a touch, so scrolling is not an outside tap.
  // Taps on the content, or on the control that toggles it, are its own.
  useEffect(() => {
    if (!present || !props.onOutsidePress) return;

    const toggle = props.toggle;

    function outside(event: Event): void {
      const target = event.target;

      if (!(target instanceof Node) || !target.isConnected) return;

      const control: unknown = toggle?.current;

      if (element.current?.contains(target) || (control instanceof Node && control.contains(target))) return;
      dismiss.current?.();
    }

    // A hosted screen answers taps in its own box, not those on other devices.
    const scope = host?.frame ?? document;

    scope.addEventListener('click', outside, true);

    return () => scope.removeEventListener('click', outside, true);
  }, [present, Boolean(props.onOutsidePress), props.toggle, host]);

  useLayoutEffect(() => {
    const node = element.current;
    const was = shown.current;

    shown.current = present;

    if (!node || was === present) return;

    // Changing course mid-way starts from where the last movement got to,
    // and the movement it replaces must not finish closing afterwards.
    const style = getComputedStyle(node);
    const current: Frame | null = running.current ? { height: style.height, opacity: style.opacity, transform: style.transform } : null;

    running.current?.cancel();
    running.current = null;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // This render still showed the closed content; render again without it.
      if (!present) {
        last.current = null;
        setClosing(false);
        rerender();
      }

      return;
    }

    const height = `${node.offsetHeight}px`;
    const open: Frame = { height, opacity: 1, transform: 'none' };
    const shut: Frame = { height: '0px', opacity: 0, transform: `translateY(${props.upward ? 8 : -8}px)` };

    if (present) {
      setClosing(false);
      const animation = node.animate([current ?? shut, open], { duration: durations.medium, easing: easeOut });

      running.current = animation;
      animation.onfinish = () => { running.current = null; };

      return;
    }

    setClosing(true);
    const animation = node.animate([current ?? open, shut], { duration: durations.medium, easing: easeOut, fill: 'forwards' });

    running.current = animation;
    // The last frame holds until the content has gone; letting go first would
    // show the content at full size for a frame.
    animation.onfinish = () => {
      last.current = null;
      setClosing(false);
    };
  }, [present]);

  // Once closed content has left the page, let go of the held last frame,
  // before the browser paints.
  useLayoutEffect(() => {
    if (present || closing || running.current?.playState !== 'finished') return;
    running.current.cancel();
    running.current = null;
  });

  const content = present || shown.current || closing ? last.current : null;

  return (
    <div ref={element} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
      {content}
    </div>
  );
}
