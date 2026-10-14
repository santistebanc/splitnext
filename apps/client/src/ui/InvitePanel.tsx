import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatInviteLink } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { ConfirmBanner } from './ConfirmBanner';
import { Button, ErrorMessage, Field, s, useAction } from './components';
import { useActionCall } from './useActionCall';

export type InvitePanelApp = Pick<AppController, 'snapshot'>;

type InvitePanelProps = { app: InvitePanelApp; close: () => void };

/** The group's single invite link, with copy, share, and replacement. */
export function InvitePanel(props: InvitePanelProps) {
  const replica = props.app.snapshot().group;
  const invite = replica?.projected_snapshot?.invite;
  const [copied, setCopied] = useState(false);
  const canShare = 'share' in navigator;
  // Copying and sharing stay local; replacing the link is an app action.
  const action = useAction();
  const replace = useActionCall();
  const online = props.app.snapshot().online;

  const link =
    invite && replica
      ? formatInviteLink(window.location.origin, replica.group_id, invite.token)
      : null;

  // A replaced link has not been copied yet.
  useEffect(() => setCopied(false), [link]);

  async function copy(): Promise<void> {
    if (!link) return;

    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  async function share(): Promise<void> {
    if (!link) return;

    if (!navigator.share) {
      await copy();

      return;
    }

    try {
      await navigator.share({
        title: `Join ${replica?.projected_snapshot?.group.name ?? 'our group'}`,
        url: link,
      });
    } catch (cause) {
      if (!(cause instanceof Error) || cause.name !== 'AbortError') throw cause;
    }
  }

  return (
    <>
      <View style={s.between}>
        <Text accessibilityRole="header" style={s.heading}>
          Invite your people
        </Text>
        <Button quiet onPress={props.close}>
          Done
        </Button>
      </View>
      {link ? (
        <Field
          label="Invite link"
          value={link}
          editable={false}
          selectTextOnFocus
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
              accessibilityState={{ disabled: action.busy }}
              disabled={action.busy}
              onPress={() => {
                void action.run(copy);
              }}
              style={({ pressed }) => [
                s.copyButton,
                (pressed || action.busy) && s.dim,
              ]}
            >
              {copied ? (
                <Text accessibilityLiveRegion="polite" style={s.copiedIcon}>
                  ✓
                </Text>
              ) : (
                <View accessible={false} style={s.copyIcon}>
                  <View style={s.copyBack} />
                  <View style={s.copyFront} />
                </View>
              )}
            </Pressable>
          }
        />
      ) : null}
      <View style={s.row}>
        {link && canShare ? (
          <Button
            disabled={action.busy}
            onPress={() => {
              void action.run(share);
            }}
          >
            Share link
          </Button>
        ) : null}
        {!replace.confirmation ? (
          <Button
            secondary={Boolean(link && canShare)}
            disabled={action.busy || replace.busy || !online}
            onPress={() => {
              void replace.call('replaceInviteLink', {});
            }}
          >
            {replace.busy ? 'Replacing…' : 'New link'}
          </Button>
        ) : null}
      </View>
      {replace.confirmation ? (
        <ConfirmBanner
          message={replace.confirmation.message}
          confirmLabel="Replace link"
          danger
          busy={replace.busy}
          onConfirm={replace.confirmation.confirm}
          onCancel={replace.cancel}
        />
      ) : null}
      <ErrorMessage message={replace.error} />
      {!online ? (
        <Text style={s.caption}>Offline · connect to make a new link</Text>
      ) : null}
      <ErrorMessage message={action.error} />
    </>
  );
}
