import type { ReactNode, Ref } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Touchable } from './layout';
import { Text } from './Text';
import { colors, sizes, strokes, withTransition, durations } from './tokens';

/** Rules drawn along one edge, for views that are ruled rather than boxed. */
export const rules = {
  /** A hairline above, as between rows. */
  above: { borderTopWidth: strokes.hairline, borderColor: colors.rule },
  /** A hairline below, closing a list. */
  below: { borderBottomWidth: strokes.hairline, borderColor: colors.rule },
  /** An ink line above, opening a section or a total. */
  inkAbove: { borderTopWidth: strokes.ink, borderColor: colors.ink },
  /** An ink line below, as under a large amount. */
  inkBelow: { borderBottomWidth: strokes.ink, borderColor: colors.ink },
} as const;

/** A horizontal hairline across its parent, or an ink line with `strong`. */
export function Divider(props: { strong?: boolean | undefined }) {
  return <View style={props.strong ? rules.inkAbove : rules.above} />;
}

/** A section's title, with an optional action at its end. */
export function SectionHeading(props: { title: string; end?: ReactNode | undefined; onPress?: (() => void) | undefined; color?: string | undefined }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: sizes.touch }}>
      <Text accessibilityRole="header" onPress={props.onPress} variant="caption" weight="semibold" tone="muted" color={props.color} style={{ flex: 1 }}>{props.title}</Text>
      {props.end}
    </View>
  );
}

/** A pressable row ruled above, such as an expense; it tints while pressed. */
export function ListRow(props: { label: string; onPress: () => void; disabled?: boolean | undefined; style?: StyleProp<ViewStyle> | undefined; children: ReactNode }) {
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      feedback="tint"
      onPress={props.onPress}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: sizes.row, paddingVertical: 12 }, rules.above, props.style]}
    >
      {props.children}
    </Touchable>
  );
}

/**
 * A balance as two halves meeting at an ink line: what someone owes grows
 * left in orange, what they get back grows right in green, both as a share of
 * the largest balance shown beside it. With a track it is a short strip;
 * without, as in a row of people, the strip sits in the middle of an ink line
 * running the row's full height. `stripRef` reaches the strip itself, such as
 * to fly it between screens.
 */
export function BalanceBar(props: { amount: number; max: number; height?: number | undefined; track?: boolean | undefined; stripRef?: Ref<View> | undefined }) {
  const share = props.max > 0 ? Math.min(1, Math.abs(props.amount) / props.max) : 0;
  const width = `${share * 100}%` as const;
  const half = { flex: 1, flexDirection: 'row' } as const;
  const grow = withTransition({ height: '100%' }, 'width', durations.slow);

  const strip = (
    <View ref={props.stripRef} style={{ flexDirection: 'row', height: props.height ?? (props.track ? 6 : 14), alignSelf: 'stretch' }}>
      <View style={[half, { justifyContent: 'flex-end' }, props.track && { borderRightWidth: strokes.ink, borderColor: colors.ink, backgroundColor: colors.tint }]}>
        <View style={[grow, { width: props.amount < 0 ? width : '0%', backgroundColor: colors.alert }]} />
      </View>
      <View style={[half, props.track && { backgroundColor: colors.tint }]}>
        <View style={[grow, { width: props.amount > 0 ? width : '0%', backgroundColor: colors.positive }]} />
      </View>
    </View>
  );

  if (props.track) return <View aria-hidden>{strip}</View>;

  return (
    <View aria-hidden style={{ height: '100%', alignSelf: 'stretch', justifyContent: 'center' }}>
      {strip}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: strokes.ink, marginLeft: -strokes.ink, backgroundColor: colors.ink }} />
    </View>
  );
}
