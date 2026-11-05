import { useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BrandMark, Row, Stack, Text, Touchable, colors, rules, strokes } from '../design';
import { componentPages } from './components';
import type { DocPage } from './doc';
import { foundationPages } from './foundations';
import { chromePages, screenPages } from './screens';

const pages: DocPage[] = [...foundationPages, ...componentPages, ...chromePages, ...screenPages];

const sections = (['Foundations', 'Components', 'App chrome', 'Screens'] as const).map((section) => ({ section, pages: pages.filter((entry) => entry.section === section) }));

/**
 * The design system's catalog, at `/components`: its tokens, every reusable
 * component with live examples and its props, and the screens built from them.
 */
export function Catalog() {
  const params = useLocalSearchParams<{ page?: string }>();
  const wide = useWindowDimensions().width >= 900;
  const [hydrated, setHydrated] = useState(false);

  // A development tool gains nothing from server rendering, and React Native
  // Web's server markup does not hydrate cleanly, so render only on the client.
  useEffect(() => setHydrated(true), []);

  const page = pages.find((entry) => entry.id === params.page) ?? pages[0];
  // The page list runs down a sidebar, or across the top of a narrow window.
  const Links = wide ? Stack : Row;

  if (!hydrated || !page) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  return (
    <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', backgroundColor: colors.background }}>
      <ScrollView
        style={wide ? { width: 240, flexGrow: 0, borderRightWidth: strokes.hairline, borderColor: colors.rule } : { flexGrow: 0, maxHeight: 220, ...rules.below }}
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        <Row gap={12}>
          <BrandMark size={24} />
          <Text variant="strong" weight="bold">Design system</Text>
        </Row>
        {sections.map(({ section, pages: entries }) => (
          <Stack key={section} gap={2}>
            <Text variant="caption" tone="muted" weight="semibold" style={{ paddingBottom: 4 }}>{section}</Text>
            <Links wrap={!wide} gap={wide ? 0 : 4}>
              {entries.map((entry) => (
                <Touchable
                  key={entry.id}
                  accessibilityRole="link"
                  aria-current={entry.id === page.id ? 'page' : undefined}
                  feedback="tint"
                  onPress={() => router.setParams({ page: entry.id })}
                  style={[{ paddingVertical: 6, paddingHorizontal: 8 }, wide && { marginHorizontal: -8 }, entry.id === page.id && { backgroundColor: colors.tint }]}
                >
                  <Text variant="caption" weight={entry.id === page.id ? 'semibold' : 'regular'}>{entry.title}</Text>
                </Touchable>
              ))}
            </Links>
          </Stack>
        ))}
      </ScrollView>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: wide ? 40 : 20, paddingBottom: 80 }}>
        {/* Each page starts fresh, with its examples' state reset. */}
        <Stack key={page.id} gap={32} style={{ width: '100%', maxWidth: 1040 }}>
          <Stack gap={8}>
            <Text variant="caption" tone="muted" weight="semibold">{page.section}</Text>
            <Text accessibilityRole="header" variant="title">{page.title}</Text>
            <Text variant="body" tone="muted">{page.summary}</Text>
            <Text variant="figureSmall" tone="muted">{page.source}</Text>
          </Stack>
          {page.render()}
        </Stack>
      </ScrollView>
    </View>
  );
}
