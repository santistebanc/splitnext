import { useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { TextInput, type TextInputInstance } from 'react-native';
import type { TextLineProps } from './TextLine';

/**
 * React Native Web still reads this from a multiline field: Enter submits
 * without a line break, then leaves the field. Spread in, as the typings no
 * longer list it.
 */
const submitOnEnter = { blurOnSubmit: true };

/** Lays a one-row textarea out as an input: one line, scrolled sideways, centred in its height. */
function asOneLine(element: HTMLTextAreaElement): void {
  const line = Math.round(parseFloat(getComputedStyle(element).fontSize) * 1.25);
  const inset = `${Math.max(0, (element.offsetHeight - line) / 2)}px`;

  element.style.whiteSpace = 'pre';
  element.style.overflow = 'hidden';
  element.style.lineHeight = `${line}px`;
  element.style.paddingTop = inset;
  element.style.paddingBottom = inset;
}

/**
 * A one-line text field drawn as a one-row textarea. Chrome on Android puts
 * its password, card and address bar above the keyboard for any text input,
 * whatever `autocomplete` says, but never for a textarea. Line breaks never
 * get in, and a field that keeps focus on Enter, such as Add a person, takes
 * the key in its own `onKeyPress` first.
 */
export function TextLine(props: TextLineProps) {
  const { ref, onChangeText, ...rest } = props;
  const field = useRef<TextInputInstance>(null);

  useImperativeHandle(ref, () => field.current!, []);

  // After every render, since a style change can reset what was laid out.
  useLayoutEffect(() => {
    const element: unknown = field.current;

    if (element instanceof HTMLTextAreaElement) asOneLine(element);
  });

  return (
    <TextInput
      {...rest}
      {...submitOnEnter}
      ref={field}
      multiline
      numberOfLines={1}
      onChangeText={(value) => onChangeText?.(value.replace(/[\r\n]+/g, ' '))}
    />
  );
}
