import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Button, s } from './components';
import {
  useCompactLayout,
  useTouchInput,
  useVisibleViewportHeight,
} from './useVisibleViewport';

type FrameProps = {
  children: ReactNode;
  onGroups?: (() => void) | undefined;
  onHomepage?: (() => void) | undefined;
  navigationDisabled?: boolean;
};

/** The page shell: brand header, optional Groups action, and scrolling body. */
export function Frame(props: FrameProps) {
  const mobile = useCompactLayout();
  const touch = useTouchInput();
  const homepage = usePathname() === '/';

  const visibleHeight = useVisibleViewportHeight(
    (mobile || touch) && !homepage,
  );

  const brand = (
    <>
      <Text style={s.brandMark}>s</Text>
      <Text style={s.brandText}>splitnext</Text>
      <Text style={s.beta}>BETA</Text>
    </>
  );

  return (
    <ScrollView
      style={[s.page, visibleHeight !== null && { maxHeight: visibleHeight }]}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[s.wrap, !homepage && s.appWrap, mobile && s.mobileWrap]}>
        <View style={[s.header, mobile && s.mobileHeader]}>
          {homepage ? (
            <View style={s.brand}>{brand}</View>
          ) : (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Splitnext homepage"
              disabled={props.navigationDisabled}
              accessibilityState={{
                disabled: Boolean(props.navigationDisabled),
              }}
              onPress={props.onHomepage ?? (() => router.push('/'))}
              style={s.brand}
            >
              {brand}
            </Pressable>
          )}
          {props.onGroups ? (
            <Button
              quiet
              disabled={Boolean(props.navigationDisabled)}
              onPress={props.onGroups}
            >
              Groups
            </Button>
          ) : null}
        </View>
        {props.children}
      </View>
    </ScrollView>
  );
}
