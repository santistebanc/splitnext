import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Row, Stack, Text, colors, fonts, rules, strokes } from '../design';

/** A record's entries, keyed as the record is. */
export function entriesOf<const Key extends string, Value>(record: Record<Key, Value>): [Key, Value][] {
  // SAFETY: the records passed here are literal token tables, which have no keys beyond their type's.
  return Object.entries(record) as [Key, Value][];
}

/** One page of the catalog: a token family, a component, or a screen. */
export type DocPage = {
  id: string;
  section: 'Foundations' | 'Components' | 'App chrome' | 'Screens';
  title: string;
  /** One sentence on what it is for, shown under the title. */
  summary: string;
  /** Where it lives, as an import path. */
  source: string;
  render: () => ReactNode;
};

/** A titled live example on the page's own background, framed by a dashed edge. */
export function Example(props: { title: string; note?: string; children: ReactNode; width?: number }) {
  return (
    <Stack gap={8}>
      <Text variant="caption" weight="semibold">{props.title}</Text>
      {props.note ? <Text variant="caption" tone="muted">{props.note}</Text> : null}
      <View style={{ padding: 24, borderWidth: strokes.hairline, borderStyle: 'dashed', borderColor: colors.faint }}>
        <View style={{ width: '100%', maxWidth: props.width ?? 480 }}>{props.children}</View>
      </View>
    </Stack>
  );
}

/** How to use it, as code to copy. */
export function Usage(props: { code: string }) {
  return (
    <Stack gap={8}>
      <Text variant="caption" weight="semibold">Usage</Text>
      <Text selectable style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, color: colors.ink, backgroundColor: colors.tint, padding: 14 }}>
        {props.code}
      </Text>
    </Stack>
  );
}

/** A prop: its name, its type, and what it does. Optional ones are marked with `?`. */
export type PropDoc = readonly [name: string, type: string, description: string];

/** The props a component takes, one ruled row each. */
export function Props(props: { rows: readonly PropDoc[] }) {
  return (
    <Stack gap={8}>
      <Text variant="caption" weight="semibold">Props</Text>
      <View style={rules.below}>
        {props.rows.map(([name, type, description]) => (
          <Row key={name} gap={16} paddingY={12} align="start" wrap style={rules.above}>
            <Text style={{ width: 150, fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, color: colors.ink }}>{name}</Text>
            <Stack fill gap={2} style={{ minWidth: 200 }}>
              <Text style={{ fontFamily: fonts.mono, fontSize: 12, lineHeight: 17, color: colors.muted }}>{type}</Text>
              <Text variant="caption">{description}</Text>
            </Stack>
          </Row>
        ))}
      </View>
    </Stack>
  );
}

/** Several examples side by side where they fit. */
export function Gallery(props: { children: ReactNode }) {
  return <Row gap={16} wrap align="start">{props.children}</Row>;
}

/** A caption under one item of a gallery, such as a color's name. */
export function Specimen(props: { name: string; detail?: string; width?: number; children: ReactNode }) {
  return (
    <Stack gap={8} style={{ width: props.width ?? 140 }}>
      {props.children}
      <Text variant="caption" weight="semibold">{props.name}</Text>
      {props.detail ? <Text variant="caption" tone="muted">{props.detail}</Text> : null}
    </Stack>
  );
}
