import type { RefObject } from 'react';
import { Platform, Text, TextInput, View, type TextInputKeyPressEvent, type TextStyle } from 'react-native';
import { colors } from '../design';

export type TitleFieldProps = {
  value: string;
  accessibilityLabel: string;
  placeholder?: string;
  maxLength: number;
  onChangeText: (value: string) => void;
  /** Leaving the field, by Enter, a tap elsewhere, or Escape unless `onEscape` takes it. */
  onBlur: () => void;
  onEscape?: () => void;
  inputRef: RefObject<TextInput | null>;
  /** The title's own text style, with the underline that marks it as a field. */
  style: TextStyle;
  /**
   * Room the title it replaces leaves at its end, as for the pencil: the field
   * spans the whole width, but its text breaks into lines where the title's did.
   */
  inset?: number;
};

/**
 * A large name edited in place that wraps onto more lines as it grows, rather
 * than scrolling sideways. It opens with the name selected, so typing replaces
 * it. Names are one line of text, so Enter leaves the field and line breaks
 * never get in.
 */
export function TitleField(props: TitleFieldProps) {
  const style = [props.style, { paddingRight: props.inset ?? 0 }];

  function onKeyPress(event: TextInputKeyPressEvent): void {
    const key = event.nativeEvent.key;

    if (key === 'Escape') {
      if (props.onEscape) props.onEscape();
      else props.inputRef.current?.blur();
    }

    // A wrapping field on the web would take Enter as a new line.
    if (Platform.OS === 'web' && key === 'Enter') {
      event.preventDefault();
      props.inputRef.current?.blur();
    }
  }

  return (
    // Top-aligned like the title, so its first line stays where the title's was.
    <View style={{ flex: 1, minWidth: 0, alignSelf: 'flex-start' }}>
      {/* In-flow text gives the field its height on the first layout, before
          autofocus or the cover can see a textarea's default row count. */}
      <Text aria-hidden pointerEvents="none" style={[style, { opacity: 0 }]}>
        {props.value || props.placeholder || ' '}
      </Text>
      <TextInput
        ref={props.inputRef}
        autoFocus
        multiline
        // The whole name is selected, so typing replaces it.
        selectTextOnFocus
        accessibilityLabel={props.accessibilityLabel}
        placeholder={props.placeholder}
        placeholderTextColor={colors.faint}
        value={props.value}
        onChangeText={(value) => props.onChangeText(value.replace(/\n/g, ''))}
        maxLength={props.maxLength}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onBlur={props.onBlur}
        onSubmitEditing={() => props.inputRef.current?.blur()}
        onKeyPress={onKeyPress}
        scrollEnabled={false}
        style={[style, { position: 'absolute', left: 0, right: 0, top: 0, height: '100%', overflow: 'hidden' }]}
      />
    </View>
  );
}
