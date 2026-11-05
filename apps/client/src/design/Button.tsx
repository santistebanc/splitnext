import type { ReactNode, Ref } from 'react';
import { ActivityIndicator, View, type Insets, type StyleProp, type ViewStyle } from 'react-native';
import { Touchable } from './layout';
import { Text, type Tone } from './Text';
import { colors, opacities, radii, sizes, strokes } from './tokens';

const buttonSizes = {
  /** On its own or at a screen's foot, where it stretches to the column's width. */
  regular: { height: sizes.control, paddingX: 20, text: 'strong' },
  /** Inside a row or beside a field, such as Undo, Record, or Paste; its hit area reaches past it. */
  compact: { height: sizes.compact, paddingX: 12, text: 'caption' },
} as const;

export type ButtonSize = keyof typeof buttonSizes;

export type ButtonProps = {
  /** Its text; left out for a square button holding only its icon, named by `label`. */
  children?: string | undefined;
  onPress: () => void;
  /** A black block, the default; or outlined in ink, for the second choice beside it. */
  variant?: 'primary' | 'secondary' | undefined;
  size?: ButtonSize | undefined;
  disabled?: boolean | undefined;
  /** Shows a spinner and cannot be pressed while what it started is working. */
  busy?: boolean | undefined;
  /** Names it for assistive technology when its text alone would not. */
  label?: string | undefined;
  /** Shares a row's width with the buttons beside it. */
  grow?: boolean | undefined;
  icon?: ReactNode | undefined;
  /** For a button that shows or hides more below it. */
  expanded?: boolean | undefined;
  hitSlop?: Insets | number | undefined;
  ref?: Ref<View> | undefined;
  style?: StyleProp<ViewStyle> | undefined;
};

/**
 * A barely rounded action in one of two sizes: a black block for the main one,
 * outlined for the second. Without text it is a square around its icon.
 */
export function Button(props: ButtonProps) {
  const size = buttonSizes[props.size ?? 'regular'];
  const compact = props.size === 'compact';
  const primary = props.variant !== 'secondary';
  const idle = Boolean(props.disabled || props.busy);
  const ink = primary ? (idle ? colors.faint : colors.background) : colors.ink;

  return (
    <Touchable
      ref={props.ref}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: idle, ...(props.busy && { busy: true }), ...(props.expanded !== undefined && { expanded: props.expanded }) }}
      disabled={idle}
      onPress={props.onPress}
      hitSlop={props.hitSlop ?? (compact ? (sizes.touch - sizes.compact) / 2 : undefined)}
      style={[
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: size.height, borderRadius: compact ? radii.chip : radii.control },
        props.children ? { paddingHorizontal: size.paddingX, minWidth: sizes.touch } : { width: size.height },
        primary ? { backgroundColor: idle ? colors.rule : colors.ink } : { borderWidth: strokes.ink, borderColor: colors.ink },
        props.grow ? { flex: 1 } : null,
        !primary && idle ? { opacity: opacities.disabled } : null,
        props.style,
      ]}
    >
      {props.busy && !compact ? <ActivityIndicator size="small" color={ink} /> : props.icon}
      {props.children ? <Text numberOfLines={1} variant={size.text} weight="semibold" align="center" color={ink}>{props.children}</Text> : null}
    </Touchable>
  );
}

export type TextButtonProps = {
  children: string;
  onPress: () => void;
  /** Header and form actions, or the smaller ones inside a page. */
  size?: 'regular' | 'small' | undefined;
  tone?: Extract<Tone, 'ink' | 'muted' | 'danger'> | undefined;
  /** Underlined unless it stands where only an action can, as in a header, or is destructive. */
  underline?: boolean | undefined;
  disabled?: boolean | undefined;
  label?: string | undefined;
  expanded?: boolean | undefined;
  hitSlop?: Insets | number | undefined;
  ref?: Ref<View> | undefined;
  style?: StyleProp<ViewStyle> | undefined;
};

/** A text action with a full-height touch target, such as Invite people or Rejoin. */
export function TextButton(props: TextButtonProps) {
  return (
    <Touchable
      ref={props.ref}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled), ...(props.expanded !== undefined && { expanded: props.expanded }) }}
      disabled={props.disabled}
      dim
      hitSlop={props.hitSlop}
      onPress={props.onPress}
      style={[{ minHeight: sizes.touch, alignItems: 'center', justifyContent: 'center' }, props.style]}
    >
      <Text numberOfLines={1} variant={props.size === 'small' ? 'caption' : 'strong'} tone={props.tone ?? 'ink'} weight="semibold" underline={props.underline ?? props.tone !== 'danger'}>
        {props.children}
      </Text>
    </Touchable>
  );
}
