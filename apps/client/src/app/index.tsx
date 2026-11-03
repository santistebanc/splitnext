import { Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { supportEmail } from '../legal';
import { Frame } from '../ui/Frame';
import { Button, s } from '../ui/components';
import { useCompactLayout } from '../ui/useVisibleViewport';

export default function Homepage() {
  const mobile = useCompactLayout();

  return (
    <Frame>
      <View style={[s.main, s.wide]}>
        <View style={[s.hero, mobile && s.mobileHero]}>
          <Text style={s.eyebrow}>Shared costs, kept square</Text>
          <Text
            accessibilityRole="header"
            style={[s.heroTitle, mobile && s.mobileHeroTitle]}
          >
            Your people.{'\n'}
            <Text style={s.heroAccent}>One group.</Text>
          </Text>
          <Text style={[s.subtitle, { maxWidth: 460 }]}>
            Add what everyone paid, see who owes whom, and settle up. No
            account needed, and it keeps working offline.
          </Text>
          <View style={s.row}>
            <Button onPress={() => router.push('/app')}>Open app →</Button>
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={s.caption}>
            Beta: groups, invitations, expenses, and repayments.
          </Text>
          <Text style={s.caption}>
            <Link href="/privacy" style={s.link}>Privacy</Link>
            {'  ·  '}
            <Link href="/terms" style={s.link}>Terms</Link>
            {'  ·  '}
            <Link href={`mailto:${supportEmail}`} style={s.link}>{supportEmail}</Link>
          </Text>
        </View>
      </View>
    </Frame>
  );
}
