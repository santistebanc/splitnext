import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ErrorMessage } from '../design';
import { BackButton, ScreenHeader } from './ScreenHeader';
import { useActionCall, useUiState } from './useActionCall';

/** A details screen's header: back to where it was opened from, named in the first row, then the title. */
export function BackHeader(props: { title: string; heading?: ReactNode; context: string; end?: ReactNode; error?: string | null; morph?: string; scrollRule?: boolean }) {
  const back = useActionCall();
  const context = useUiState().trail.at(-1) === 'activity' ? 'Activity' : props.context;

  return (
    <View>
      <ScreenHeader
        start={<BackButton label={`Back to ${context}`} text={context} disabled={!back.can('closePanel')} onPress={() => { void back.call('closePanel', {}); }} />}
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
