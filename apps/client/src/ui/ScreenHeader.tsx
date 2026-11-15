import { useContext, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextButton, between, hairlineShadow, layout, sizes, titleStyle } from '../design';
import { CompactProgressContext, HeaderShrinkContext, ScrollToTopContext, useCompactProgress } from './pageScroll';
import { morph } from './ScreenMorph';

/** What the folded part of a header reads: always full size, since it folds away whole. */
const fullSize = { get: () => 0, subscribe: () => () => {} };

/**
 * A screen's fixed header: a row with a text back action and actions at the
 * end, then a large title. When the page has scrolled, everything under the
 * row folds away and only the row stays, with `compactTitle` (or the title)
 * small in its middle; tapping that returns to the top. A heading that is
 * more than text stands in for the title and styles its text with
 * `titleStyle(progress)`. `underRow` opens directly under the row, such as a
 * field for one of its actions, and stays when the rest folds; `below`
 * follows the title. Set `scrollRule` false when a pinned section heading
 * draws the divider beneath the header instead, and `flush` when what is
 * below ends with its own edge, such as a bar, for the header to end right
 * there.
 */
export function ScreenHeader(props: { title?: string | undefined; compactTitle?: string | undefined; heading?: ReactNode; start?: ReactNode; end?: ReactNode; underRow?: ReactNode; below?: ReactNode; morph?: string | undefined; scrollRule?: boolean | undefined; flush?: boolean }) {
  const progress = useCompactProgress();
  const scrollToTop = useContext(ScrollToTopContext);
  const reportShrink = useContext(HeaderShrinkContext);
  const [foldHeight, setFoldHeight] = useState(0);
  const small = props.compactTitle ?? props.title;
  const folds = Boolean(props.heading ?? props.title ?? props.below);

  return (
    <View style={{ paddingTop: between(4, 0, progress), paddingBottom: props.flush ? 0 : between(12, 4, progress), boxShadow: props.scrollRule === false ? 'none' : hairlineShadow(progress) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: sizes.touch }}>
        {/* The back action's padding reaches the screen's edge. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -layout.gutter, minWidth: 0, flexShrink: 1 }}>{props.start}</View>
        {small && folds && progress > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${small}. Scroll to top`}
            disabled={progress < 0.5 || !scrollToTop}
            onPress={() => scrollToTop?.()}
            style={{ flex: 1, minWidth: 0, height: sizes.touch, justifyContent: 'center', paddingHorizontal: 8, opacity: progress }}
          >
            <Text numberOfLines={1} variant="body" weight="semibold" align="center">{small}</Text>
          </Pressable>
        ) : null}
        {props.end ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: -12, flexShrink: 0 }}>{props.end}</View> : null}
      </View>
      {props.underRow}
      {folds ? (
        // Folds away whole: its parts keep their full size while it closes over them.
        <View aria-hidden={progress === 1} style={{ height: progress > 0 && foldHeight ? between(foldHeight, 0, progress) : undefined, opacity: Math.max(0, 1 - 1.5 * progress), overflow: progress > 0 ? 'hidden' : 'visible' }}>
          <View onLayout={(event) => {
            const height = event.nativeEvent.layout.height;

            setFoldHeight(height);
            // The fold and the padding the compact row drops.
            reportShrink?.(height + 4 + (props.flush ? 0 : 8));
          }}>
            <CompactProgressContext.Provider value={fullSize}>
              {props.heading ?? props.title ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0, paddingTop: 8 }}>
                  {props.heading ?? (
                    <Text ref={morph(props.morph)} accessibilityRole="header" numberOfLines={1} style={titleStyle(0)}>
                      {props.title}
                    </Text>
                  )}
                </View>
              ) : null}
              {props.below}
            </CompactProgressContext.Provider>
          </View>
        </View>
      ) : null}
    </View>
  );
}

type HeaderActionProps = { label: string; onPress: () => void; disabled?: boolean };

/** “‹ Groups”: where back goes, named in the header's first row. */
export function BackButton(props: HeaderActionProps & { text?: string }) {
  const named = props.label.replace(/^Back to /, '');
  const text = props.text ?? (named === props.label ? 'Back' : named.charAt(0).toUpperCase() + named.slice(1));

  return (
    <TextButton
      label={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      underline={false}
      // Shrinks with a long name, which then ends in an ellipsis instead of running under the row's end.
      style={{ height: sizes.touch, alignItems: 'stretch', paddingLeft: layout.gutter, paddingRight: 20, flexShrink: 1, minWidth: 0 }}
    >
      {`‹ ${text}`}
    </TextButton>
  );
}

/** A text action in a screen header: Cancel, quiet, at its start, or Delete, in danger orange, at its end. */
export function HeaderAction(props: HeaderActionProps & { text: string; danger?: boolean; quiet?: boolean }) {
  return (
    <TextButton
      label={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      underline={false}
      tone={props.danger ? 'danger' : props.quiet ? 'muted' : 'ink'}
      style={props.quiet ? { paddingLeft: layout.gutter, paddingRight: 20 } : { paddingHorizontal: 12 }}
    >
      {props.text}
    </TextButton>
  );
}
