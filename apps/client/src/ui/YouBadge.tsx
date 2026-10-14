import { StyleSheet, Text, View } from 'react-native';
import { colors } from './components';

type YouBadgeProps = { status: 'online' | 'offline' | 'unknown' };

export function YouBadge(props: YouBadgeProps) {
  const color = props.status === 'online' ? colors.green : colors.muted;

  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text
        numberOfLines={1}
        style={[styles.label, { color }]}
      >
        YOU
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 30,
    height: 16,
    borderWidth: 1,
    borderRadius: 3,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    lineHeight: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
