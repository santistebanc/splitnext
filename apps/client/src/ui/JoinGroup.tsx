import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { InvitePreview } from '@splitnext/client';
import type { AppController } from '../model/controller';
import { Button, ErrorMessage, Field, s } from './components';
import { useActionCall } from './useActionCall';
import { useCompactLayout } from './useVisibleViewport';

export type JoinGroupApp = Pick<AppController, 'snapshot' | 'lastYouName'>;

type JoinGroupProps = {
  app: JoinGroupApp;
  close: () => void;
  rejoining: boolean;
  initialLink: string;
};

/** Preview an invite, or a left group, and choose who you are in it. */
export function JoinGroup(props: JoinGroupProps) {
  const mobile = useCompactLayout();
  const [link, setLink] = useState(props.initialLink);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState(() => props.app.lastYouName() ?? '');
  const previewing = useActionCall();
  const joining = useActionCall();
  const busy = previewing.busy || joining.busy;
  const online = props.app.snapshot().online;
  const replica = props.app.snapshot().group;
  const rejoinSnapshot = props.rejoining ? replica?.projected_snapshot : null;
  const group = rejoinSnapshot?.group ?? preview?.group;

  // Names already used by a current participant, matching the invite preview.
  const people =
    rejoinSnapshot?.members
      .filter((member) => member.status === 'active')
      .map((member) => ({
        id: member.id,
        display_name: member.display_name,
        in_use: rejoinSnapshot.access_grants.some(
          (grant) =>
            grant.preferred_member_id === member.id && !grant.hidden_at,
        ),
      })) ??
    preview?.members ??
    [];

  const orderedPeople = [...people].sort(
    (left, right) => Number(left.in_use) - Number(right.in_use),
  );

  function loadPreview(): void {
    void previewing.call('checkInvite', { link }, (result) => {
      if (result.opened) {
        props.close();

        return;
      }

      setPreview(result.preview);
      setToken(result.token);
      setChosen(null);
    });
  }

  useEffect(() => {
    if (props.initialLink && !props.rejoining) loadPreview();
  }, []);

  return (
    <>
      <View style={s.between}>
        <Text style={s.eyebrow}>
          {props.rejoining ? 'WELCOME BACK' : 'YOU’RE INVITED'}
        </Text>
        <View style={s.inlineActions}>
          {group && !props.rejoining ? (
            <Button
              quiet
              onPress={() => {
                setPreview(null);
                setToken(null);
                setChosen(null);
              }}
            >
              Change link
            </Button>
          ) : null}
          <Button quiet onPress={props.close}>
            ← Back
          </Button>
        </View>
      </View>
      <Text
        accessibilityRole="header"
        style={[s.title, mobile && s.mobileTitle]}
      >
        {group ? group.name : 'Join a group'}
      </Text>
      <View style={s.card}>
        {!props.rejoining && !preview ? (
          <>
            <Field
              label="Invite link"
              value={link}
              onChangeText={(text) => {
                setLink(text);
                setPreview(null);
                setToken(null);
              }}
              placeholder="https://…/join/…#…"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              secondary
              disabled={!link.trim() || busy || !online}
              onPress={loadPreview}
            >
              {previewing.busy ? 'Checking…' : 'Preview group'}
            </Button>
            <ErrorMessage message={previewing.error} />
          </>
        ) : null}
        {group ? (
          <>
            <Text style={s.heading}>Who are you?</Text>
            {orderedPeople.map((person) => (
              <Pressable
                key={person.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen === person.id }}
                aria-checked={chosen === person.id}
                accessibilityLabel={`${person.display_name}${person.in_use ? ', in use' : ''}`}
                onPress={() => setChosen(person.id)}
                style={[
                  s.choice,
                  s.between,
                  person.in_use && chosen !== person.id && s.choiceInUse,
                  chosen === person.id && s.chosen,
                ]}
              >
                <Text style={s.name}>{person.display_name}</Text>
                {person.in_use ? <Text style={s.caption}>In use</Text> : null}
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen === 'new' }}
              aria-checked={chosen === 'new'}
              onPress={() => setChosen('new')}
              style={[s.choice, chosen === 'new' && s.chosen]}
            >
              <Text style={s.name}>+ I’m someone new</Text>
            </Pressable>
            {chosen === 'new' ? (
              <Field
                label="Your name"
                value={name}
                onChangeText={setName}
                maxLength={100}
                autoFocus
              />
            ) : null}
            <Button
              disabled={
                !chosen || (chosen === 'new' && !name.trim()) || busy || !online
              }
              onPress={() => {
                if (!chosen) return;
                void joining.call(
                  'joinGroup',
                  {
                    groupId: group.id,
                    as:
                      chosen === 'new'
                        ? { kind: 'new', name }
                        : { kind: 'existing', memberId: chosen },
                    token: token ?? undefined,
                  },
                  props.close,
                );
              }}
            >
              {joining.busy
                ? 'Joining…'
                : props.rejoining
                  ? 'Rejoin group'
                  : 'Join group'}
            </Button>
            <ErrorMessage message={joining.error} />
          </>
        ) : null}
        {!online ? (
          <Text style={s.caption}>
            Offline · connect to {props.rejoining ? 'rejoin' : 'join'}
          </Text>
        ) : null}
      </View>
    </>
  );
}
