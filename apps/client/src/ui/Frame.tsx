import { Component, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Row, Tag, Text, colors, layout, sizes } from '../design';
import { CompactHeaderContext, CompactProgressContext, HeaderShrinkContext, PageHeightContext, RevealContext, ScrollToTopContext } from './pageScroll';
import { useHomepage } from './screenHost';
import {
  useCompactLayout,
  useTouchInput,
  useVisibleViewportHeight,
} from './useVisibleViewport';

// Changes above the visible content must not move it to keep it in place.
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
  /** A fixed screen header over the top of the scrolling content. */
  header?: ReactNode;
  /** App-wide connection status, fixed above every screen's header. */
  status?: ReactNode;
  onStatusLayout?: ((height: number) => void) | undefined;
  /** The screen's one main action, pinned below the content. */
  footer?: ReactNode;
  /**
   * The header turns compact once the content has scrolled past the height it
   * gives up, and full again on the way back. `instant` marks the state a
   * screen opens at rather than a scroll, which takes effect without motion.
   */
  onCompactChange?: ((compact: boolean, instant: boolean) => void) | undefined;
  /** Receives a way to scroll the content, smoothly unless told not to, such as back to the top. */
  scrollControl?: { current: ((y: number, animated?: boolean) => void) | null } | undefined;
};

/** What a header gives up when compact, until it has been seen compact. */
const expectedShrink = 64;

/** How far back above the switch the content scrolls before the header is full again, so a resting finger does not flicker it. */
const hysteresis = 8;

/** The header's two sizes on a screen: its full height and what it gives up when compact. */
type HeaderSizes = { full: number; shrink: number };

/**
 * The screen shell: a header over the top of the scrolling content, and the
 * main action, in one narrow column like a phone screen on every device.
 * The header never moves the content: the content starts below the full
 * header and scrolls under it, so the header can change size at once without
 * the page moving on its own.
 */
export function Frame(props: FrameProps) {
  const progress = useContext(CompactProgressContext);
  const [pageArea, setPageArea] = useState(0);
  const [header, setHeader] = useState<HeaderSizes>({ full: 0, shrink: expectedShrink });
  const headerRef = useRef(header);
  const mobile = useCompactLayout();
  const touch = useTouchInput();
  const scroll = useRef<ScrollView>(null);
  const control = props.scrollControl;

  headerRef.current = header;

  useEffect(() => {
    if (!control) return;
    control.current = (y, animated = true) => scroll.current?.scrollTo({ y, animated });

    return () => {
      control.current = null;
    };
  }, [control]);
  const positions = useRef(new Map<string, number>());
  const headers = useRef(new Map<string, HeaderSizes>());
  const scrollKey = props.scrollKey ?? 'page';
  const depth = props.navigationDepth ?? 0;
  const previousDepth = useRef(depth);
  const scrolled = useRef(0);
  const compact = useRef(false);
  const homepage = useHomepage();
  // A scrollbar's width, which the header and footer leave at their right so
  // their column stands exactly over the page's.
  const [scrollbar, setScrollbar] = useState(0);

  // A scrollbar comes and goes with the content's height, without a layout
  // event of its own, so the page's box is watched, before the first paint.
  useLayoutEffect(() => {
    const node: unknown = Platform.OS === 'web' ? scroll.current?.getScrollableNode() : null;

    if (!(node instanceof HTMLElement)) return;
    const measure = () => setScrollbar(node.offsetWidth - node.clientWidth);
    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(node);

    if (node.firstElementChild) observer.observe(node.firstElementChild);

    return () => observer.disconnect();
  }, []);

  // Scrolls caused by switching screens, including late ones from the screen
  // left behind, are neither a person scrolling nor this screen's position.
  const restoring = useRef(false);
  // A position restored with the header sizes it was saved with, applied
  // again once the page has those sizes and so its full height.
  const pending = useRef<number | null>(null);

  function follow(y: number, instant: boolean): void {
    const shrink = headerRef.current.shrink;
    const next = compact.current ? y >= shrink - hysteresis : y > shrink;

    if (next === compact.current && !instant) return;
    compact.current = next;
    props.onCompactChange?.(next, instant);
  }

  // Only a change of screen applies this policy; in-place panels and edits
  // keep their position even if they update browser history.
  useLayoutEffect(() => {
    const returning = props.restoreScroll || depth < previousDepth.current;
    const restored = returning ? positions.current.get(scrollKey) ?? 0 : 0;
    const sizes = headers.current.get(scrollKey);

    previousDepth.current = depth;
    positions.current.set(scrollKey, restored);
    restoring.current = true;
    scrolled.current = restored;

    // A screen returned to compact keeps the full height it had, which its
    // compact header can no longer show.
    if (returning && sizes) {
      headerRef.current = sizes;
      setHeader(sizes);
      pending.current = restored;
    }

    scroll.current?.scrollTo({ y: restored, animated: false });
    compact.current = false;
    follow(restored, true);

    const frame = requestAnimationFrame(() => {
      restoring.current = false;
      pending.current = null;
    });

    return () => cancelAnimationFrame(frame);
  }, [scrollKey]);

  // Until the restored sizes apply, the page can be too short to reach the
  // saved position, so the browser stops short of it.
  useLayoutEffect(() => {
    if (pending.current !== null) scroll.current?.scrollTo({ y: pending.current, animated: false });
  }, [header.full]);

  // A header can say what it gives up before it is first seen compact.
  function reportShrink(shrink: number): void {
    const current = headerRef.current;

    if (Math.abs(shrink - current.shrink) <= 0.5) return;
    const next = { ...current, shrink };

    headerRef.current = next;
    setHeader(next);
  }

  // Content scrolls under the header, so an element reaches the top of what
  // shows once it sits just under the compact header.
  function reveal(id: string): void {
    const node: unknown = Platform.OS === 'web' ? scroll.current?.getScrollableNode() : null;
    const element = Platform.OS === 'web' ? document.getElementById(id) : null;

    if (!(node instanceof HTMLElement) || !(element instanceof HTMLElement)) return;
    const y = element.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
    const compactHeight = headerRef.current.full - headerRef.current.shrink;

    scroll.current?.scrollTo({ y: Math.max(0, y - compactHeight), animated: true });
  }

  const footRoom = 32;
  const pageHeight = Math.max(0, pageArea - header.full);
  const compactHeight = props.header ? Math.max(0, header.full - header.shrink) : 0;

  const visibleHeight = useVisibleViewportHeight(
    (mobile || touch) && !homepage,
  );

  return (
    <ScrollPositionSnapshot scrollKey={scrollKey} save={() => {
      const node: unknown = Platform.OS === 'web' ? scroll.current?.getScrollableNode() : null;

      positions.current.set(scrollKey, Platform.OS === 'web' && node instanceof HTMLElement ? node.scrollTop : scrolled.current);
      headers.current.set(scrollKey, headerRef.current);
    }}>
    <ScrollToTopContext.Provider value={() => scroll.current?.scrollTo({ y: 0, animated: true })}>
    <RevealContext.Provider value={reveal}>
      <View style={[page, visibleHeight !== null && { maxHeight: visibleHeight }]}>
        {props.status ? <View onLayout={(event) => props.onStatusLayout?.(event.nativeEvent.layout.height)}>{props.status}</View> : null}
        <View
          style={page}
          onLayout={(event) => setPageArea(event.nativeEvent.layout.height)}
        >
          {props.header ? (
            <View
              style={{ position: 'absolute', top: 0, left: 0, right: scrollbar, backgroundColor: colors.background, zIndex: 5 }}
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                const shown = progress.get();
                const current = headerRef.current;

                // Sizes are read only at rest: full sets where the content
                // starts, and compact how far it scrolls before the switch.
                if (shown === 0 && Math.abs(height - current.full) > 0.5) {
                  const next = { ...current, full: height };

                  headerRef.current = next;
                  setHeader(next);
                } else if (shown === 1 && current.full > height && Math.abs(current.full - height - current.shrink) > 0.5) {
                  const next = { ...current, shrink: current.full - height };

                  headerRef.current = next;
                  setHeader(next);
                }
              }}
            >
              <HeaderShrinkContext.Provider value={reportShrink}>
                <View style={column}>{props.header}</View>
              </HeaderShrinkContext.Provider>
            </View>
          ) : null}
          <ScrollView
            ref={scroll}
            onScroll={(event) => {
              if (restoring.current) return;
              const y = event.nativeEvent.contentOffset.y;

              scrolled.current = y;
              positions.current.set(scrollKey, y);
              follow(y, false);
            }}
            scrollEventThrottle={16}
            nativeID="splitnext-page"
            style={scrollStyle}
            contentContainerStyle={{ flexGrow: 1, paddingTop: props.header ? header.full : 0 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[{ width: '100%', maxWidth: homepage ? layout.page : layout.column, alignSelf: 'center', flexGrow: 1, paddingHorizontal: layout.gutter, paddingBottom: footRoom }]}>
              {homepage ? (
                <Row gap={8} paddingY={mobile ? 4 : 12} style={{ minHeight: mobile ? sizes.row : 64 }}>
                  <Text variant="strong" weight="bold">splitnext</Text>
                  <Tag>beta</Tag>
                </Row>
              ) : null}
              <CompactHeaderContext.Provider value={{ height: compactHeight, room: Math.max(0, pageArea - compactHeight - footRoom) }}>
                <PageHeightContext.Provider value={pageHeight - footRoom}>{props.children}</PageHeightContext.Provider>
              </CompactHeaderContext.Provider>
            </View>
          </ScrollView>
        </View>
        {props.footer ? (
          <View style={{ zIndex: 6, backgroundColor: colors.background, paddingTop: 12, paddingBottom: 16, paddingRight: scrollbar }}>
            <View style={[column, { gap: 12 }]}>{props.footer}</View>
          </View>
        ) : null}
      </View>
    </RevealContext.Provider>
    </ScrollToTopContext.Provider>
    </ScrollPositionSnapshot>
  );
}
