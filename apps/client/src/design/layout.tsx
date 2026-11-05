import type { Ref } from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors, opacities, sizes, type Space } from './tokens';

const alignments = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' } as const;

const justifications = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' } as const;

export type BoxProps = ViewProps & {
  ref?: Ref<View> | undefined;
  /** Space between children, from the spacing scale. */
  gap?: Space | undefined;
  /** Padding on every side, then per axis and per edge; later ones win. */
  padding?: Space | undefined;
  paddingX?: Space | undefined;
  paddingY?: Space | undefined;
  paddingTop?: Space | undefined;
  paddingBottom?: Space | undefined;
  align?: keyof typeof alignments | undefined;
  justify?: keyof typeof justifications | undefined;
  /** Takes the room left in its parent, and may shrink below its content's width. */
  fill?: boolean | undefined;
  wrap?: boolean | undefined;
};

function boxStyle(props: BoxProps, direction: 'row' | 'column'): StyleProp<ViewStyle> {
  return [
    {
      flexDirection: direction,
      gap: props.gap,
      padding: props.padding,
      paddingHorizontal: props.paddingX,
      paddingVertical: props.paddingY,
      paddingTop: props.paddingTop,
      paddingBottom: props.paddingBottom,
    },
    props.align ? { alignItems: alignments[props.align] } : null,
    props.justify ? { justifyContent: justifications[props.justify] } : null,
    props.fill ? { flex: 1, minWidth: 0 } : null,
    props.wrap ? { flexWrap: 'wrap' } : null,
    props.style,
  ];
}

function viewProps(props: BoxProps): ViewProps & { ref?: Ref<View> | undefined } {
  const { gap: _gap, padding: _padding, paddingX: _x, paddingY: _y, paddingTop: _top, paddingBottom: _bottom, align: _align, justify: _justify, fill: _fill, wrap: _wrap, style: _style, ...rest } = props;

  return rest;
}

/** Children in a column, a step of the spacing scale apart. */
export function Stack(props: BoxProps) {
  return <View {...viewProps(props)} style={boxStyle(props, 'column')} />;
}

/** Children in a line, centred across it unless aligned otherwise. */
export function Row(props: BoxProps) {
  return <View {...viewProps(props)} style={boxStyle({ align: 'center', ...props }, 'row')} />;
}

export type TouchableProps = Omit<PressableProps, 'style'> & {
  ref?: Ref<View> | undefined;
  style?: StyleProp<ViewStyle> | undefined;
  /**
   * How it answers a press: fading, the default; tinting the row behind it,
   * for a whole row; or not at all.
   */
  feedback?: 'fade' | 'tint' | 'none' | undefined;
  /** Fades while disabled, as a control that cannot be used right now. */
  dim?: boolean | undefined;
};

/** Anything pressable that is not a button with a label: rows, icons, toggles. */
export function Touchable(props: TouchableProps) {
  const { feedback = 'fade', dim, style, ...rest } = props;

  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [
        style,
        pressed && feedback === 'fade' ? { opacity: opacities.pressed } : null,
        pressed && feedback === 'tint' ? { backgroundColor: colors.tint } : null,
        dim && props.disabled ? { opacity: opacities.disabled } : null,
      ]}
    />
  );
}

/** A square icon with a full touch target around it, named for assistive technology. */
export function IconButton(props: Omit<TouchableProps, 'accessibilityLabel'> & { label: string; size?: number | undefined }) {
  const { label, size = sizes.touch, style, ...rest } = props;

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      dim
      {...rest}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    />
  );
}
