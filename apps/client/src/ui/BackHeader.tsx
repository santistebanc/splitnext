import type { ReactNode } from 'react';
import { View } from 'react-native';
import { BackButton, ErrorMessage, ScreenHeader } from './components';
import { useActionCall } from './useActionCall';

/** A details screen's header: back to where it was opened from, named in the first row, then the title. */
export function BackHeader(props: { title: string; heading?: ReactNode; context: string; end?: ReactNode; error?: string | null; morph?: string; scrollRule?: boolean }) {
  const back = useActionCall();

  return (
    <View>
      <ScreenHeader
        start={<BackButton label={`Back to ${props.context}`} text={props.context} disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
        title={props.title}
        heading={props.heading}
        end={props.end}
        morph={props.morph}
        scrollRule={props.scrollRule}
      />
      <ErrorMessage message={back.error ?? props.error ?? null} />
    </View>
  );
}
