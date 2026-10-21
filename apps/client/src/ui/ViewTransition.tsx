import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Platform } from 'react-native';
import { s } from './components';

type ViewTransitionProps = { children: ReactNode; mobile: boolean };

/**
 * Each page mounts hidden, so new content cannot flash before its fade starts.
 * The rise that goes with the fade moves the whole page area, in Frame.
 */
export function ViewTransition(props: ViewTransitionProps) {
  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const [progress] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));

  useEffect(() => {
    if (reducedMotion) return;

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      useNativeDriver: Platform.OS !== 'web',
    });

    animation.start();

    return () => animation.stop();
  }, [progress, reducedMotion]);

  return (
    <Animated.View
      style={[
        s.main,
        props.mobile && s.mobileMain,
        { opacity: progress },
      ]}
    >
      {props.children}
    </Animated.View>
  );
}
