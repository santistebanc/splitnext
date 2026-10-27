import { useState } from 'react';
import { NumericFormat } from 'react-number-format';
import { formatAmount, minorDigits } from '@splitnext/client';
import { colors, monoFamily, radius } from './theme';
import type { AmountInputProps } from './AmountInput';

/** Fixed decimal places with cursor-aware insertion, replacement, and deletion. */
export function AmountInput(props: AmountInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <NumericFormat
      getInputRef={(input: HTMLInputElement) => { props.inputRef.current = input; }}
      aria-label="Amount"
      placeholder={formatAmount(0, props.currency)}
      inputMode="decimal"
      value={props.value}
      valueIsNumericString
      decimalScale={minorDigits(props.currency)}
      fixedDecimalScale
      decimalSeparator="."
      allowedDecimalSeparators={['.', ',']}
      allowNegative={false}
      thousandSeparator={false}
      onChangeCapture={(event) => {
        const input = event.currentTarget;
        const original = input.value;
        const replaced = original.replace(',', '.');
        const decimal = replaced.startsWith('.') ? `0${replaced}` : replaced;
        const caret = input.selectionStart ?? 0;

        if (!/^\d*(?:\.\d*)?$/.test(decimal)) {
          event.stopPropagation();
          input.value = props.value;
          const restored = Math.max(0, caret - (original.length - props.value.length));

          input.setSelectionRange(restored, restored);
        } else if (decimal !== original) {
          input.value = decimal;
          const nextCaret = caret + decimal.length - original.length;

          input.setSelectionRange(nextCaret, nextCaret);
        }
      }}
      onValueChange={({ value }, source) => {
        if (source.source === 'event') props.onChangeText(value);
      }}
      onPaste={(event) => {
        const text = event.clipboardData.getData('text').trim();

        // Reject ambiguous or over-precise pasted amounts rather than changing their meaning.
        if (!/^\d*(?:[.,]\d*)?$/.test(text) || (text.split(/[.,]/)[1]?.length ?? 0) > minorDigits(props.currency)) event.preventDefault();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onSubmitEditing();
      }}
      style={{
        flex: 1, minWidth: 0, height: props.height, padding: '0 15px', border: 0,
        borderRadius: radius.control, boxSizing: 'border-box', background: 'transparent',
        color: colors.ink, fontFamily: monoFamily, fontSize: props.fontSize,
        fontWeight: 600, letterSpacing: -0.8,
        outline: focused ? `2px solid ${colors.action}` : 'none', outlineOffset: -2,
      }}
    />
  );
}
