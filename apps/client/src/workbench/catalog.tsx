import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Frame } from '../ui/Frame';
import {
  Button,
  Choice,
  ErrorMessage,
  Field,
  colors,
  errorMessage,
  s,
} from '../ui/components';
import {
  MemberIcon,
  MemberList,
  type ParticipantMarker,
} from '../ui/MemberList';
import { YouBadge } from '../ui/YouBadge';
import { ActionsProvider } from '../ui/useActionCall';
import { useFakeApp, useFakeDispatcher } from './fakeApp';
import type { MemberListScenario } from './memberListFixture';
import { screenStories } from './screens';
import { defineStory, listValue, type Log, type Story } from './stories';

const statuses = ['online', 'offline', 'unknown'] as const;

const errorCodes = [
  'none',
  'client_offline',
  'group_unavailable_offline',
  'invite_invalid',
  'invite_replaced',
  'unauthorized',
  'member_removed',
  'corrupt_document',
  'upgrade_requires_connection',
  'request_failed',
] as const;

export const stories: Story[] = [
  defineStory({
    id: 'tokens-colors',
    group: 'Tokens',
    title: 'Colors',
    description: 'The shared palette from components.tsx.',
    controls: {},
    render: () => (
      <View style={s.row}>
        {Object.entries(colors).map(([name, value]) => (
          <View key={name} style={{ width: 120, gap: 6 }}>
            <View
              style={{
                height: 56,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: value,
              }}
            />
            <Text style={s.label}>{name}</Text>
            <Text style={s.caption}>{value}</Text>
          </View>
        ))}
      </View>
    ),
  }),
  defineStory({
    id: 'button',
    group: 'Inputs',
    title: 'Button',
    description: 'Primary, secondary, quiet, and danger actions.',
    controls: {
      label: { kind: 'text', default: 'Create group' },
      variant: {
        kind: 'select',
        options: ['primary', 'secondary', 'quiet', 'danger'],
        default: 'primary',
      },
      disabled: { kind: 'boolean', default: false },
      grow: {
        kind: 'boolean',
        default: false,
        hint: 'Fills the row beside a fixed-width sibling.',
      },
    },
    render: (values, log) => (
      <View style={s.actions}>
        <Button
          secondary={values.variant === 'secondary'}
          quiet={values.variant === 'quiet'}
          danger={values.variant === 'danger'}
          disabled={values.disabled}
          grow={values.grow}
          onPress={() => log('onPress')}
        >
          {values.label}
        </Button>
      </View>
    ),
  }),
  defineStory({
    id: 'choice',
    group: 'Inputs',
    title: 'Choice',
    description: 'Radio-style options; pick one to change the selection.',
    controls: {
      options: { kind: 'text', default: 'Ana, Ben, Someone new' },
      selected: { kind: 'text', default: 'Ana' },
    },
    render: (values, log) => (
      <ChoiceDemo
        options={listValue(values.options)}
        selected={values.selected}
        log={log}
      />
    ),
  }),
  defineStory({
    id: 'field',
    group: 'Inputs',
    title: 'Field',
    description: 'Labelled text input with an optional hint and inline action.',
    controls: {
      label: { kind: 'text', default: 'Your name' },
      value: { kind: 'text', default: '' },
      placeholder: { kind: 'text', default: 'Ana' },
      hint: { kind: 'text', default: 'Shown to everyone in the group.' },
      hideLabel: { kind: 'boolean', default: false },
      editable: { kind: 'boolean', default: true },
      trailing: {
        kind: 'boolean',
        default: false,
        hint: 'Adds an inline action like the invite copy button.',
      },
    },
    render: (values, log) => (
      <FieldDemo
        label={values.label}
        value={values.value}
        placeholder={values.placeholder}
        hint={values.hint}
        hideLabel={values.hideLabel}
        editable={values.editable}
        trailing={values.trailing}
        log={log}
      />
    ),
  }),
  defineStory({
    id: 'error-message',
    group: 'Feedback',
    title: 'ErrorMessage',
    description: 'User-facing copy for each known error code.',
    controls: {
      code: { kind: 'select', options: errorCodes, default: 'client_offline' },
    },
    render: (values) => (
      <ErrorMessage
        message={
          values.code === 'none' ? null : errorMessage(new Error(values.code))
        }
      />
    ),
  }),
  defineStory({
    id: 'you-badge',
    group: 'Members',
    title: 'YouBadge',
    description: "The marker for this installation's own presence.",
    controls: {
      status: { kind: 'select', options: statuses, default: 'online' },
      zoom: { kind: 'number', default: 4, min: 1, max: 10 },
    },
    render: (values) => (
      <View style={{ transform: [{ scale: values.zoom }], margin: 48 }}>
        <YouBadge status={values.status} />
      </View>
    ),
  }),
  defineStory({
    id: 'member-icon',
    group: 'Members',
    title: 'MemberIcon',
    description:
      'Person figure with one combined presence marker and a +N for extra participants.',
    controls: {
      joined: { kind: 'boolean', default: true },
      isYou: {
        kind: 'boolean',
        default: true,
        hint: "Shows the YOU badge. Switch off to preview another participant's dot.",
      },
      yourStatus: { kind: 'select', options: statuses, default: 'online' },
      others: {
        kind: 'number',
        default: 1,
        min: 0,
        max: 8,
        hint: 'Participants other than you. Set to 1 for a single presence dot.',
      },
      othersStatus: { kind: 'select', options: statuses, default: 'offline' },
      zoom: { kind: 'number', default: 3, min: 1, max: 6 },
    },
    render: (values) => {
      const participants: ParticipantMarker[] = Array.from(
        { length: values.others },
        (_, index) => ({
          identityId: `other-${index}`,
          label: `Participant ${index + 1}`,
          you: false,
          status: values.othersStatus,
        }),
      );

      if (values.isYou)
        participants.push({
          identityId: 'you',
          label: 'You',
          you: true,
          status: values.yourStatus,
        });

      return (
        <View style={{ transform: [{ scale: values.zoom }], margin: 64 }}>
          <MemberIcon joined={values.joined} participants={participants} />
        </View>
      );
    },
  }),
  defineStory({
    id: 'member-list',
    group: 'Members',
    title: 'MemberList',
    description:
      'The editable members list through the real client and memory server; ' +
      'change a control to start over.',
    controls: {
      members: { kind: 'text', default: 'Ana, Ben, Chloe, Dev' },
      you: {
        kind: 'text',
        default: 'Ana',
        hint: 'The member this installation uses; blank for nobody.',
      },
      others: {
        kind: 'text',
        default: 'Ben, Ben, Chloe',
        hint: 'One member name per other participant.',
      },
      presence: {
        kind: 'select',
        options: ['realtime', 'unavailable'],
        default: 'realtime',
      },
      othersOnline: { kind: 'boolean', default: true },
      connection: {
        kind: 'select',
        options: ['online', 'offline'],
        default: 'online',
      },
      latency: {
        kind: 'number',
        default: 300,
        min: 0,
        max: 5000,
        step: 100,
        hint: 'Milliseconds before a command settles.',
      },
      failure: {
        kind: 'select',
        options: errorCodes,
        default: 'none',
        hint: 'Connected requests fail with this error; offline edits still queue.',
      },
    },
    render: (values, log) => (
      <View style={[s.card, s.listCard, { width: '100%', maxWidth: 680 }]}>
        <MemberListDemo
          scenario={{
            members: listValue(values.members),
            you: values.you.trim(),
            others: listValue(values.others),
            presence: values.presence,
            othersOnline: values.othersOnline,
            connection: values.connection,
          }}
          latency={values.latency}
          failure={values.failure}
          log={log}
        />
      </View>
    ),
  }),
  defineStory({
    id: 'frame',
    group: 'Layout',
    title: 'Frame',
    description: 'The page shell with the brand header.',
    controls: {
      groupsButton: { kind: 'boolean', default: true },
      content: { kind: 'text', default: 'Page content goes here.' },
    },
    render: (values, log) => (
      <View style={{ width: '100%', height: 320 }}>
        <Frame onGroups={values.groupsButton ? () => log('onGroups') : undefined}>
          <Text style={s.body}>{values.content}</Text>
        </Frame>
      </View>
    ),
  }),
  ...screenStories,
];

function ChoiceDemo(props: { options: string[]; selected: string; log: Log }) {
  const [selected, setSelected] = useState(props.selected);

  return (
    <View accessibilityRole="radiogroup" style={s.row}>
      {props.options.map((option) => (
        <Choice
          key={option}
          selected={option === selected}
          onPress={() => {
            setSelected(option);
            props.log('onPress', option);
          }}
        >
          {option}
        </Choice>
      ))}
    </View>
  );
}

type FieldDemoProps = {
  label: string;
  value: string;
  placeholder: string;
  hint: string;
  hideLabel: boolean;
  editable: boolean;
  trailing: boolean;
  log: Log;
};

function FieldDemo(props: FieldDemoProps) {
  const [value, setValue] = useState(props.value);

  return (
    <View style={{ width: '100%', maxWidth: 420 }}>
      <Field
        label={props.label}
        hideLabel={props.hideLabel}
        hint={props.hint}
        placeholder={props.placeholder}
        editable={props.editable}
        value={value}
        onChangeText={(text) => {
          setValue(text);
          props.log('onChangeText', text);
        }}
        trailing={
          props.trailing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy"
              onPress={() => props.log('trailing onPress', value)}
              style={s.copyButton}
            >
              <View style={s.copyIcon}>
                <View style={s.copyBack} />
                <View style={s.copyFront} />
              </View>
            </Pressable>
          ) : undefined
        }
      />
    </View>
  );
}

type MemberListDemoProps = {
  scenario: MemberListScenario;
  latency: number;
  failure: string;
  log: Log;
};

/** Runs MemberList through the real client over an in-memory server. */
function MemberListDemo(props: MemberListDemoProps) {
  const app = useFakeApp({
    scenario: props.scenario,
    connection: props.scenario.connection,
    latency: props.latency,
    failure: props.failure,
    log: props.log,
  });

  const actions = useFakeDispatcher(app);
  const replica = app?.snapshot().group;

  return replica && app && actions ? (
    <ActionsProvider value={actions}>
      <MemberList app={app} replica={replica} />
    </ActionsProvider>
  ) : null;
}
