import { useRef, useState, type ReactNode } from 'react';
import { Platform, View, type Text as NativeText } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import { ErrorMessage, IconButton, RefreshIcon, Row, ShareIcon, Stack, Text, Touchable, colors, sizes, strokes } from '../design';
import { Confirmation } from './ConfirmSheet';
import type { AppController } from '../model/controller';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type InvitePanelApp = Pick<AppController, 'snapshot'>;

/** Selects the link's text on the web, so copying shows what was copied. */
function selectLink(node: NativeText | null): void {
  // On the web a text ref is its element.
  if (Platform.OS !== 'web' || !(node instanceof Node)) return;

  window.getSelection()?.selectAllChildren(node);
}

/** A square icon action beside the link. */
function LinkAction(props: { label: string; disabled: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <IconButton label={props.label} disabled={props.disabled} onPress={props.onPress}>
      {props.children}
    </IconButton>
  );
}

/**
 * The invite link, opened in place under the group's name, between two rules:
 * Share on its left where the device can share, Regenerate on its right, and
 * the link itself, shown without `https://`, which tapping highlights and
 * copies with it. Regenerating asks first in the same place, because the old
 * link stops working.
 */
export function InvitePanel(props: { app: InvitePanelApp }) {
  const replica = props.app.snapshot().group;
  const invite = replica?.projected_snapshot?.invite;
  const copied = useUiState().copiedInviteId === invite?.id;
  const actions = useActions();
  const canShare = actions.capabilities.shareLink;
  const linkText = useRef<NativeText>(null);
  const action = useActionCall();
  const replace = useActionCall();
  const online = props.app.snapshot().online;
  const confirming = replace.confirmation;

  const link =
    invite && replica
      ? formatInviteLink(actions.appUrl, replica.group_id, invite.token)
      : null;

  const shown = link?.replace(/^https?:\/\//, '') ?? '';
  // The link stays on one line, smaller where it would not fit: its code is
  // at the end, so cutting it short would hide the part that matters. A
  // monospaced character takes about 0.6 of the size across.
  const [room, setRoom] = useState(0);
  const linkSize = room && shown ? Math.min(15, room / (shown.length * 0.6)) : 15;

  return (
    <Stack role="region" aria-label="Invite people" gap={8} paddingTop={4}>
      <Row gap={4} style={{ minHeight: sizes.row, borderTopWidth: strokes.ink, borderBottomWidth: strokes.hairline, borderTopColor: colors.ink, borderBottomColor: colors.rule }}>
        {link && canShare ? (
          <View style={{ marginLeft: -12 }}>
            <LinkAction label="Share link" disabled={!action.can('shareInviteLink')} onPress={() => { void action.call('shareInviteLink', {}); }}>
              <ShareIcon size={18} />
            </LinkAction>
          </View>
        ) : null}
        {link ? (
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
            disabled={!action.can('copyInviteLink')}
            onPress={() => {
              selectLink(linkText.current);
              void action.call('copyInviteLink', {});
            }}
            onLayout={(event) => setRoom(event.nativeEvent.layout.width)}
            style={{ flex: 1, minWidth: 0, paddingVertical: 14 }}
          >
            <Text ref={linkText} testID="invite-link" selectable numberOfLines={1} variant="figure" style={{ fontSize: linkSize, lineHeight: 21 }}>
              {shown}
            </Text>
          </Touchable>
        ) : (
          <Text variant="body" tone="muted" style={{ flex: 1, paddingVertical: 14 }}>No invite link yet</Text>
        )}
        <View style={{ marginRight: -12 }}>
          <LinkAction label="Regenerate link" disabled={Boolean(confirming) || !replace.can('regenerateInvite')} onPress={() => { void replace.call('regenerateInvite', {}); }}>
            <RefreshIcon size={18} />
          </LinkAction>
        </View>
      </Row>
      {link && copied && !confirming ? <Text accessibilityLiveRegion="polite" variant="caption">✓ Copied</Text> : null}
      {confirming ? (
        <Confirmation message={confirming.message} confirmLabel={replace.busy ? 'Regenerating…' : 'Regenerate'} busy={replace.busy} onConfirm={confirming.confirm} onCancel={replace.cancel} />
      ) : null}
      {!online && !confirming ? <Text variant="caption" tone="muted">Connect to regenerate the link.</Text> : null}
      <ErrorMessage message={replace.error ?? action.error} />
    </Stack>
  );
}
