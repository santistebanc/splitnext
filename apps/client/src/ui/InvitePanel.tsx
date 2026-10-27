import { Platform, Text, View } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, s } from './components';
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

/**
 * The invite link, opened in place under the group's name: the link between
 * two rules, shown without `https://` but copied and shared with it, then Copy
 * link beside Replace link. Replacing asks first in the
 * same place, because the old link stops working.
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

  return (
    <View role="region" aria-label="Invite people" style={{ gap: 12, paddingTop: 4, paddingBottom: 8 }}>
      <View style={{ paddingVertical: 14, borderTopWidth: 1.5, borderBottomWidth: 1, borderTopColor: colors.ink, borderBottomColor: colors.rule }}>
        {link ? (
          <Text testID="invite-link" nativeID={linkId} selectable style={{ fontFamily: monoFamily, fontSize: 15, lineHeight: 21, fontWeight: '500', color: colors.ink }}>
            {link.replace(/^https?:\/\//, '')}
          </Text>
        ) : (
          <Text style={s.lead}>No invite link yet</Text>
        )}
      </View>
      {confirming ? (
        <View style={{ gap: 10 }}>
          <Text style={[s.body, { fontWeight: '500' }]}>{confirming.message}</Text>
          <View style={s.actions}>
            <Button grow secondary disabled={replace.busy} onPress={replace.cancel}>Cancel</Button>
            <Button grow disabled={replace.busy} onPress={confirming.confirm}>{replace.busy ? 'Replacing…' : 'Replace'}</Button>
          </View>
        </View>
      ) : (
        <View style={s.actions}>
          {link ? (
            <Button
              grow
              label={copied ? 'Link copied' : 'Copy link'}
              disabled={!action.can('copyInviteLink')}
              onPress={() => {
                selectLink();
                void action.call('copyInviteLink', {});
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          ) : null}
          {link && canShare ? (
            <Button grow secondary label="Share link" disabled={!action.can('shareInviteLink')} onPress={() => { void action.call('shareInviteLink', {}); }}>
              Share
            </Button>
          ) : null}
          <Button grow secondary disabled={!replace.can('regenerateInvite')} onPress={() => { void replace.call('regenerateInvite', {}); }}>
            Replace link
          </Button>
        </View>
      )}
      {!online && !confirming ? <Text style={s.caption}>Connect to replace the link.</Text> : null}
      <ErrorMessage message={replace.error ?? action.error} />
    </View>
  );
}
