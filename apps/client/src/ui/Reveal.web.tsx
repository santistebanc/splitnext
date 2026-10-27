import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { easeOut } from './theme';

/**
 * Content that opens in place, such as the invite link or the join field: it
 * grows from nothing and settles down into place, and on closing shrinks away
 * before it leaves. Without content it takes no room.
 */
export function Reveal(props: { children: ReactNode }) {
  const present = props.children !== null && props.children !== undefined && props.children !== false;
  const element = useRef<HTMLDivElement>(null);
  const last = useRef<ReactNode>(null);
  const shown = useRef(present);
  const [closing, setClosing] = useState(false);

  if (present) last.current = props.children;

  useLayoutEffect(() => {
    const node = element.current;
    const was = shown.current;

    shown.current = present;

    if (!node || was === present) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (!present) last.current = null;

      return;
    }

    const height = `${node.offsetHeight}px`;
    const open = { height, opacity: 1, transform: 'none' };
    const shut = { height: '0px', opacity: 0, transform: 'translateY(-8px)' };

    if (present) {
      node.animate([shut, open], { duration: 340, easing: easeOut });

      return;
    }

    setClosing(true);
    const animation = node.animate([open, shut], { duration: 260, easing: easeOut, fill: 'forwards' });

    animation.onfinish = () => {
      last.current = null;
      setClosing(false);
      animation.cancel();
    };
  }, [present]);

  const content = present || shown.current || closing ? last.current : null;

  return (
    <div ref={element} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
      {content}
    </div>
  );
}
