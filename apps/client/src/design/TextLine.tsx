import type { Ref } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

export type TextLineProps = TextInputProps & { ref?: Ref<TextInput> | undefined };

/** A one-line text field; native's own single-line input already is one. */
export function TextLine(props: TextLineProps) {
  return <TextInput {...props} />;
}
