import { useEffect, useState } from 'react';
import { Button, ErrorMessage, Text, Touchable, WifiIcon, colors, sizes } from '../design';
import { Drawer } from './Drawer';

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
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`${label}. Connection details`}
        accessibilityLiveRegion="polite"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(true)}
        style={{ minHeight: sizes.compact, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.tint }}
      >
        <WifiIcon off size={14} color={colors.muted} strokeWidth={2} />
        <Text numberOfLines={1} variant="meta" tone="muted" weight="semibold" style={{ flexShrink: 1 }}>{label}</Text>
      </Touchable>
      {expanded ? (
        <Drawer title="Connection" onClose={() => setExpanded(false)}>
          <Text role="status" accessibilityLiveRegion="polite" variant="strong">{label}</Text>
          <Text variant="body">Changes saved here sync automatically when you reconnect.</Text>
          <ErrorMessage message={props.retryError ?? null} />
          {props.online ? <Button disabled={props.busy} onPress={props.onRetry}>Retry</Button> : null}
        </Drawer>
      ) : null}
    </>
  );
}
