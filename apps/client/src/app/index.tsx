import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Frame } from '../ui/Frame';
import { Button, s } from '../ui/components';
import { useCompactLayout } from '../ui/useVisibleViewport';

export default function Homepage() {
  const mobile = useCompactLayout();

  return (
    <Frame>
      <View style={[s.main, s.wide]}>
        <View style={[s.hero, mobile && s.mobileHero]}>
          <Text
            accessibilityRole="header"
            style={[s.heroTitle, mobile && s.mobileHeroTitle]}
          >
            Your people.{'\n'}One group.
          </Text>
          <View style={s.row}>
            <Button onPress={() => router.push('/app')}>Open app →</Button>
          </View>
        </View>
        <Text style={s.caption}>
          Beta: groups and invitations. Expenses coming later.
        </Text>
      </View>
    </Frame>
  );
}
