import { NumericFormat } from 'react-number-format';
import { formatAmount, minorDigits } from '@splitnext/client';
import { colors, monoFamily } from './theme';
import type { AmountInputProps } from './AmountInput';

/** Fixed decimal places with cursor-aware insertion, replacement, and deletion. */
export function AmountInput(props: AmountInputProps) {
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
      onKeyDown={(event) => {
        if (event.key === 'Enter') props.onSubmitEditing();
      }}
      style={{
        flex: 1, minWidth: 0, width: '100%', height: props.height, padding: 0, border: 0,
        boxSizing: 'border-box', background: 'transparent', outline: 'none',
        color: colors.ink, fontFamily: monoFamily, fontSize: props.fontSize,
        fontWeight: 500, letterSpacing: -0.05 * props.fontSize,
      }}
    />
  );
}
