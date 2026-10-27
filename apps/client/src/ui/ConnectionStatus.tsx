import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Button, ErrorMessage, colors, s } from './components';
import { Drawer } from './Drawer';
import { WifiIcon } from './icons';
import { fontFamily } from './theme';

function saved(pending: number): string {
  return pending === 0 ? '' : pending === 1 ? ' · 1 change saved here' : ` · ${pending} changes saved here`;
}

/**
 * A thin strip above every screen's header while disconnected. Tap for details, locally saved
 * changes, and Retry when the network is available. Synced shows nothing.
 */
export function SyncStatus(props: { online: boolean; reachable: boolean; pending: number; busy: boolean; onRetry: () => void; retryError?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const connected = props.online && props.reachable;
  const label = `${props.online ? 'Can’t reach splitnext' : 'Offline'}${saved(props.pending)}`;

  useEffect(() => {
    if (connected) setExpanded(false);
  }, [connected]);

  if (connected) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. Connection details`}
        accessibilityLiveRegion="polite"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(true)}
        style={({ pressed }) => [{ minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.track }, pressed && s.pressed]}
      >
        <WifiIcon off size={14} color={colors.soft} strokeWidth={2} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily, fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.soft }}>{label}</Text>
      </Pressable>
      {expanded ? (
        <Drawer title="Connection" onClose={() => setExpanded(false)}>
          <Text role="status" accessibilityLiveRegion="polite" style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.ink }}>{label}</Text>
          <Text style={s.body}>Changes saved here sync automatically when you reconnect.</Text>
          <ErrorMessage message={props.retryError ?? null} />
          {props.online ? <Button disabled={props.busy} onPress={props.onRetry}>Retry</Button> : null}
        </Drawer>
      ) : null}
    </>
  );
}
