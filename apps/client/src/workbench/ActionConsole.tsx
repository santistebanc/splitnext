import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { JsonValue } from '@splitnext/client';
import { Button, colors, s } from '../ui/components';
import { useFakeApp, useFakeDispatcher, type FakeAppOptions } from './fakeApp';

type ActionConsoleProps = { options: FakeAppOptions };

/**
 * Calls app actions by name with JSON input, as RPC or an assistant would,
 * against an in-memory group. Every dispatch also reaches the Events log.
 */
export function ActionConsole(props: ActionConsoleProps) {
  const app = useFakeApp(props.options);
  const actions = useFakeDispatcher(app);
  const described = actions.describe();
  const [selected, setSelected] = useState(described[0]?.name ?? '');
  const action = described.find((entry) => entry.name === selected);
  const [input, setInput] = useState(() => format(action?.example ?? {}));
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const log = props.options.log;

  useEffect(
    () =>
      actions.observe((record) =>
        log(
          `${record.name} → ${record.status}`,
          [record.origin, record.detail].filter(Boolean).join(' · '),
        ),
      ),
    [actions, log],
  );

  function choose(name: string): void {
    const next = described.find((entry) => entry.name === name);

    setSelected(name);
    setInput(format(next?.example ?? {}));
    setResult(null);
  }

  async function run(): Promise<void> {
    let parsed: JsonValue;

    try {
      parsed = JSON.parse(input);
    } catch {
      setResult('Input is not valid JSON.');

      return;
    }

    setRunning(true);

    try {
      const outcome = await actions.dispatchJson(selected, parsed, {
        confirmed,
        origin: 'workbench',
      });

      setResult(format(outcome));
    } finally {
      setRunning(false);
    }
  }

  const state = app.snapshot();
  const snapshot = state.group?.projected_snapshot;

  const you = snapshot?.access_grants.find(
    (grant) => grant.identity_id === state.group?.session?.identity.id,
  )?.preferred_member_id;

  return (
    <View style={cs.console}>
      <View style={cs.list}>
        {described.map((entry) => (
          <Pressable
            key={entry.name}
            accessibilityRole="radio"
            aria-checked={entry.name === selected}
            onPress={() => choose(entry.name)}
            style={[cs.item, entry.name === selected && s.chosen]}
          >
            <Text style={cs.name}>{entry.name}</Text>
            <Text style={s.caption}>
              {[
                entry.confirms ? 'confirms' : null,
                ...entry.requires,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={cs.detail}>
        {action ? (
          <>
            <Text style={s.heading}>{action.name}</Text>
            <Text style={s.body}>{action.description}</Text>
            <Text style={s.label}>Input (JSON)</Text>
            <TextInput
              accessibilityLabel="Action input"
              multiline
              value={input}
              onChangeText={setInput}
              style={[cs.code, cs.editor]}
            />
            <View style={s.row}>
              <Switch
                accessibilityLabel="Confirmed"
                value={confirmed}
                onValueChange={setConfirmed}
              />
              <Text style={s.caption}>confirmed</Text>
              <Button
                disabled={running}
                onPress={() => {
                  void run();
                }}
              >
                {running ? 'Running…' : 'Dispatch'}
              </Button>
            </View>
            {result ? (
              <>
                <Text style={s.label}>Outcome</Text>
                <Text selectable style={cs.code}>
                  {result}
                </Text>
              </>
            ) : null}
            <Text style={s.label}>Group state</Text>
            <Text selectable style={cs.code}>
              {snapshot
                ? format({
                    group: snapshot.group.name,
                    hidden: state.group?.hidden ?? false,
                    members: snapshot.members
                      .filter((member) => member.status === 'active')
                      .map(
                        (member) =>
                          `${member.display_name}${member.id === you ? ' (you)' : ''} [${member.id}]`,
                      ),
                    notices: state.group?.notices.length ?? 0,
                  })
                : 'No group open'}
            </Text>
            <Text style={s.label}>Input schema</Text>
            <Text selectable style={cs.code}>
              {format(action.inputSchema)}
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

type Printable = Parameters<typeof JSON.stringify>[0];

function format(value: Printable): string {
  return JSON.stringify(value, null, 2);
}

const cs = StyleSheet.create({
  console: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'flex-start',
  },
  list: { width: 220, gap: 4 },
  item: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  name: { color: colors.ink, fontSize: 14, fontFamily: 'monospace' },
  detail: { flex: 1, minWidth: 280, gap: 10 },
  code: {
    color: colors.ink,
    fontSize: 12,
    fontFamily: 'monospace',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: 10,
  },
  editor: { minHeight: 120 },
});
