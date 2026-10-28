import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditCoverProps } from './EditCover';

/** The same shade as the drawers' backdrop. */
const scrim = 'rgba(20, 20, 19, 0.32)';

/** Room left uncovered around the field. */
const pad = 6;

type Box = { top: number; left: number; right: number; bottom: number };

/**
 * While a name is edited in place, everything but its field dims as behind a
 * drawer, and a tap on the dimmed part ends the edit without reaching what
 * is under it. The cover follows the field as the page moves, and fades in
 * and out like the drawers' backdrop.
 */
export function EditCover(props: EditCoverProps) {
  const [box, setBox] = useState<Box | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setShown(false);
      const timer = setTimeout(() => setBox(null), 260);

      return () => clearTimeout(timer);
    }

    let frame = 0;

    const follow = () => {
      const target = props.target.current;

      if (target instanceof Element) {
        const rect = target.getBoundingClientRect();

        setBox((last) => last && last.top === rect.top && last.left === rect.left && last.right === rect.right && last.bottom === rect.bottom
          ? last
          : { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom });
      }

      frame = requestAnimationFrame(follow);
    };

    follow();
    // Shown a frame after it is laid out, so it fades in rather than appearing.
    const reveal = requestAnimationFrame(() => setShown(true));

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(reveal);
    };
  }, [props.open, props.target]);

  if (!box) return null;

  const top = box.top - pad;
  const bottom = box.bottom + pad;

  const parts = [
    { top: 0, left: 0, right: 0, height: Math.max(0, top) },
    { top: bottom, left: 0, right: 0, bottom: 0 },
    { top, height: bottom - top, left: 0, width: Math.max(0, box.left - pad) },
    { top, height: bottom - top, left: box.right + pad, right: 0 },
  ];

  return createPortal(
    <div data-testid="edit-cover" aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'none', opacity: shown ? 1 : 0, transition: `opacity ${shown ? 340 : 260}ms` }}>
      {parts.map((part, index) => (
        <div
          key={index}
          onClick={props.open ? props.onPress : undefined}
          style={{ position: 'absolute', background: scrim, pointerEvents: props.open ? 'auto' : 'none', ...part }}
        />
      ))}
    </div>,
    document.body,
  );
}
