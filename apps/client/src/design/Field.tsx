import { useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { Text, inputStyle } from './Text';
import { colors, durations, opacities, sizes, strokes, typeScale, withTransition } from './tokens';

export type FieldProps = TextInputProps & {
  label: string;
  hideLabel?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  /** An action at the field's end, such as Paste. */
  trailing?: ReactNode | undefined;
  /** Optional read layer, such as a two-line title with an ellipsis. */
  displayValue?: ReactNode | undefined;
  inputRef?: Ref<TextInput> | undefined;
};

/** The labelled, underlined text field: its label floats up on focus or once it has text. */
export function Field(props: FieldProps) {
  const { label, hideLabel, hint, error, trailing, displayValue, inputRef, ...input } = props;
  const field = useRef<TextInput>(null);

  useImperativeHandle(inputRef, () => field.current!, []);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [text, setText] = useState(input.defaultValue ?? '');
  const hintId = useId();
  const filled = Boolean(input.value ?? text);
  const raised = focused || filled;
  const disabled = input.editable === false;
  const invalid = Boolean(error);
  const activeColor = invalid ? colors.danger : colors.ink;

  return (
    <View style={{ gap: 4, opacity: disabled ? opacities.disabled : 1 }}>
      <View onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} style={{ paddingTop: hideLabel ? 0 : 16 }}>
        {!hideLabel ? (
          <Pressable accessible={false} focusable={false} disabled={disabled} onPress={() => field.current?.focus()} style={withTransition({ position: 'absolute', zIndex: 1, left: 0, top: raised ? 0 : 26 }, 'top', durations.quick)}>
            <Text aria-hidden style={withTransition({ ...(raised ? typeScale.meta : typeScale.large), fontWeight: typeScale.large.fontWeight, color: focused || invalid ? activeColor : colors.muted }, 'font-size, line-height, color', durations.quick)}>{label}</Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: strokes.hairline, borderColor: invalid ? colors.danger : hovered && !disabled ? colors.ink : colors.faint }}>
          <TextInput
            {...input}
            ref={field}
            accessibilityLabel={label}
            aria-invalid={invalid}
            aria-describedby={error || hint ? hintId : undefined}
            placeholder={hideLabel || raised ? input.placeholder : undefined}
            placeholderTextColor={colors.faint}
            onFocus={(event) => { setFocused(true); input.onFocus?.(event); }}
            onBlur={(event) => { setFocused(false); input.onBlur?.(event); }}
            onChangeText={(value) => { setText(value); input.onChangeText?.(value); }}
            style={[
              inputStyle('large'),
              { flex: 1, minWidth: 0, height: sizes.touch, paddingHorizontal: 0 },
              input.style,
            ]}
          />
          {trailing}
          {displayValue ? <View aria-hidden pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 10 }}>{displayValue}</View> : null}
        </View>
        <View pointerEvents="none" style={withTransition({ position: 'absolute', bottom: 0, left: 0, right: 0, height: strokes.focus, backgroundColor: activeColor, transform: [{ scaleX: focused && !disabled ? 1 : 0 }] }, 'transform', durations.quick)} />
      </View>
      {error || hint ? <Text nativeID={hintId} variant="caption" tone={invalid ? 'danger' : 'muted'}>{error || hint}</Text> : null}
    </View>
  );
}
