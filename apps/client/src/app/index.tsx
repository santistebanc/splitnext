import { Link, router } from 'expo-router';
import { Button, Row, Stack, Text, colors, layout, typeScale } from '../design';
import { supportEmail } from '../legal';
import { Frame } from '../ui/Frame';
import { useCompactLayout } from '../ui/useVisibleViewport';

const link = { ...typeScale.caption, color: colors.muted, textDecorationLine: 'underline' } as const;

export default function Homepage() {
  const mobile = useCompactLayout();

  return (
    <Frame>
      <Stack gap={32} style={{ flexGrow: 1, width: '100%', maxWidth: layout.page, alignSelf: 'center' }}>
        <Stack gap={mobile ? 16 : 24} paddingY={mobile ? 32 : 56} style={{ maxWidth: layout.prose }}>
          <Text variant="caption" tone="muted" weight="semibold">Shared costs, kept square</Text>
          <Text accessibilityRole="header" variant={mobile ? 'heroCompact' : 'hero'}>
            Your people.{'\n'}
            <Text tone="muted">One group.</Text>
          </Text>
          <Text variant="body" tone="muted" style={{ maxWidth: 460 }}>
            Add what everyone paid, see who owes whom, and settle up. No
            account needed, and it keeps working offline.
          </Text>
          <Row gap={12} wrap>
            <Button onPress={() => router.push('/app')}>Open app →</Button>
          </Row>
        </Stack>
        <Stack gap={8}>
          <Text variant="caption" tone="muted">
            Beta: groups, invitations, expenses, and repayments.
          </Text>
          <Text variant="caption" tone="muted">
            <Link href="/privacy" style={link}>Privacy</Link>
            {'  ·  '}
            <Link href="/terms" style={link}>Terms</Link>
            {'  ·  '}
            <Link href={`mailto:${supportEmail}`} style={link}>{supportEmail}</Link>
          </Text>
        </Stack>
      </Stack>
    </Frame>
  );
}
