import { Link } from 'expo-router';
import { Row, Stack, Text, layout, typeScale, colors } from '../design';
import type { LegalDocument } from '../legal';
import { Frame } from './Frame';

/** A public policy page in the homepage's frame. */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <Frame>
      <Stack gap={16} paddingBottom={56} style={{ flexGrow: 1, width: '100%', maxWidth: layout.prose, alignSelf: 'center' }}>
        <Text accessibilityRole="header" variant="title">
          {document.title}
        </Text>
        <Text variant="caption" tone="muted">Last updated {document.updated}</Text>
        <Text variant="body" tone="muted">{document.intro}</Text>
        {document.sections.map((section) => (
          <Stack key={section.heading} gap={8} paddingTop={12}>
            <Text accessibilityRole="header" aria-level={2} variant="headline">
              {section.heading}
            </Text>
            {section.paragraphs?.map((paragraph) => (
              <Text key={paragraph} variant="body">
                {paragraph}
              </Text>
            ))}
            {section.items?.map((item) => (
              <Row key={item} gap={12} align="start" style={{ paddingLeft: 4 }}>
                <Text variant="body">•</Text>
                <Text variant="body" style={{ flex: 1 }}>{item}</Text>
              </Row>
            ))}
          </Stack>
        ))}
        <Link href="/" style={{ ...typeScale.caption, color: colors.muted, textDecorationLine: 'underline', paddingTop: 16 }}>
          Back to the homepage
        </Link>
      </Stack>
    </Frame>
  );
}
