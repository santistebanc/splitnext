import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScreenHost } from './screenHost';
import { useInPlaceEdit } from './inPlaceEdit';
import type { EditCoverProps } from './EditCover';

/** Room left uncovered around the field. */
const pad = 6;

type Box = { top: number; left: number; right: number; bottom: number };

/**
 * While a field is edited in place, a clear cover lies over everything but
 * the field: a tap there ends the edit without reaching what is under it.
 * Nothing dims, and the screen's pinned main action steps aside, so the
 * keyboard and the field are all that is in play. The cover follows the
 * field as the page moves.
 */
export function EditCover(props: EditCoverProps) {
  const host = useScreenHost();
  const [box, setBox] = useState<Box | null>(null);

  useInPlaceEdit(props.open);

  useEffect(() => {
    if (!props.open) {
      setBox(null);

      return;
    }

    let frame = 0;

    const follow = () => {
      const target = props.target.current;

      if (target instanceof Element) {
        const rect = target.getBoundingClientRect();
        // A hosted cover fills its device's box, so the field is placed within it.
        const origin = host?.frame.getBoundingClientRect();
        const next = { top: rect.top - (origin?.top ?? 0), left: rect.left - (origin?.left ?? 0), right: rect.right - (origin?.left ?? 0), bottom: rect.bottom - (origin?.top ?? 0) };

        setBox((last) => last && last.top === next.top && last.left === next.left && last.right === next.right && last.bottom === next.bottom ? last : next);
      }

      frame = requestAnimationFrame(follow);
    };

    follow();

    return () => cancelAnimationFrame(frame);
  }, [props.open, props.target, host]);

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
    <div data-testid="edit-cover" aria-hidden style={{ position: host ? 'absolute' : 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'none' }}>
      {parts.map((part, index) => (
        <div
          key={index}
          onClick={props.open ? props.onPress : undefined}
          style={{ position: 'absolute', pointerEvents: props.open ? 'auto' : 'none', ...part }}
        />
      ))}
    </div>,
    host?.overlay ?? document.body,
  );
}
