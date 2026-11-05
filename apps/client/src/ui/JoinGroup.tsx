import { memberLabel, previewFromSnapshot } from '@splitnext/client';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Button, ErrorMessage, Field, Input, Notice, RadioMark, RadioRow, Row, Stack, Tag, Text, TextButton, Touchable, rules, sizes, titleStyle } from '../design';
import type { AppController } from '../model/controller';
import { errorMessage } from './errors';
import { useScreenHost } from './screenHost';
import { useActions, useUiState, type useActionCall } from './useActionCall';

export type JoinGroupApp = Pick<AppController, 'snapshot'>;

/** The two calls the join screen's body and its pinned button share. */
export type JoinCalls = { previewing: ReturnType<typeof useActionCall>; joining: ReturnType<typeof useActionCall> };

type JoinGroupProps = JoinCalls & {
  app: JoinGroupApp;
  close?: () => void;
  rejoining: boolean;
  initialLink: string;
};

/** The people of the invited or left group, and who this device has chosen to be. */
function useJoinChoice(props: { app: JoinGroupApp; rejoining: boolean }) {
  const { preview, chosen, name } = useUiState().join;
  const replica = props.app.snapshot().group;
  const rejoinSnapshot = props.rejoining ? replica?.projected_snapshot : null;
  const group = rejoinSnapshot?.group ?? preview?.group;
  const people = (rejoinSnapshot ? previewFromSnapshot(rejoinSnapshot).members : preview?.members) ?? [];
  const person = people.find((entry) => entry.id === chosen);

  return { group, people, person, chosen, name };
}

/** Messages that mean the link itself no longer leads to a group. */
const brokenLink = ['invite_invalid', 'invite_replaced', 'invite_required'].map((code) => errorMessage(new Error(code)));

function checkLink(props: Pick<JoinGroupProps, 'previewing' | 'initialLink' | 'close'>, link: string): void {
  void props.previewing.call('checkInvite', { link: link || props.initialLink }, (result) => {
    if (result.opened) props.close?.();
  });
}

/** The join screen's pinned button: Open link before a preview, then Join as the chosen name. */
export function JoinGroupFooter(props: JoinGroupProps) {
  const ui = useUiState();
  const { group, person, chosen, name } = useJoinChoice(props);
  const link = ui.join.link;

  if (!group)
    return (
      <Button
       
        busy={ui.phase === 'checking' || props.previewing.busy}
        disabled={!props.previewing.can('checkInvite', { link: link || props.initialLink })}
        onPress={() => checkLink(props, link)}
      >
        {ui.phase === 'checking' || props.previewing.busy ? 'Checking…' : 'Open link'}
      </Button>
    );

  const who = chosen === 'new' ? name.trim() || 'someone else' : person ? memberLabel(person.display_name, person.name_ordinal) : null;
  const busy = ui.phase === 'joining' || props.joining.busy;

  return (
    <>
      <ErrorMessage message={props.joining.error} />
      <Button
       
        busy={busy}
        disabled={!props.joining.can('submitJoin')}
        onPress={() => {
          void props.joining.call('submitJoin', {}, props.close);
        }}
      >
        {busy ? 'Joining…' : who ? `${props.rejoining ? 'Rejoin' : 'Join'} as ${who}` : props.rejoining ? 'Rejoin group' : 'Join group'}
      </Button>
    </>
  );
}

/** Before a preview: paste an invite link, or try another after one that no longer works. */
function LinkEntry(props: JoinGroupProps) {
  const ui = useUiState();
  const actions = useActions();
  const host = useScreenHost();
  const link = ui.join.link;
  const error = props.previewing.error;
  const broken = brokenLink.includes(error ?? '');

  function setLink(value: string): void {
    void actions.dispatch('changeDraft', { field: 'join.link', value }, { origin: 'ui' });
  }

  return (
    <Stack gap={32} paddingTop={8}>
      <Stack gap={12}>
        <Text accessibilityRole="header" style={titleStyle(0)}>{broken ? 'This invite link doesn’t work' : 'Join a group'}</Text>
        <Text variant="body" tone="muted">
          {broken ? 'It may have been replaced by someone in the group. Ask them for the current link.' : 'Paste the invite link someone in the group sent you.'}
        </Text>
      </Stack>
      {error && !broken ? <ErrorMessage message={error} /> : null}
      <Field
        label={broken ? 'Try a different link' : 'Invite link'}
        value={link}
        editable={actions.availability('changeDraft', { field: 'join.link', value: link }).available}
        onChangeText={setLink}
        placeholder="Paste invite link"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => checkLink(props, link)}
        trailing={
          <Button
            size="compact"
            onPress={() => {
              // Clipboard reads need permission and a secure page; a refusal leaves the field as it is.
              void Promise.resolve()
                .then(() => (host ? host.readClipboard() : navigator.clipboard.readText()))
                .then(setLink, () => undefined);
            }}
          >
            Paste
          </Button>
        }
      />
      {!props.app.snapshot().online ? <Text variant="caption" tone="muted">You’re offline. Connect to open the link.</Text> : null}
    </Stack>
  );
}

/** Preview an invite, or a left group, and choose who you are in it. */
export function JoinGroup(props: JoinGroupProps) {
  const actions = useActions();
  const { group, people, person, chosen, name } = useJoinChoice(props);
  const ordered = [...people].sort((left, right) => Number(left.in_use) - Number(right.in_use));

  useEffect(() => {
    if (props.rejoining && actions.ui.snapshot().view !== 'rejoin')
      void actions.dispatch('showRejoin', {}, { origin: 'lifecycle' });

    if (props.initialLink && !props.rejoining) checkLink(props, '');
  }, []);

  if (!group) return <LinkEntry {...props} />;

  function choose(as: { kind: 'existing'; memberId: string } | { kind: 'new' }): void {
    void actions.dispatch('chooseJoinMember', { as }, { origin: 'ui' });
  }

  return (
    <Stack gap={8} paddingTop={8}>
      <Row gap={12}>
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>{props.rejoining ? 'Welcome back to' : 'You’ve been invited to'}</Text>
        {!props.rejoining ? (
          <TextButton size="small" disabled={!props.previewing.can('clearInvitePreview')} onPress={() => { void props.previewing.call('clearInvitePreview', {}); }}>
            Change link
          </TextButton>
        ) : null}
      </Row>
      <Stack gap={12} paddingBottom={24}>
        <Text accessibilityRole="header" style={titleStyle(0)}>{group.name}</Text>
        <Text variant="body" tone="muted">
          {people.length === 1 ? '1 person' : `${people.length} people`} · Which one are you?
        </Text>
      </Stack>

      <View accessibilityRole="radiogroup" accessibilityLabel="Names" style={rules.below}>
        {ordered.map((entry) => {
          const label = memberLabel(entry.display_name, entry.name_ordinal);

          return (
            <RadioRow
              key={entry.id}
              label={label}
              accessibilityLabel={`${label}${entry.in_use ? ', taken' : ''}`}
              selected={chosen === entry.id}
              disabled={!actions.availability('chooseJoinMember', { as: { kind: 'existing', memberId: entry.id } }).available}
              onPress={() => choose({ kind: 'existing', memberId: entry.id })}
            >
              {entry.in_use ? <Tag>Taken</Tag> : null}
            </RadioRow>
          );
        })}
        <Row gap={12} style={[{ minHeight: sizes.row }, rules.above]}>
          <Touchable
            accessibilityRole="radio"
            accessibilityLabel="Someone else"
            accessibilityState={{ checked: chosen === 'new' }}
            aria-checked={chosen === 'new'}
            disabled={!actions.availability('chooseJoinMember', { as: { kind: 'new' } }).available}
            feedback="none"
            onPress={() => choose({ kind: 'new' })}
            style={{ width: sizes.touch, height: sizes.row, marginHorizontal: -12, alignItems: 'center', justifyContent: 'center' }}
          >
            <RadioMark selected={chosen === 'new'} />
          </Touchable>
          <Input
            accessibilityLabel="Your name"
            placeholder="Someone else"
            variant="strong"
            value={name}
            editable={actions.availability('changeDraft', { field: 'join.name', value: name }).available}
            onFocus={() => { if (chosen !== 'new') choose({ kind: 'new' }); }}
            onChangeText={(value) => {
              void actions.dispatch('changeDraft', { field: 'join.name', value }, { origin: 'ui' });
            }}
            maxLength={100}
            style={{ flex: 1, minWidth: 0, height: sizes.row, padding: 0 }}
          />
        </Row>
      </View>
      {person?.in_use ? (
        <Notice
          tone="info"
          role="status"
          message={`${memberLabel(person.display_name, person.name_ordinal)} is already taken on another device. You can still continue as ${memberLabel(person.display_name, person.name_ordinal)}.`}
        />
      ) : null}
      <ErrorMessage message={props.previewing.error} />
      {!props.app.snapshot().online ? (
        <Text variant="caption" tone="muted">You’re offline. Connect to {props.rejoining ? 'rejoin' : 'join'}.</Text>
      ) : null}
    </Stack>
  );
}
