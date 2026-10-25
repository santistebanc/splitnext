import { Platform, Pressable, Text, View } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, s } from './components';
import { Drawer } from './Drawer';
import { CheckIcon, ShareIcon } from './icons';
import { colors, fontFamily, monoFamily } from './theme';
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
 * and copies it; Share and Replace link sit side by side, and replacing asks
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

  const title = confirming ? 'Replace invite link?' : 'Invite people';

  return (
    <Drawer title={title} onClose={dismiss}>

      {confirming ? (
        <>
          <Text style={{ fontFamily, fontSize: 15, lineHeight: 22, color: colors.soft }}>{confirming.message}</Text>
          <View style={s.actions}>
            <Button grow secondary disabled={replace.busy} onPress={replace.cancel}>Cancel</Button>
            <Button grow dark disabled={replace.busy} onPress={confirming.confirm}>Replace link</Button>
          </View>
        </>
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
                style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: copied ? colors.action : colors.background, backgroundColor: colors.background, fontFamily: monoFamily, fontSize: 15, fontWeight: '500', color: colors.ink }}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share link"
                disabled={!action.can('shareInviteLink')}
                onPress={() => { void action.call('shareInviteLink', {}); }}
                style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 12, backgroundColor: colors.action }, pressed && s.dim]}
              >
                <ShareIcon size={18} color={colors.actionInk} />
                <Text style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.actionInk }}>Share</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={!replace.can('regenerateInvite')}
              onPress={() => { void replace.call('regenerateInvite', {}); }}
              style={({ pressed }) => [{ flex: 1, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.field, backgroundColor: colors.surface }, (pressed || !replace.can('regenerateInvite')) && s.dim]}
            >
              <Text style={{ fontFamily, fontSize: 15, fontWeight: '600', color: colors.ink }}>{replace.busy ? 'Replacing…' : 'Replace link'}</Text>
            </Pressable>
          </View>
          {!online ? <Text style={s.caption}>Connect to replace the link.</Text> : null}
        </>
      )}
      <ErrorMessage message={replace.error ?? action.error ?? close.error} />
    </Drawer>
  );
}
