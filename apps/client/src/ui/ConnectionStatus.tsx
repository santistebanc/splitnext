import { Pressable, Text, View } from 'react-native';
import { colors, s } from './components';
import { WifiIcon } from './icons';
import { fontFamily } from './theme';

function saved(pending: number): string {
  return pending === 0 ? '' : pending === 1 ? ' · 1 change saved here' : ` · ${pending} changes saved here`;
}

/**
 * A short line under the group name, only while offline or when the server
 * cannot be reached, with Retry for the latter. Synced shows nothing.
 */
export function SyncStatus(props: { online: boolean; reachable: boolean; pending: number; busy: boolean; onRetry: () => void }) {
  if (props.online && props.reachable) return null;

  return (
    <View role="status" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 }}>
      <WifiIcon off size={15} color={colors.soft} strokeWidth={2} />
      <Text style={{ flexShrink: 1, fontFamily, fontSize: 13, fontWeight: '600', color: colors.soft }}>
        {props.online ? 'Can’t reach splitnext' : 'Offline'}{saved(props.pending)}
      </Text>
      {props.online ? (
        <Pressable
          accessibilityRole="button"
          disabled={props.busy}
          onPress={props.onRetry}
          style={({ pressed }) => [{ height: 32, paddingHorizontal: 6, justifyContent: 'center' }, (pressed || props.busy) && s.dim]}
        >
          <Text style={{ fontFamily, fontSize: 13, fontWeight: '600', color: colors.action }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
