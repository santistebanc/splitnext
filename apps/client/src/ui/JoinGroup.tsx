import { memberLabel, previewFromSnapshot } from '@splitnext/client';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { AppController } from '../model/controller';
import { BrandMark } from './BrandMark';
import { ErrorMessage, Field, FooterButton, Notice, PageTitle, RadioRow, Tag, errorMessage, s } from './components';
import { LinkIcon, PlusIcon } from './icons';
import { colors, fontFamily } from './theme';
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
      <FooterButton
        busy={ui.phase === 'checking' || props.previewing.busy}
        disabled={!props.previewing.can('checkInvite', { link: link || props.initialLink })}
        onPress={() => checkLink(props, link)}
      >
        {ui.phase === 'checking' || props.previewing.busy ? 'Checking…' : 'Open link'}
      </FooterButton>
    );

  const who = chosen === 'new' ? name.trim() || 'someone else' : person ? memberLabel(person.display_name, person.name_ordinal) : null;
  const busy = ui.phase === 'joining' || props.joining.busy;

  return (
    <>
      <ErrorMessage message={props.joining.error} />
      <FooterButton
        busy={busy}
        disabled={!props.joining.can('submitJoin')}
        onPress={() => {
          void props.joining.call('submitJoin', {}, props.close);
        }}
      >
        {busy ? 'Joining…' : who ? `${props.rejoining ? 'Rejoin' : 'Join'} as ${who}` : props.rejoining ? 'Rejoin group' : 'Join group'}
      </FooterButton>
    </>
  );
}

/** Before a preview: paste an invite link, or try another after one that no longer works. */
function LinkEntry(props: JoinGroupProps) {
  const ui = useUiState();
  const actions = useActions();
  const link = ui.join.link;
  const error = props.previewing.error;
  const broken = brokenLink.includes(error ?? '');

  function setLink(value: string): void {
    void actions.dispatch('changeDraft', { field: 'join.link', value }, { origin: 'ui' });
  }

  return (
    <View style={{ gap: 36, paddingHorizontal: 8 }}>
      <View style={{ gap: 16 }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: broken ? colors.danger : colors.actionSoft }}>
          <LinkIcon size={30} broken={broken} color={broken ? colors.owes : colors.action} />
        </View>
        <PageTitle>{broken ? 'This invite link doesn’t work' : 'Join a group'}</PageTitle>
        <Text style={{ fontFamily, fontSize: 16, lineHeight: 24, color: colors.soft }}>
          {broken ? 'It may have been replaced by someone in the group. Ask them for the current link.' : 'Paste the invite link someone in the group sent you.'}
        </Text>
      </View>
      {error && !broken ? <ErrorMessage message={error} /> : null}
      <Field
        label={broken ? 'Try a different link' : 'Invite link'}
        value={link}
        editable={actions.availability('changeDraft', { field: 'join.link', value: link }).available}
        onChangeText={setLink}
        placeholder="splitnext.app/j#…"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => checkLink(props, link)}
        trailing={
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              // Clipboard reads need permission and a secure page; a refusal leaves the field as it is.
              void Promise.resolve()
                .then(() => navigator.clipboard.readText())
                .then(setLink, () => undefined);
            }}
            style={({ pressed }) => [s.fieldButton, { paddingHorizontal: 16 }, pressed && s.pressed]}
          >
            <Text style={s.fieldButtonText}>Paste</Text>
          </Pressable>
        }
      />
      {!props.app.snapshot().online ? <Text style={s.caption}>You’re offline. Connect to open the link.</Text> : null}
    </View>
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
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
        <BrandMark size={28} />
        <Text style={{ flex: 1, fontFamily, fontSize: 14, color: colors.muted }}>{props.rejoining ? 'Welcome back to' : 'You’ve been invited to'}</Text>
        {!props.rejoining ? (
          <Pressable
            accessibilityRole="button"
            disabled={!props.previewing.can('clearInvitePreview')}
            onPress={() => { void props.previewing.call('clearInvitePreview', {}); }}
            style={({ pressed }) => [{ height: 44, justifyContent: 'center' }, pressed && s.pressed]}
          >
            <Text style={s.rowAction}>Change link</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ gap: 4, paddingHorizontal: 4, paddingBottom: 12 }}>
        <PageTitle>{group.name}</PageTitle>
        <Text style={{ fontFamily, fontSize: 15, color: colors.muted }}>
          {people.length === 1 ? '1 person' : `${people.length} people`} · Which one are you?
        </Text>
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel="Names" style={{ gap: 6 }}>
        <Text style={[s.eyebrow, { paddingHorizontal: 4, paddingBottom: 2 }]}>Names</Text>
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
        <View style={{ height: 4 }} />
        <RadioRow
          label="Someone else"
          selected={chosen === 'new'}
          disabled={!actions.availability('chooseJoinMember', { as: { kind: 'new' } }).available}
          onPress={() => choose({ kind: 'new' })}
          style={{ borderStyle: 'dashed', backgroundColor: colors.background }}
        >
          <PlusIcon size={18} color={colors.action} />
        </RadioRow>
      </View>
      {chosen === 'new' ? (
        <View style={{ paddingTop: 4, paddingHorizontal: 4 }}>
          <Field
            label="Your name"
            value={name}
            editable={actions.availability('changeDraft', { field: 'join.name', value: name }).available}
            onChangeText={(value) => {
              void actions.dispatch('changeDraft', { field: 'join.name', value }, { origin: 'ui' });
            }}
            maxLength={100}
            autoFocus
          />
        </View>
      ) : null}
      {person?.in_use ? (
        <Notice
          tone="warning"
          role="status"
          message={`${memberLabel(person.display_name, person.name_ordinal)} is already taken on another device. You can still continue as ${memberLabel(person.display_name, person.name_ordinal)}.`}
        />
      ) : null}
      <ErrorMessage message={props.previewing.error} />
      {!props.app.snapshot().online ? (
        <Text style={s.caption}>You’re offline. Connect to {props.rejoining ? 'rejoin' : 'join'}.</Text>
      ) : null}
    </View>
  );
}
