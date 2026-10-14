import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Choice, colors, s } from '../ui/components';
import { stories } from './catalog';
import {
  defaultValues,
  searchStories,
  type Control,
  type ControlValue,
  type Story,
} from './stories';

type LoggedEvent = { id: number; time: string; event: string; detail: string };

const viewports = [
  { name: 'Fill', width: null },
  { name: 'Phone', width: 375 },
  { name: 'Tablet', width: 768 },
  { name: 'Desktop', width: 1040 },
] as const;

type Viewport = (typeof viewports)[number]['name'];

/** A searchable catalog of reusable components rendered under editable props. */
export function Workbench() {
  const params = useLocalSearchParams<{ story?: string }>();
  const width = useWindowDimensions().width;
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState('');

  // A development tool gains nothing from server rendering, and React Native
  // Web's server markup does not hydrate cleanly, so render only on the client.
  useEffect(() => setHydrated(true), []);

  const wide = width >= 960;
  const story = stories.find((item) => item.id === params.story) ?? stories[0];

  if (!hydrated || !story) return <View style={ws.page} />;

  const results = searchStories(stories, query);

  const groups = [...new Set(results.map((item) => item.group))];

  return (
    <View style={[ws.page, wide && ws.pageWide]}>
      <View style={[ws.sidebar, wide && ws.sidebarWide]}>
        <Text style={ws.title}>Component workbench</Text>
        <TextInput
          accessibilityLabel="Search components"
          placeholder="Search components and props"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          style={[s.input, ws.search]}
        />
        <ScrollView style={wide && ws.fill}>
          {groups.map((group) => (
            <View key={group} style={[ws.group, !wide && ws.groupNarrow]}>
              <Text style={s.eyebrow}>{group.toUpperCase()}</Text>
              {results
                .filter((item) => item.group === group)
                .map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="link"
                    aria-current={item.id === story.id ? 'page' : undefined}
                    onPress={() => router.setParams({ story: item.id })}
                    style={[ws.storyLink, item.id === story.id && s.chosen]}
                  >
                    <Text style={s.name}>{item.title}</Text>
                  </Pressable>
                ))}
            </View>
          ))}
          {!results.length ? (
            <Text style={s.caption}>No components match “{query}”.</Text>
          ) : null}
        </ScrollView>
      </View>
      {/* Remount on story change so controls and events start fresh. */}
      <StoryView key={story.id} story={story} wide={wide} />
    </View>
  );
}

function StoryView(props: { story: Story; wide: boolean }) {
  const story = props.story;
  const [values, setValues] = useState(() => defaultValues(story.controls));
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [viewport, setViewport] = useState<Viewport>('Fill');
  const [surface, setSurface] = useState(false);
  const [resets, setResets] = useState(0);

  function log(event: string, detail = ''): void {
    const time = new Date().toLocaleTimeString();

    setEvents((current) =>
      [{ id: Date.now() + Math.random(), time, event, detail }, ...current].slice(
        0,
        50,
      ),
    );
  }

  const width =
    viewports.find((item) => item.name === viewport)?.width ?? null;

  return (
    <View style={[ws.fill, props.wide && ws.row]}>
      <ScrollView style={ws.fill} contentContainerStyle={ws.main}>
        <View style={s.between}>
          <View style={ws.fill}>
            <Text style={s.heading}>{story.title}</Text>
            <Text style={s.caption}>{story.description}</Text>
          </View>
          <Button quiet onPress={() => setResets((count) => count + 1)}>
            Remount
          </Button>
        </View>
        <View accessibilityRole="radiogroup" style={s.row}>
          {viewports.map(({ name }) => (
            <Choice
              key={name}
              selected={viewport === name}
              onPress={() => setViewport(name)}
            >
              {name}
            </Choice>
          ))}
          <View style={ws.inline}>
            <Switch value={surface} onValueChange={setSurface} />
            <Text style={s.caption}>White surface</Text>
          </View>
        </View>
        <View
          style={[
            ws.canvas,
            surface && { backgroundColor: colors.surface },
            width !== null && { width, maxWidth: '100%' },
          ]}
        >
          {/* Stateful previews reseed from their controls when values change. */}
          <View key={`${resets}:${JSON.stringify(values)}`} style={ws.stage}>
            {story.render(values, log)}
          </View>
        </View>
        {width !== null ? (
          <Text style={s.caption}>
            Components that read the window size still see the real window.
          </Text>
        ) : null}
      </ScrollView>
      <ScrollView
        style={[ws.panel, props.wide && ws.panelWide]}
        contentContainerStyle={ws.panelContent}
      >
        <View style={s.between}>
          <Text style={s.label}>Props and state</Text>
          {Object.keys(story.controls).length ? (
            <Button
              quiet
              onPress={() => setValues(defaultValues(story.controls))}
            >
              Reset
            </Button>
          ) : null}
        </View>
        {Object.entries(story.controls).map(([name, control]) => (
          <ControlInput
            key={name}
            name={name}
            control={control}
            value={values[name] ?? control.default}
            onChange={(value) =>
              setValues((current) => ({ ...current, [name]: value }))
            }
          />
        ))}
        {!Object.keys(story.controls).length ? (
          <Text style={s.caption}>This story has no controls.</Text>
        ) : null}
        <View style={s.divider} />
        <Text style={s.label}>Current values</Text>
        <Text selectable style={ws.code}>
          {JSON.stringify(values, null, 2)}
        </Text>
        <View style={s.divider} />
        <View style={s.between}>
          <Text style={s.label}>Events</Text>
          {events.length ? (
            <Button quiet onPress={() => setEvents([])}>
              Clear
            </Button>
          ) : null}
        </View>
        {events.map((entry) => (
          <Text key={entry.id} style={ws.code}>
            <Text style={s.caption}>{entry.time} </Text>
            {entry.event}
            {entry.detail ? `(${entry.detail})` : ''}
          </Text>
        ))}
        {!events.length ? (
          <Text style={s.caption}>Interact with the preview to log callbacks.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

type ControlInputProps = {
  name: string;
  control: Control;
  value: ControlValue;
  onChange: (value: ControlValue) => void;
};

function ControlInput(props: ControlInputProps) {
  const control = props.control;

  return (
    <View style={ws.control}>
      <Text style={ws.controlName}>{props.name}</Text>
      {control.kind === 'boolean' ? (
        <Switch
          accessibilityLabel={props.name}
          value={props.value === true}
          onValueChange={props.onChange}
        />
      ) : control.kind === 'select' ? (
        <View accessibilityRole="radiogroup" style={ws.options}>
          {control.options.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              aria-checked={props.value === option}
              onPress={() => props.onChange(option)}
              style={[ws.option, props.value === option && s.chosen]}
            >
              <Text style={ws.optionText}>{option}</Text>
            </Pressable>
          ))}
        </View>
      ) : control.kind === 'number' ? (
        <NumberInput
          name={props.name}
          control={control}
          value={Number(props.value)}
          onChange={props.onChange}
        />
      ) : (
        <TextInput
          accessibilityLabel={props.name}
          value={String(props.value)}
          onChangeText={props.onChange}
          style={ws.textInput}
        />
      )}
      {control.hint ? <Text style={s.caption}>{control.hint}</Text> : null}
    </View>
  );
}

type NumberInputProps = {
  name: string;
  control: Extract<Control, { kind: 'number' }>;
  value: number;
  onChange: (value: number) => void;
};

function NumberInput(props: NumberInputProps) {
  const step = props.control.step ?? 1;

  function set(value: number): void {
    if (Number.isFinite(value))
      props.onChange(
        Math.min(props.control.max, Math.max(props.control.min, value)),
      );
  }

  return (
    <View style={ws.inline}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${props.name}`}
        onPress={() => set(props.value - step)}
        style={ws.stepper}
      >
        <Text style={s.name}>−</Text>
      </Pressable>
      <TextInput
        accessibilityLabel={props.name}
        inputMode="numeric"
        value={String(props.value)}
        onChangeText={(text) => set(Number(text))}
        style={[ws.textInput, ws.number]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${props.name}`}
        onPress={() => set(props.value + step)}
        style={ws.stepper}
      >
        <Text style={s.name}>+</Text>
      </Pressable>
    </View>
  );
}

const ws = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  pageWide: { flexDirection: 'row' },
  fill: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.ink, fontSize: 17, fontWeight: '600' },
  sidebar: {
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sidebarWide: { width: 240, borderBottomWidth: 0, borderRightWidth: 1 },
  search: { minHeight: 40, paddingVertical: 8, fontSize: 14 },
  group: { gap: 4, marginBottom: 14 },
  groupNarrow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 4,
  },
  storyLink: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  main: { padding: 20, gap: 14 },
  canvas: {
    minHeight: 240,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 8,
  },
  stage: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  panelWide: { flexGrow: 0, width: 320, borderTopWidth: 0, borderLeftWidth: 1 },
  panelContent: { padding: 16, gap: 14 },
  control: { gap: 6 },
  controlName: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  option: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
  },
  optionText: { color: colors.ink, fontSize: 12 },
  textInput: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    color: colors.ink,
    fontSize: 14,
  },
  number: { width: 80, textAlign: 'center' },
  stepper: {
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: { color: colors.ink, fontSize: 12, fontFamily: 'monospace' },
});
