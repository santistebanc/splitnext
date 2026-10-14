import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Easing,
  Platform,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { colors } from './components';

type MemberRowTransitionProps = {
  children: ReactNode;
  order: string;
  selected: boolean;
  reducedMotion: boolean;
};

/** Move keyed rows from their previous positions without remounting editors. */
export function MemberRowTransition(props: MemberRowTransitionProps) {
  const view = useRef<View>(null);
  const previousTop = useRef<number | null>(null);
  const webAnimation = useRef<Animation | null>(null);
  const [translation] = useState(() => new Animated.Value(0));

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') {
      if (props.reducedMotion) {
        translation.stopAnimation();
        translation.setValue(0);
      }

      return;
    }

    const node = view.current;

    // React Native Web forwards the underlying DOM element through the View ref.
    if (!(node instanceof HTMLElement)) return;

    const top = node.offsetTop;
    const previous = previousTop.current;
    previousTop.current = top;

    const inFlight = new DOMMatrixReadOnly(getComputedStyle(node).transform)
      .m42;

    webAnimation.current?.cancel();

    if (previous === null || props.reducedMotion) return;
    const distance = previous - top + inFlight;

    if (!distance) return;
    webAnimation.current = node.animate(
      [
        { transform: `translateY(${distance}px)` },
        { transform: 'translateY(0)' },
      ],
      { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  }, [props.order, props.reducedMotion, translation]);

  useEffect(
    () => () => {
      webAnimation.current?.cancel();
      translation.stopAnimation();
    },
    [translation],
  );

  function onLayout(event: LayoutChangeEvent): void {
    if (Platform.OS === 'web') return;
    const top = event.nativeEvent.layout.y;
    const previous = previousTop.current;
    previousTop.current = top;

    if (previous === null || previous === top || props.reducedMotion) return;
    translation.stopAnimation((inFlight) => {
      translation.setValue(previous - top + inFlight);
      Animated.timing(translation, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }

  return (
    <Animated.View
      ref={view}
      onLayout={onLayout}
      style={{
        backgroundColor: colors.surface,
        zIndex: props.selected ? 1 : 0,
        transform: [{ translateY: translation }],
      }}
    >
      {props.children}
    </Animated.View>
  );
}
