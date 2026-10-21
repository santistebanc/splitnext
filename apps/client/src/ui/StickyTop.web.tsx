import type { CSSProperties, ReactNode } from 'react';

/**
 * Keeps its content `top` pixels from the top of the scroll area it belongs
 * to once it scrolls there, while staying part of that scroll area. Given a
 * height, it takes no room in the page. A higher `layer` stays above a lower
 * one. React Native styles have no `sticky`, so this is a plain element.
 * Not `pinned`, it stays in the page's flow, so content can switch between
 * pinned and not without being mounted again.
 */
export function StickyTop(props: { height?: number | undefined; top?: number; layer?: number; pinned?: boolean; children: ReactNode }) {
  // Like a React Native view, a parent's flex layout never shrinks it.
  const style: CSSProperties = { position: props.pinned === false ? 'relative' : 'sticky', top: props.top ?? 0, zIndex: props.layer ?? 2, display: 'flex', flexDirection: 'column', flexShrink: 0 };

  if (props.height !== undefined) {
    style.height = props.height;
    style.marginBottom = -props.height;
  }

  return <div style={style}>{props.children}</div>;
}
