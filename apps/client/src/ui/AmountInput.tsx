import type { RefObject } from 'react';
import { TextInput } from 'react-native';
import { formatAmount, parseAmount } from '@splitnext/client';
import { colors, s } from './components';

export type AmountInputHandle = { focus: (options?: FocusOptions) => void };

export type AmountInputProps = {
  inputRef: RefObject<AmountInputHandle | null>;
  value: string;
  currency: string;
  height: number;
  fontSize: number;
  align?: 'left' | 'right';
  onChangeText: (value: string) => void;
  onSubmitEditing: () => void;
  /** What the field is called; the expense's own amount by default. */
  label?: string;
  /** A small amount inside a row: right-aligned over an ink underline, selected when focused. */
  inline?: boolean;
  editable?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
};

/** Native input seam; the web build supplies the caret-aware decimal mask. */
export function AmountInput(props: AmountInputProps) {
  return (
    <TextInput
      ref={(input) => { props.inputRef.current = input; }}
      accessibilityLabel={props.label ?? 'Amount'}
      editable={props.editable ?? true}
      selectTextOnFocus={props.inline}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      placeholder={formatAmount(0, props.currency)}
      placeholderTextColor={colors.control}
      inputMode="decimal"
      value={props.value}
      onChangeText={(value) => {
        if (!/^\d*(?:[.,]\d*)?$/.test(value)) return;
        const decimal = value.replace(',', '.');
        const minor = parseAmount(decimal.startsWith('.') ? `0${decimal}` : decimal, props.currency);

        if (value === '' || minor !== null) props.onChangeText(minor === null ? '' : formatAmount(minor, props.currency));
      }}
      returnKeyType="done"
      onSubmitEditing={props.onSubmitEditing}
      style={[
        s.amountInput,
        { marginLeft: 0, paddingHorizontal: 15, height: props.height, fontSize: props.fontSize, textAlign: props.align ?? 'left' },
        props.inline && { paddingHorizontal: 0, textAlign: 'right', borderWidth: 0, borderBottomWidth: 1.5, borderColor: colors.ink },
      ]}
    />
  );
}
