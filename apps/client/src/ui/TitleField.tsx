import { useState, type RefObject } from 'react';
import { Platform, Text, TextInput, View, type TextInputKeyPressEvent, type TextStyle } from 'react-native';
import { colors } from './theme';

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
};

/**
 * A large name edited in place that wraps onto more lines as it grows, rather
 * than scrolling sideways. Names are one line of text, so Enter leaves the
 * field and line breaks never get in.
 */
export function TitleField(props: TitleFieldProps) {
  const [height, setHeight] = useState(0);

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
    <View style={{ flex: 1, minWidth: 0 }}>
      {/* The same text, laid out alike but unseen, gives the field its height. */}
      <Text aria-hidden pointerEvents="none" onLayout={(event) => setHeight(event.nativeEvent.layout.height)} style={[props.style, { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 }]}>
        {props.value || props.placeholder || ' '}
      </Text>
      <TextInput
        ref={props.inputRef}
        autoFocus
        multiline
        accessibilityLabel={props.accessibilityLabel}
        placeholder={props.placeholder}
        placeholderTextColor={colors.muted}
        value={props.value}
        onChangeText={(value) => props.onChangeText(value.replace(/\n/g, ''))}
        maxLength={props.maxLength}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onBlur={props.onBlur}
        onSubmitEditing={() => props.inputRef.current?.blur()}
        onKeyPress={onKeyPress}
        scrollEnabled={false}
        style={[props.style, { height: height || undefined, overflow: 'hidden' }]}
      />
    </View>
  );
}
