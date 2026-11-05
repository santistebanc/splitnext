import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Touchable } from './layout';
import { Text } from './Text';
import { colors, radii, sizes, strokes } from './tokens';

/** A round marker that thickens when chosen. */
export function RadioMark(props: { selected: boolean }) {
  const size = 20;

  return (
    <View
      style={[
        { width: size, height: size, borderRadius: radii.round, borderWidth: strokes.ink, borderColor: colors.faint },
        props.selected && { borderWidth: 6, borderColor: colors.ink },
      ]}
    />
  );
}

/** One choice of several, as a row ruled above: the marker, the label, then anything after it. */
export function RadioRow(props: { label: string; selected: boolean; onPress: () => void; disabled?: boolean | undefined; accessibilityLabel?: string | undefined; children?: ReactNode | undefined; style?: StyleProp<ViewStyle> | undefined }) {
  return (
    <Touchable
      accessibilityRole="radio"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ checked: props.selected, disabled: Boolean(props.disabled) }}
      aria-checked={props.selected}
      disabled={props.disabled}
      dim
      onPress={props.onPress}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.row, borderTopWidth: strokes.hairline, borderColor: colors.rule },
        props.style,
      ]}
    >
      <RadioMark selected={props.selected} />
      <Text numberOfLines={1} variant="strong" style={{ flex: 1 }}>{props.label}</Text>
      {props.children}
    </Touchable>
  );
}

/** A square box that fills with ink and a check when ticked. */
export function CheckMark(props: { checked: boolean }) {
  return (
    <View style={[{ width: 18, height: 18, borderWidth: strokes.ink, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' }, props.checked && { backgroundColor: colors.ink }]}>
      {props.checked ? <Text variant="count" tone="inverse">✓</Text> : null}
    </View>
  );
}

/** A checkbox with a full touch target around its box. */
export function Checkbox(props: { checked: boolean; label: string; onPress: () => void; disabled?: boolean | undefined; style?: StyleProp<ViewStyle> | undefined }) {
  return (
    <Touchable
      accessibilityRole="checkbox"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.checked, disabled: Boolean(props.disabled) }}
      aria-checked={props.checked}
      disabled={props.disabled}
      // Only a ticked box fades while it cannot change; an empty one already looks quiet.
      dim={props.checked}
      onPress={props.onPress}
      style={[{ width: sizes.touch, height: sizes.touch, alignItems: 'center', justifyContent: 'center' }, props.style]}
    >
      <CheckMark checked={props.checked} />
    </Touchable>
  );
}

export type SegmentedOption<Value extends string> = { value: Value; text: string };

/** Two or more options joined edge to edge, like tabs; the chosen one fills with ink. */
export function SegmentedControl<Value extends string>(props: { label: string; options: readonly SegmentedOption<Value>[]; value: Value; onChange: (value: Value) => void; disabled?: boolean | undefined; style?: StyleProp<ViewStyle> | undefined }) {
  return (
    <View role="radiogroup" aria-label={props.label} style={[{ flexDirection: 'row' }, props.style]}>
      {props.options.map((option, index) => {
        const selected = option.value === props.value;

        return (
          <Touchable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.text}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            disabled={props.disabled}
            onPress={() => { if (!selected) props.onChange(option.value); }}
            style={[
              { height: sizes.compact, minWidth: 84, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: strokes.ink, borderColor: colors.ink },
              index > 0 && { marginLeft: -strokes.ink },
              selected && { backgroundColor: colors.ink },
            ]}
          >
            <Text numberOfLines={1} variant="caption" weight="semibold" tone={selected ? 'inverse' : 'ink'}>{option.text}</Text>
          </Touchable>
        );
      })}
    </View>
  );
}

/** A quiet suggestion to tap, such as a name used in another group. */
export function Chip(props: { text: string; label?: string | undefined; onPress: () => void }) {
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={{ height: sizes.compact, paddingHorizontal: 12, justifyContent: 'center', borderWidth: strokes.hairline, borderColor: colors.rule }}
    >
      <Text variant="caption" weight="semibold">{props.text}</Text>
    </Touchable>
  );
}
