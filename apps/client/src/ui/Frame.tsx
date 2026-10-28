import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, ScrollView, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import { s } from './components';
import { ScrollToTopContext } from './pageScroll';
import {
  useCompactLayout,
  useTouchInput,
  useVisibleViewportHeight,
} from './useVisibleViewport';

// Header reflow must not anchor the scroll position and feed back into its
// compact progress, especially when the split list just reaches the bottom.
const scrollStyle = Platform.OS === 'web' ? { ...s.page, overflowAnchor: 'none' } : s.page;

type FrameProps = {
  children: ReactNode;
  /** Independent scroll positions for sibling views, such as the group screen and a person. */
  scrollKey?: string;
  /** A fixed screen header above the scrolling content. */
  header?: ReactNode;
  /** App-wide connection status, fixed above every screen's header. */
  status?: ReactNode;
  onStatusLayout?: ((height: number) => void) | undefined;
  /** The screen's one main action, pinned below the content. */
  footer?: ReactNode;
  /** Whether the footer floats over the content instead of taking its own bar. */
  floatingFooter?: boolean;
  /** A rule above the pinned footer, for screens whose content scrolls under it. */
  ruledFooter?: boolean | undefined;
  /** Content offset and the space released by its header. Collapse follows their
   * sum, which stays fixed when header reflow clamps the scroll position. */
  onScroll?: ((y: number, headerCollapse: number) => void) | undefined;
  /** Receives a way to scroll the content, smoothly unless told not to, such as back to the top. */
  scrollControl?: { current: ((y: number, animated?: boolean) => void) | null } | undefined;
};

/**
 * The screen shell: a fixed header, scrolling content, and the main action,
 * in one narrow column like a phone screen on every device.
 */
export function Frame(props: FrameProps) {
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
  const scrollKey = props.scrollKey ?? 'page';
  const headerSize = useRef({ key: scrollKey, full: 0, current: 0 });
  const scrolled = useRef(0);
  const homepage = usePathname() === '/';
  const floating = Boolean(props.footer && props.floatingFooter);

  // Scrolls caused by switching screens, including late ones from the screen
  // left behind, are neither a person scrolling nor this screen's position.
  const restoring = useRef(false);

  useLayoutEffect(() => {
    const restored = positions.current.get(scrollKey) ?? 0;

    restoring.current = true;
    scrolled.current = restored;
    scroll.current?.scrollTo({ y: restored, animated: false });
    props.onScroll?.(restored, 0);

    const frame = requestAnimationFrame(() => {
      restoring.current = false;
    });

    return () => cancelAnimationFrame(frame);
  }, [scrollKey]);

  // Each screen rises into place as it fades in. The page area moves rather
  // than its content, so pinned parts stay at the area's top and nothing
  // scrolled past them shows above them on the way.
  const [rise] = useState(() => new Animated.Value(0));

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    rise.setValue(8);
    const animation = Animated.timing(rise, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' });

    animation.start();

    return () => animation.stop();
  }, [scrollKey]);

  const visibleHeight = useVisibleViewportHeight(
    (mobile || touch) && !homepage,
  );

  return (
    <ScrollToTopContext.Provider value={() => scroll.current?.scrollTo({ y: 0, animated: true })}>
      <View style={[s.page, visibleHeight !== null && { maxHeight: visibleHeight }]}>
        {props.status ? <View onLayout={(event) => props.onStatusLayout?.(event.nativeEvent.layout.height)}>{props.status}</View> : null}
        {props.header ? (
          <View
            style={s.screenHeaderBar}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              const previous = headerSize.current;
              // Resizing the header can clamp scrollTop before its scroll event.
              // Read the current position so that forced movement is cancelled by
              // the equal change in header height, rather than reversing collapse.
              const node: unknown = Platform.OS === 'web' ? scroll.current?.getScrollableNode() : null;
              const y = Platform.OS === 'web' && node instanceof HTMLElement ? node.scrollTop : scrolled.current;

              headerSize.current = { key: scrollKey, full: previous.key === scrollKey && y > 0 ? Math.max(previous.full, height) : height, current: height };

              if (restoring.current) return;

              scrolled.current = y;
              props.onScroll?.(y, headerSize.current.full - height);
            }}
          >
            <View style={s.screenColumn}>{props.header}</View>
          </View>
        ) : null}
        <Animated.View style={[s.page, { transform: [{ translateY: rise }] }]}>
          <ScrollView
            ref={scroll}
            onScroll={(event) => {
              if (restoring.current) return;
              const y = event.nativeEvent.contentOffset.y;
              const header = headerSize.current;

              scrolled.current = y;
              positions.current.set(scrollKey, y);
              props.onScroll?.(y, y > 0 && header.key === scrollKey ? header.full - header.current : 0);
            }}
            scrollEventThrottle={16}
            nativeID="splitnext-page"
            style={scrollStyle}
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[s.wrap, !homepage && s.appWrap, homepage && mobile && s.mobileWrap, floating && { paddingBottom: 104 }]}>
              {homepage ? (
                <View style={[s.header, mobile && s.mobileHeader]}>
                  <View style={s.brand}>
                    <Text style={s.brandText}>splitnext</Text>
                    <Text style={s.beta}>BETA</Text>
                  </View>
                </View>
              ) : null}
              {props.children}
            </View>
          </ScrollView>
        </Animated.View>
        {props.footer ? (
          floating ? (
            <View
              pointerEvents="box-none"
              style={{ position: 'absolute', left: 0, right: 0, bottom: 28 }}
            >
              <View pointerEvents="box-none" style={[s.screenColumn, s.footerInner]}>{props.footer}</View>
            </View>
          ) : (
            <View style={[s.footerBar, props.ruledFooter && s.footerBarRuled]}>
              <View style={[s.screenColumn, s.footerInner]}>{props.footer}</View>
            </View>
          )
        ) : null}
      </View>
    </ScrollToTopContext.Provider>
  );
}
