import { View } from 'react-native';
import { initials } from './initials';
import { Text } from './Text';
import { avatarTints, colors, radii } from './tokens';

const avatarSizes = {
  /** Beside a name in a dense list, such as a split. */
  small: { box: 22, text: 'count' },
  /** Beside a name in a row. */
  regular: { box: 30, text: 'meta' },
  /** Leading a person's page. */
  large: { box: 56, text: 'heading' },
} as const;

export type AvatarSize = keyof typeof avatarSizes;

/**
 * A person as their initials on a soft round fill. `tint` picks the fill by
 * the person's place in the group, so they keep one colour everywhere. A
 * green dot on its shoulder marks someone online. It is decoration: the name
 * beside it is what assistive technology reads.
 */
export function Avatar(props: { name: string; tint: number; size?: AvatarSize | undefined; online?: boolean | undefined }) {
  const size = avatarSizes[props.size ?? 'regular'];
  const dot = Math.max(8, Math.round(size.box / 4));

  return (
    <View aria-hidden style={{ width: size.box, height: size.box, borderRadius: radii.round, alignItems: 'center', justifyContent: 'center', backgroundColor: avatarTints[((props.tint % avatarTints.length) + avatarTints.length) % avatarTints.length] }}>
      <Text numberOfLines={1} variant={size.text} weight="bold" color={colors.ink}>{initials(props.name)}</Text>
      {props.online ? (
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: dot, height: dot, borderRadius: radii.round, borderWidth: 2, borderColor: colors.background, backgroundColor: colors.positive }} />
      ) : null}
    </View>
  );
}
