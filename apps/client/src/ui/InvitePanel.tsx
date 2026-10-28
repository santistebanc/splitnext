import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, s } from './components';
import { RefreshIcon, ShareIcon } from './icons';
import { colors, monoFamily } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type InvitePanelApp = Pick<AppController, 'snapshot'>;

/** Selects the link's text on the web, so copying shows what was copied. */
function selectLink(): void {
  if (Platform.OS !== 'web') return;

  const node = document.getElementById(linkId);
  const selection = window.getSelection();

  if (node && selection) selection.selectAllChildren(node);
}

const linkId = 'invite-link-text';

/** A square icon action beside the link. */
function LinkAction(props: { label: string; disabled: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed && s.pressed, props.disabled && s.dim]}
    >
      {props.children}
    </Pressable>
  );
}

/**
 * The invite link, opened in place under the group's name, between two rules:
 * Share on its left where the device can share, Replace on its right, and the
 * link itself, shown without `https://`, which tapping highlights and copies
 * with it. Replacing asks first in the same place, because the old link stops
 * working.
 */
export function InvitePanel(props: { app: InvitePanelApp }) {
  const replica = props.app.snapshot().group;
  const invite = replica?.projected_snapshot?.invite;
  const copied = useUiState().copiedInviteId === invite?.id;
  const canShare = useActions().capabilities.shareLink;
  const action = useActionCall();
  const replace = useActionCall();
  const online = props.app.snapshot().online;
  const confirming = replace.confirmation;

  const link =
    invite && replica
      ? formatInviteLink(window.location.origin, replica.group_id, invite.token)
      : null;

  const shown = link?.replace(/^https?:\/\//, '') ?? '';
  // The link stays on one line, smaller where it would not fit: its code is
  // at the end, so cutting it short would hide the part that matters. A
  // monospaced character takes about 0.6 of the size across.
  const [room, setRoom] = useState(0);
  const linkSize = room && shown ? Math.min(15, room / (shown.length * 0.6)) : 15;

  return (
    <View role="region" aria-label="Invite people" style={{ gap: 8, paddingTop: 4, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 56, borderTopWidth: 1.5, borderBottomWidth: 1, borderTopColor: colors.ink, borderBottomColor: colors.rule }}>
        {link && canShare ? (
          <View style={{ marginLeft: -12 }}>
            <LinkAction label="Share link" disabled={!action.can('shareInviteLink')} onPress={() => { void action.call('shareInviteLink', {}); }}>
              <ShareIcon size={18} />
            </LinkAction>
          </View>
        ) : null}
        {link ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
            disabled={!action.can('copyInviteLink')}
            onPress={() => {
              selectLink();
              void action.call('copyInviteLink', {});
            }}
            onLayout={(event) => setRoom(event.nativeEvent.layout.width)}
            style={({ pressed }) => [{ flex: 1, minWidth: 0, paddingVertical: 14 }, pressed && s.pressed]}
          >
            <Text testID="invite-link" nativeID={linkId} selectable numberOfLines={1} style={{ fontFamily: monoFamily, fontSize: linkSize, lineHeight: 21, fontWeight: '500', color: colors.ink }}>
              {shown}
            </Text>
          </Pressable>
        ) : (
          <Text style={[s.lead, { flex: 1, paddingVertical: 14 }]}>No invite link yet</Text>
        )}
        <View style={{ marginRight: -12 }}>
          <LinkAction label="Replace link" disabled={Boolean(confirming) || !replace.can('regenerateInvite')} onPress={() => { void replace.call('regenerateInvite', {}); }}>
            <RefreshIcon size={18} />
          </LinkAction>
        </View>
      </View>
      {link && copied && !confirming ? <Text accessibilityLiveRegion="polite" style={[s.caption, { color: colors.ink }]}>✓ Copied</Text> : null}
      {confirming ? (
        <View style={{ gap: 10, paddingTop: 4 }}>
          <Text style={[s.body, { fontWeight: '500' }]}>{confirming.message}</Text>
          <View style={s.actions}>
            <Button grow secondary disabled={replace.busy} onPress={replace.cancel}>Cancel</Button>
            <Button grow disabled={replace.busy} onPress={confirming.confirm}>{replace.busy ? 'Replacing…' : 'Replace'}</Button>
          </View>
        </View>
      ) : null}
      {!online && !confirming ? <Text style={s.caption}>Connect to replace the link.</Text> : null}
      <ErrorMessage message={replace.error ?? action.error} />
    </View>
  );
}
