import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '../../ui/AppScreen';

export default function JoinPage() {
  const params = useLocalSearchParams<{ groupId: string }>();

  return <AppScreen incomingGroupId={params.groupId} invite />;
}
