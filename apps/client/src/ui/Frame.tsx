import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Row, Tag, Text, colors, layout, sizes } from '../design';
import { PageHeightContext, ScrollToTopContext, settledScroll, shrinkRoom } from './pageScroll';
import { useHomepage } from './screenHost';
import {
  useCompactLayout,
  useTouchInput,
  useVisibleViewportHeight,
} from './useVisibleViewport';

// Header reflow must not anchor the scroll position and feed back into its
// compact progress, especially when the split list just reaches the bottom.
const page = { flex: 1, backgroundColor: colors.background } as const;

const scrollStyle = Platform.OS === 'web' ? { ...page, overflowAnchor: 'none' } : page;

/** App screens are one narrow column, like the phone app, on every device. */
const column = { width: '100%', maxWidth: layout.column, alignSelf: 'center', paddingHorizontal: layout.gutter } as const;

/** Read the departing screen before React changes its content and clamps its
 * scroll offset. A scroll event can still be waiting for the next frame. */
class ScrollPositionSnapshot extends Component<{ scrollKey: string; save: () => void; children: ReactNode }> {
  getSnapshotBeforeUpdate(previous: Readonly<typeof this.props>): null {
    if (previous.scrollKey !== this.props.scrollKey) previous.save();

    return null;
  }

  componentDidUpdate(): void {
    // The snapshot saves before mutation; there is no post-update work.
  }

  render(): ReactNode { return this.props.children; }
}

type FrameProps = {
  children: ReactNode;
  /** The screen whose position is saved when leaving it. */
  scrollKey?: string;
  /** Returning to a shallower screen restores its saved position. */
  navigationDepth?: number;
  /** Browser Back/Forward restores position in either direction. */
  restoreScroll?: boolean;
  /** A fixed screen header above the scrolling content. */
  header?: ReactNode;
  /** App-wide connection status, fixed above every screen's header. */
  status?: ReactNode;
  onStatusLayout?: ((height: number) => void) | undefined;
  /** The screen's one main action, pinned below the content. */
  footer?: ReactNode;
  /** Whether the footer floats over the content instead of taking its own bar. */
  floatingFooter?: boolean;
  /** Content offset and the space released by its header. Collapse follows their
   * sum, which stays fixed when header reflow clamps the scroll position.
   * `restored` marks the position a screen opens at rather than a scroll. */
  onScroll?: ((y: number, headerCollapse: number, restored?: boolean) => void) | undefined;
  /** A downward content scroll, excluding restoration and header layout. */
  onScrollDown?: (() => void) | undefined;
  /** Receives a way to scroll the content, smoothly unless told not to, such as back to the top. */
  scrollControl?: { current: ((y: number, animated?: boolean) => void) | null } | undefined;
};

/**
 * The screen shell: a fixed header, scrolling content, and the main action,
 * in one narrow column like a phone screen on every device.
 */
export function Frame(props: FrameProps) {
  // The page's height and the space its header has released are kept apart,
  // since either can lay out first; the page with its full header is their difference.
  const [pageArea, setPageArea] = useState(0);
  const [released, setReleased] = useState(0);
  const pageHeight = pageArea && pageArea - released;
  const mobile = useCompactLayout();
  const touch = useTouchInput();
  const scroll = useRef<ScrollView>(null);
  const control = props.scrollControl;

  useEffect(() => {
    if (!control) return;
    control.current = (y, animated = true) => scroll.current?.scrollTo({ y, animated });

    return () => {
      control.current = null;
    };
  }, [control]);
  const positions = useRef(new Map<string, number>());
  const headers = useRef(new Map<string, { full: number; current: number }>());
  const scrollKey = props.scrollKey ?? 'page';
  const depth = props.navigationDepth ?? 0;
  const previousDepth = useRef(depth);
  const headerSize = useRef({ key: scrollKey, full: 0, current: 0 });
  const scrolled = useRef(0);
  const homepage = useHomepage();
  const floating = Boolean(props.footer && props.floatingFooter);

  // Scrolls caused by switching screens, including late ones from the screen
  // left behind, are neither a person scrolling nor this screen's position.
  const restoring = useRef(false);

  // Only a change of screen applies this policy; in-place panels and edits
  // keep their position even if they update browser history.
  useLayoutEffect(() => {
    const returning = props.restoreScroll || depth < previousDepth.current;
    const restored = returning ? positions.current.get(scrollKey) ?? 0 : 0;
    const header = returning ? headers.current.get(scrollKey) : undefined;

    previousDepth.current = depth;
    positions.current.set(scrollKey, restored);
    restoring.current = true;
    scrolled.current = restored;

    // Content travel includes the space released by this screen's header.
    // Restoring just scrollTop expands a previously compact header on return.
    if (header) headerSize.current = { key: scrollKey, ...header };
    else headers.current.delete(scrollKey);
    scroll.current?.scrollTo({ y: restored, animated: false });
    props.onScroll?.(restored, restored > 0 && header ? header.full - header.current : 0, true);
    setReleased(restored > 0 && header ? header.full - header.current : 0);

    const frame = requestAnimationFrame(() => {
      restoring.current = false;
    });

    return () => cancelAnimationFrame(frame);
  }, [scrollKey]);

  // A page let go partway through its header's shrink glides on to an end, as
  // a scroll the person could have made, once the finger lifts and any fling
  // or wheel movement stops.
  const hasHeader = Boolean(props.header);

  useEffect(() => {
    const node: unknown = Platform.OS === 'web' ? scroll.current?.getScrollableNode() : null;

    if (!hasHeader || !(node instanceof HTMLElement)) return;
    let holding = false;
    let down = true;
    let last = node.scrollTop;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = () => {
      timer = undefined;

      if (holding || restoring.current) return;
      const y = node.scrollTop;
      const header = headerSize.current;
      const target = settledScroll(y, y > 0 ? header.full - header.current : 0, down);

      if (target === null) return;
      const top = Math.min(target, node.scrollHeight - node.clientHeight);

      if (Math.abs(top - y) < 1) return;
      // The ScrollView's own call: its node's scrollTo takes React Native's `{ y }`.
      scroll.current?.scrollTo({ y: top, animated: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    };

    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, 140);
    };

    const moved = () => {
      const y = node.scrollTop;

      if (y !== last) down = y > last;
      last = y;
      later();
    };

    const press = () => {
      holding = true;
      clearTimeout(timer);
    };

    const release = () => {
      holding = false;
      later();
    };

    node.addEventListener('scroll', moved, { passive: true });
    node.addEventListener('touchstart', press, { passive: true });
    node.addEventListener('touchend', release, { passive: true });
    node.addEventListener('touchcancel', release, { passive: true });

    return () => {
      clearTimeout(timer);
      node.removeEventListener('scroll', moved);
      node.removeEventListener('touchstart', press);
      node.removeEventListener('touchend', release);
      node.removeEventListener('touchcancel', release);
    };
  }, [hasHeader]);

  // Content taller than the page with its full header gets room for the
  // header to finish shrinking, so it is never stuck partway at the bottom.
  const [contentHeight, setContentHeight] = useState(0);
  const footRoom = floating ? 104 : 32;
  // The room is padding, not a minimum height: content that grows to fill the
  // page then still ends where its own rows do, so the room never feeds itself.
  const shrinkPadding = hasHeader && pageHeight > 0 && contentHeight + footRoom > pageHeight + 1 ? Math.max(0, pageHeight + shrinkRoom - contentHeight - footRoom) : 0;

  const visibleHeight = useVisibleViewportHeight(
    (mobile || touch) && !homepage,
  );

  return (
    <ScrollPositionSnapshot scrollKey={scrollKey} save={() => {
      const node: unknown = Platform.OS === 'web' ? scroll.current?.getScrollableNode() : null;

      positions.current.set(scrollKey, Platform.OS === 'web' && node instanceof HTMLElement ? node.scrollTop : scrolled.current);
    }}>
    <ScrollToTopContext.Provider value={() => scroll.current?.scrollTo({ y: 0, animated: true })}>
      <View style={[page, visibleHeight !== null && { maxHeight: visibleHeight }]}>
        {props.status ? <View onLayout={(event) => props.onStatusLayout?.(event.nativeEvent.layout.height)}>{props.status}</View> : null}
        {props.header ? (
          <View
            style={{ backgroundColor: colors.background, zIndex: 5 }}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              const previous = headerSize.current;
              // Resizing the header can clamp scrollTop before its scroll event.
              // Read the current position so that forced movement is cancelled by
              // the equal change in header height, rather than reversing collapse.
              const node: unknown = Platform.OS === 'web' ? scroll.current?.getScrollableNode() : null;
              const y = Platform.OS === 'web' && node instanceof HTMLElement ? node.scrollTop : scrolled.current;

              const full = previous.key === scrollKey ? previous.full : headers.current.get(scrollKey)?.full ?? height;

              headerSize.current = { key: scrollKey, full: y > 0 ? Math.max(full, height) : height, current: height };
              headers.current.set(scrollKey, { full: headerSize.current.full, current: height });
              setReleased(y > 0 ? Math.max(0, headerSize.current.full - height) : 0);

              if (restoring.current) return;

              scrolled.current = y;
              props.onScroll?.(y, headerSize.current.full - height);
            }}
          >
            <View style={column}>{props.header}</View>
          </View>
        ) : null}
        <View style={page} onLayout={(event) => setPageArea(event.nativeEvent.layout.height)}>
          <ScrollView
            ref={scroll}
            onScroll={(event) => {
              if (restoring.current) return;
              const y = event.nativeEvent.contentOffset.y;
              const header = headerSize.current;
              const down = y > scrolled.current;

              scrolled.current = y;
              positions.current.set(scrollKey, y);
              props.onScroll?.(y, y > 0 && header.key === scrollKey ? header.full - header.current : 0);
              // At the top the header is full, whatever size it had while scrolled.
              setReleased(y > 0 && header.key === scrollKey ? Math.max(0, header.full - header.current) : 0);

              if (down) props.onScrollDown?.();
            }}
            scrollEventThrottle={16}
            nativeID="splitnext-page"
            style={scrollStyle}
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[{ width: '100%', maxWidth: homepage ? layout.page : layout.column, alignSelf: 'center', flexGrow: 1, paddingHorizontal: layout.gutter, paddingBottom: footRoom + shrinkPadding }]}>
              {homepage ? (
                <Row gap={8} paddingY={mobile ? 4 : 12} style={{ minHeight: mobile ? sizes.row : 64 }}>
                  <Text variant="strong" weight="bold">splitnext</Text>
                  <Tag>beta</Tag>
                </Row>
              ) : null}
              {/* Content fills the page with its full header, and measures taller only when it is. */}
              <View style={{ minHeight: Math.max(0, pageHeight - footRoom) }} onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}>
                <PageHeightContext.Provider value={pageHeight - footRoom}>{props.children}</PageHeightContext.Provider>
              </View>
            </View>
          </ScrollView>
        </View>
        {props.footer ? (
          floating ? (
            <View
              pointerEvents="box-none"
              style={{ position: 'absolute', left: 0, right: 0, bottom: 24, zIndex: 6 }}
            >
              <View pointerEvents="box-none" style={[column, { gap: 12 }]}>{props.footer}</View>
            </View>
          ) : (
            // Above the header, so a drawer opening from the foot can dim the whole screen.
            <View style={{ zIndex: 6, backgroundColor: colors.background, paddingTop: 12, paddingBottom: 16 }}>
              <View style={[column, { gap: 12 }]}>{props.footer}</View>
            </View>
          )
        ) : null}
      </View>
    </ScrollToTopContext.Provider>
    </ScrollPositionSnapshot>
  );
}
