import type { ReactNode } from 'react';
import { View, type DimensionValue } from 'react-native';
import { AlertIcon, WarningIcon } from './icons';
import { Text } from './Text';
import { colors, radii, strokes } from './tokens';

const noticeTones = {
  /** Something to know that is not a failure, such as a name already taken. */
  info: { surface: colors.tint, edge: colors.ink, ink: colors.ink },
  danger: { surface: colors.dangerSurface, edge: colors.danger, ink: colors.danger },
} as const;

/**
 * A message with a colored edge at its start: ink for something to know,
 * orange for a failure. It shows its message, or richer content such as a button.
 */
export function Notice(props: { message?: string | undefined; children?: ReactNode | undefined; tone: keyof typeof noticeTones; icon?: ReactNode | undefined; role?: 'alert' | 'status' }) {
  const tone = noticeTones[props.tone];

  return (
    <View
      role={props.role}
      accessibilityLiveRegion={props.role ? 'polite' : undefined}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderLeftWidth: strokes.marker, borderColor: tone.edge, backgroundColor: tone.surface }}
    >
      {props.icon ?? (props.tone === 'info' ? <WarningIcon color={tone.ink} /> : <AlertIcon color={tone.ink} />)}
      {props.message ? <Text variant="caption" weight="semibold" color={tone.ink} style={{ flex: 1 }}>{props.message}</Text> : null}
      {props.children}
    </View>
  );
}

/** A failure, as a danger notice; nothing while there is none. */
export function ErrorMessage(props: { message: string | null }) {
  return props.message ? <Notice tone="danger" role="alert" message={props.message} /> : null;
}

/** A quiet empty state, ruled above: a short title and one line of guidance. */
export function EmptyState(props: { title: string; text?: string | undefined; tone?: 'settled' | undefined }) {
  return (
    <View style={{ paddingVertical: 16, gap: 4, borderTopWidth: strokes.hairline, borderColor: colors.rule }}>
      <Text variant="headline" tone={props.tone === 'settled' ? 'owed' : 'ink'}>{props.tone === 'settled' ? '✓ ' : ''}{props.title}</Text>
      {props.text ? <Text variant="body" tone="muted">{props.text}</Text> : null}
    </View>
  );
}

/** A small label beside a name, such as Taken, you, or new, which asks for attention. */
export function Tag(props: { children: string; tone?: 'neutral' | 'warning' }) {
  return props.tone === 'warning'
    ? <Text variant="meta" tone="danger" weight="semibold">{props.children}</Text>
    : <Text variant="meta" tone="muted">{props.children}</Text>;
}

/** The quiet “you” beside the member this device is. */
export function YouBadge() {
  return <Tag>you</Tag>;
}

/** A count of what needs attention, in a round badge ringed in the page color. */
export function CountBadge(props: { count: number; testID?: string | undefined }) {
  return (
    <View aria-hidden style={{ minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: radii.round, borderWidth: 2, borderColor: colors.background, backgroundColor: colors.alert }}>
      <Text testID={props.testID} variant="count" tone="inverse">{props.count}</Text>
    </View>
  );
}

/**
 * A small round mark: filled, a ring, or a dashed ring, as for someone online,
 * offline, or a name no device has taken.
 */
export function Dot(props: { color: string; size?: number | undefined; outline?: 'solid' | 'dashed' | undefined; label?: string | undefined }) {
  const size = props.size ?? 7;

  return (
    <View
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={!props.label}
      style={[
        { width: size, height: size, borderRadius: size / 2 },
        props.outline ? { borderWidth: strokes.ink, borderColor: props.color, borderStyle: props.outline } : { backgroundColor: props.color },
      ]}
    />
  );
}

/** A grey block standing in for content that is still loading. */
export function Skeleton(props: { width: DimensionValue; height: number; radius?: number | undefined }) {
  return <View style={{ width: props.width, height: props.height, borderRadius: props.radius, backgroundColor: colors.tint }} />;
}
