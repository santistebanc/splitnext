import { useRef, useState } from 'react';
import { Platform, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import type { ClientReplicaState } from '@splitnext/client';
import { memberStatus, type ParticipantMarker } from '../model/memberPresentation';
import type { AppController } from '../model/controller';
import { ErrorMessage, colors, errorMessage, s } from './components';
import { fontFamily } from './theme';
import { useActions } from './useActionCall';

export type { ParticipantMarker } from '../model/memberPresentation';

/** The controller surface member views use, so previews can supply a fake. */
export type MemberListApp = Pick<AppController, 'snapshot'> & {
  client: Pick<AppController['client'], 'presence'>;
};

export type Replica = ClientReplicaState;

/** A member's presence: a filled dot online, a ring offline, a dashed ring when the name is not taken. */
export function MemberIcon(props: { participants: ParticipantMarker[]; size?: number }) {
  const status = memberStatus(props.participants);
  const size = props.size ?? 9;

  return (
    <View
      aria-hidden
      style={[
        s.presenceDot,
        { width: size, height: size, borderRadius: size / 2 },
        !props.participants.length
          ? s.presenceUnclaimed
          : status === 'online'
            ? s.presenceOnline
            : s.presenceOffline,
      ]}
    />
  );
}

/** "Online · taken on 2 devices", "Offline · taken on 1 device", or "Not taken on any device". */
export function presenceText(participants: ParticipantMarker[]): string {
  if (!participants.length) return 'Not taken on any device';
  const status = memberStatus(participants);
  const devices = `taken on ${participants.length === 1 ? '1 device' : `${participants.length} devices`}`;

  return `${status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Joined'} · ${devices}`;
}

/** A member-name draft; leaving the field saves it, and Enter or Escape leave it. */
export function MemberNameInput(props: {
  name: string;
  placeholder?: string;
  /** What the field is called, when its placeholder says more. */
  label?: string;
  onSave: () => void;
  /** Takes Enter, keeping focus when it returns true; without it, Enter leaves the field. */
  onSubmit?: () => boolean;
  onFocus?: () => void;
  /** Takes the typing instead of the shared member-name draft. */
  onChangeText?: ((value: string) => void) | undefined;
  autoFocus?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const actions = useActions();
  const input = useRef<TextInput>(null);

  return (
    <TextInput
      ref={input}
      accessibilityLabel={props.label ?? props.placeholder ?? 'Member name'}
      placeholder={props.placeholder}
      placeholderTextColor={colors.muted}
      value={props.name}
      onFocus={props.onFocus}
      onChangeText={(value) => {
        if (props.onChangeText) props.onChangeText(value);
        else void actions.dispatch('changeDraft', { field: 'member.name', value }, { origin: 'ui' });
      }}
      autoFocus={props.autoFocus}
      maxLength={100}
      style={props.style ?? s.memberNameInput}
      returnKeyType="done"
      submitBehavior={props.onSubmit ? 'submit' : 'blurAndSubmit'}
      onBlur={props.onSave}
      onSubmitEditing={() => {
        if (!props.onSubmit?.()) input.current?.blur();
      }}
      onKeyPress={(event) => {
        if (event.nativeEvent.key === 'Escape') input.current?.blur();

        // React Native Web ignores submitBehavior and blurs on Enter, unless
        // the key is handled here first.
        if (Platform.OS === 'web' && props.onSubmit && event.nativeEvent.key === 'Enter') {
          event.preventDefault();

          if (!props.onSubmit()) input.current?.blur();
        }
      }}
    />
  );
}

/**
 * The last row of the balances: typing a name adds that person once typing
 * ends, without a confirm step. The field keeps its own text. Enter queues
 * the name and clears the field while it keeps focus, so several people can
 * be added in a row; Enter on an empty field, or leaving it, finishes. The
 * next name can be typed while earlier ones are still saving; a save holds
 * the member editor, which would otherwise drop that typing.
 */
export function AddPersonRow() {
  const actions = useActions();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<string[]>([]);
  const draining = useRef(false);
  const focused = useRef(false);

  /** Queues the typed name, if any, and clears the field. */
  function take(): boolean {
    const name = text.trim();

    setText('');

    if (!name) return false;
    queue.current.push(name);
    void drain();

    return true;
  }

  /** Opens an add, which hides Add expense while the field is in use; skipped while a save holds the editor. */
  function begin(): void {
    if (actions.ui.snapshot().memberEdit === null) void actions.dispatch('beginAddMember', {}, { origin: 'ui' });
  }

  /** Adds the queued names one at a time, each through its own add, draft, and save. */
  async function drain(): Promise<void> {
    if (draining.current) return;
    draining.current = true;

    try {
      while (queue.current.length) {
        const name = queue.current[0] ?? '';
        // An add opened by focusing the field is used as is.
        const open = actions.ui.snapshot().memberEdit?.memberId === null;

        const steps = [
          ...(open ? [] : [() => actions.dispatch('beginAddMember', {}, { origin: 'ui' })]),
          () => actions.dispatch('changeDraft', { field: 'member.name', value: name }, { origin: 'ui' }),
          () => actions.dispatch('saveMemberEdit', {}, { origin: 'ui' }),
        ];

        for (const step of steps) {
          const outcome = await step();

          if (outcome.status === 'failed') {
            // Keeps the names that did not save, unless a new one is being typed.
            setError(errorMessage(new Error(outcome.error)));
            setText((current) => current || queue.current.join(', '));
            queue.current = [];

            return;
          }
        }

        queue.current.shift();
      }
    } finally {
      draining.current = false;

      if (focused.current) begin();
    }
  }

  return (
    <View>
      <View style={[s.ruled, { flexDirection: 'row', alignItems: 'center', minHeight: 52 }]}>
        <MemberNameInput
          name={text}
          placeholder="+ Add a person"
          label="Add a person"
          onChangeText={(value) => {
            setText(value);
            setError(null);
          }}
          onFocus={() => {
            focused.current = true;

            if (!draining.current) begin();
          }}
          onSubmit={take}
          onSave={() => {
            focused.current = false;

            if (!take() && !draining.current && actions.ui.snapshot().memberEdit?.memberId === null) {
              void actions.dispatch('cancelMemberEdit', {}, { origin: 'ui' });
            }
          }}
          style={{ flex: 1, minWidth: 0, height: 52, paddingHorizontal: 0, borderWidth: 0, backgroundColor: 'transparent', fontFamily, fontSize: 15, fontWeight: '500', color: colors.ink }}
        />
      </View>
      <ErrorMessage message={error} />
    </View>
  );
}
