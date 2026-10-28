import { Platform, Pressable, Text, View } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, s } from './components';
import { Confirmation } from './ConfirmSheet';
import { Drawer } from './Drawer';
import { CheckIcon, ShareIcon } from './icons';
import { colors, fontFamily, monoFamily, radius } from './theme';
import { useActionCall, useActions, useUiState } from './useActionCall';

export type InvitePanelApp = Pick<AppController, 'snapshot'>;

/** Selects the link's text on the web, so tapping it shows what was copied. */
function selectLink(): void {
  if (Platform.OS !== 'web') return;

  const node = document.getElementById(linkId);
  const selection = window.getSelection();

  if (node && selection) selection.selectAllChildren(node);
}

const linkId = 'invite-link-text';

/**
 * The invite link in a drawer over the group: tapping the link selects
 * and copies it; Share and Regenerate sit side by side, and replacing asks
 * first in the same sheet because the old link stops working.
 */
export function InviteSheet(props: { app: InvitePanelApp }) {
  const replica = props.app.snapshot().group;
  const invite = replica?.projected_snapshot?.invite;
  const copied = useUiState().copiedInviteId === invite?.id;
  const canShare = useActions().capabilities.shareLink;
  const action = useActionCall();
  const replace = useActionCall();
  const close = useActionCall();
  const online = props.app.snapshot().online;
  const confirming = replace.confirmation;

  const link =
    invite && replica
      ? formatInviteLink(window.location.origin, replica.group_id, invite.token)
      : null;

  function dismiss(): void {
    if (confirming) replace.cancel();
    else void close.call('closePanel', {});
  }

  const title = confirming ? 'Regenerate invite link?' : 'Invite people';

  return (
    <Drawer title={title} onClose={dismiss}>

      {confirming ? (
        <Confirmation message={confirming.message} confirmLabel="Regenerate" busy={replace.busy} onConfirm={confirming.confirm} onCancel={replace.cancel} />
      ) : (
        <>
          {link ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
              disabled={!action.can('copyInviteLink')}
              onPress={() => {
                selectLink();
                void action.call('copyInviteLink', {});
              }}
              style={{ gap: 6 }}
            >
              <Text
                testID="invite-link"
                nativeID={linkId}
                selectable
                style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.control, borderWidth: 1, borderColor: copied ? colors.action : colors.background, backgroundColor: colors.background, fontFamily: monoFamily, fontSize: 15, fontWeight: '500', color: colors.ink }}
              >
                {link}
              </Text>
              <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
                {copied ? <CheckIcon size={14} color={colors.action} strokeWidth={2.4} /> : null}
                <Text style={{ fontFamily, fontSize: 13, fontWeight: copied ? '600' : '400', color: copied ? colors.action : colors.muted }}>
                  {copied ? 'Copied' : action.can('copyInviteLink') ? 'Tap the link to copy it' : 'Select the link to copy it'}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Text style={{ fontFamily, fontSize: 15, color: colors.muted }}>No invite link yet</Text>
          )}
          <View style={s.actions}>
            {link && canShare ? (
              <Button
                grow
                label="Share link"
                icon={<ShareIcon size={18} color={colors.actionInk} />}
                disabled={!action.can('shareInviteLink')}
                onPress={() => { void action.call('shareInviteLink', {}); }}
              >
                Share
              </Button>
            ) : null}
            <Button grow secondary disabled={!replace.can('regenerateInvite')} onPress={() => { void replace.call('regenerateInvite', {}); }}>
              {replace.busy ? 'Regenerating…' : 'Regenerate'}
            </Button>
          </View>
          {!online ? <Text style={s.caption}>Connect to regenerate the link.</Text> : null}
        </>
      )}
      <ErrorMessage message={replace.error ?? action.error ?? close.error} />
    </Drawer>
  );
}
