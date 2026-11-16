import { useRef, useState } from 'react';
import { Platform, type Text as NativeText } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import { Button, ErrorMessage, Row, ShareIcon, Stack, Text, TextButton, Touchable, colors, strokes } from '../design';
import { Confirmation } from './ConfirmSheet';
import { Drawer } from './Drawer';
import type { AppController } from '../model/controller';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type InvitePanelApp = Pick<AppController, 'snapshot'>;

/** Selects the link's text on the web, so copying shows what was copied. */
function selectLink(node: NativeText | null): void {
  // On the web a text ref is its element.
  if (Platform.OS !== 'web' || !(node instanceof Node)) return;

  window.getSelection()?.selectAllChildren(node);
}

/**
 * The invite link in a sheet opened from the People list: what the link does,
 * Share (or Copy where the device cannot share) as its main action, and the
 * link itself, shown without `https://`, which tapping highlights and copies.
 * Making a new link sits apart at the foot and asks first, because the old
 * link stops working.
 */
export function InviteSheet(props: { app: InvitePanelApp }) {
  const actions = useActions();
  const name = props.app.snapshot().group?.projected_snapshot?.group.name ?? 'the group';

  return (
    <Drawer title="Invite people" onClose={() => { void actions.dispatch('closePanel', {}, { origin: 'ui' }); }}>
      <InvitePanel app={props.app} name={name} />
    </Drawer>
  );
}

/** The sheet's content, also shown on its own in the screen catalog. */
export function InvitePanel(props: { app: InvitePanelApp; name?: string }) {
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

  function copy(): void {
    selectLink(linkText.current);
    void action.call('copyInviteLink', {});
  }

  return (
    <Stack role="region" aria-label="Invite people" gap={12}>
      <Text variant="body" tone="muted">
        Anyone with this link can join {props.name ?? 'the group'}, see its expenses and add their own. They pick their name from the people list.
      </Text>
      {link ? (
        canShare ? (
          <Button icon={<ShareIcon size={18} color={colors.background} />} disabled={!action.can('shareInviteLink')} onPress={() => { void action.call('shareInviteLink', {}); }}>
            Share link
          </Button>
        ) : (
          <Button disabled={!action.can('copyInviteLink')} onPress={copy}>{copied ? 'Copied' : 'Copy link'}</Button>
        )
      ) : null}
      {link ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
          disabled={!action.can('copyInviteLink')}
          onPress={copy}
          onLayout={(event) => setRoom(event.nativeEvent.layout.width)}
          style={{ minWidth: 0, paddingVertical: 12, borderTopWidth: strokes.hairline, borderBottomWidth: strokes.hairline, borderColor: colors.rule }}
        >
          <Text ref={linkText} testID="invite-link" selectable numberOfLines={1} variant="figure" style={{ fontSize: linkSize, lineHeight: 21 }}>
            {shown}
          </Text>
        </Touchable>
      ) : (
        <Text variant="body" tone="muted" style={{ paddingVertical: 12 }}>No invite link yet</Text>
      )}
      {link && copied && !confirming ? <Text accessibilityLiveRegion="polite" variant="caption">✓ Copied</Text> : null}
      {confirming ? (
        <Confirmation message={confirming.message} confirmLabel={replace.busy ? 'Resetting…' : 'Reset link'} busy={replace.busy} onConfirm={confirming.confirm} onCancel={replace.cancel} />
      ) : (
        <Row>
          <TextButton size="small" tone="muted" disabled={!replace.can('regenerateInvite')} onPress={() => { void replace.call('regenerateInvite', {}); }}>
            Reset link…
          </TextButton>
        </Row>
      )}
      {!online && !confirming ? <Text variant="caption" tone="muted">Connect to reset the link.</Text> : null}
      <ErrorMessage message={replace.error ?? action.error} />
    </Stack>
  );
}
