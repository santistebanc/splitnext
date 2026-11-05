import type { Ref } from 'react';
import { Text as NativeText, TextInput, type TextInputProps, type TextProps as NativeTextProps } from 'react-native';
import { colors, fontWeights, typeScale, type FontWeight, type TypeVariant } from './tokens';

/** What a text's color says, rather than the color itself. */
export const tones = {
  ink: colors.ink,
  muted: colors.muted,
  faint: colors.faint,
  owed: colors.owed,
  danger: colors.danger,
  /** On ink, such as a toast or a ticked box. */
  inverse: colors.background,
  /** An action on ink. */
  positive: colors.positive,
} as const;

export type Tone = keyof typeof tones;

export type TextProps = NativeTextProps & {
  ref?: Ref<NativeText> | undefined;
  /** A step of the type ramp; left out only by text nested in another. */
  variant?: TypeVariant | undefined;
  tone?: Tone | undefined;
  /** Overrides the step's own weight, as for a name inside a sentence. */
  weight?: FontWeight | undefined;
  align?: 'left' | 'center' | 'right' | undefined;
  /** Underlined, as a text action is. */
  underline?: boolean | undefined;
  /** A color outside the tones, such as a balance's; prefer `tone`. */
  color?: string | undefined;
};

/** The style a type step gives text: for inputs and the few texts that size themselves. */
export function textStyle(variant: TypeVariant, tone: Tone = 'ink') {
  return { ...typeScale[variant], color: tones[tone] };
}

/**
 * All text in the app: a step of the type ramp in a tone. Text on its own
 * names its step. Nested inside another it may leave the step out to inherit
 * everything but what it sets, so a bold name in a sentence is
 * `<Text weight="bold">`.
 */
export function Text(props: TextProps) {
  const { variant, tone, weight, align, underline, color, style, ...rest } = props;

  return (
    <NativeText
      {...rest}
      style={[
        variant ? typeScale[variant] : null,
        variant || tone ? { color: tones[tone ?? 'ink'] } : null,
        weight ? { fontWeight: fontWeights[weight] } : null,
        align ? { textAlign: align } : null,
        underline ? { textDecorationLine: 'underline' } : null,
        color ? { color } : null,
        style,
      ]}
    />
  );
}

/**
 * A step's font for a single-line input, which centres its own text and so
 * takes no line height.
 */
export function inputStyle(variant: TypeVariant, weight?: FontWeight) {
  const { fontFamily, fontSize, fontWeight } = typeScale[variant];

  return { fontFamily, fontSize, fontWeight: weight ? fontWeights[weight] : fontWeight, color: colors.ink };
}

export type InputProps = TextInputProps & { ref?: Ref<TextInput> | undefined; variant?: TypeVariant | undefined; weight?: FontWeight | undefined };

/**
 * A bare text input in a step of the type ramp, without a label or underline
 * of its own; `Field` is the labelled one.
 */
export function Input(props: InputProps) {
  const { variant, weight, style, ...rest } = props;

  return <TextInput placeholderTextColor={colors.faint} {...rest} style={[inputStyle(variant ?? 'large', weight), style]} />;
}
