import type { ReactNode } from 'react';
import { View } from 'react-native';
import { BackButton, ErrorMessage, ScreenHeader } from './components';
import { useActionCall } from './useActionCall';

/** A details screen's header: back to where it was opened from, which is named quietly above the title. */
export function BackHeader(props: { title: string; heading?: ReactNode; context: string; end?: ReactNode; error?: string | null }) {
  const back = useActionCall();

  return (
    <View>
      <ScreenHeader
        start={<BackButton label={`Back to ${props.context}`} disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
        context={props.context}
        title={props.title}
        heading={props.heading}
        end={props.end}
      />
      <ErrorMessage message={back.error ?? props.error ?? null} />
    </View>
  );
}
