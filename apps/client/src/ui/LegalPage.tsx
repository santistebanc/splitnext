import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import type { LegalDocument } from '../legal';
import { Frame } from './Frame';
import { s } from './components';

/** A public policy page in the homepage's frame. */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <Frame>
      <View style={[s.main, s.stack, { paddingBottom: 56 }]}>
        <Text accessibilityRole="header" style={s.screenTitle}>
          {document.title}
        </Text>
        <Text style={s.caption}>Last updated {document.updated}</Text>
        <Text style={s.lead}>{document.intro}</Text>
        {document.sections.map((section) => (
          <View key={section.heading} style={{ gap: 8, paddingTop: 10 }}>
            <Text accessibilityRole="header" aria-level={2} style={s.emptyTitle}>
              {section.heading}
            </Text>
            {section.paragraphs?.map((paragraph) => (
              <Text key={paragraph} style={s.body}>
                {paragraph}
              </Text>
            ))}
            {section.items?.map((item) => (
              <View key={item} style={{ flexDirection: 'row', gap: 10, paddingLeft: 4 }}>
                <Text style={s.body}>•</Text>
                <Text style={[s.body, { flex: 1 }]}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
        <Link href="/" style={[s.caption, s.link, { paddingTop: 16 }]}>
          Back to the homepage
        </Link>
      </View>
    </Frame>
  );
}
