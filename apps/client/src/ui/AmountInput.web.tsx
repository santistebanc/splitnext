import { useRef } from 'react';
import { NumericFormat } from 'react-number-format';
import { formatAmount, minorDigits } from '@splitnext/client';
import { digitGroupSpace } from '../model/expenses';
import { colors, monoFamily } from './theme';
import type { AmountInputProps } from './AmountInput';

/** Typed text as a plain decimal: grouping spaces dropped, a comma read as the point. */
function plainDecimal(text: string): string {
  const replaced = text.replace(/\s/g, '').replace(',', '.');

  return replaced.startsWith('.') ? `0${replaced}` : replaced;
}

/**
 * Fixed decimal places with cursor-aware insertion, replacement, and
 * deletion, and the whole digits grouped in threes as the amount is shown
 * everywhere else.
 */
export function AmountInput(props: AmountInputProps) {
  // What the field showed before the last keystroke, to go back to when it is refused.
  const before = useRef<string | null>(null);
  const remember = (event: { currentTarget: HTMLInputElement }) => { before.current = event.currentTarget.value; };

  return (
    <NumericFormat
      getInputRef={(input: HTMLInputElement) => { props.inputRef.current = input; }}
      aria-label={props.label ?? 'Amount'}
      disabled={props.editable === false}
      // NumericFormat reports focus a tick late, after placing the caret, so
      // callers hear of it at once here and the selection follows its caret.
      onFocusCapture={props.onFocus}
      onFocus={(event) => {
        if (props.inline) event.currentTarget.select();
      }}
      onBlur={props.onBlur}
      placeholder={formatAmount(0, props.currency)}
      inputMode="decimal"
      value={props.value}
      valueIsNumericString
      decimalScale={minorDigits(props.currency)}
      fixedDecimalScale
      decimalSeparator="."
      allowedDecimalSeparators={['.', ',']}
      allowNegative={false}
      thousandSeparator={digitGroupSpace}
      onBeforeInput={remember}
      onChangeCapture={(event) => {
        const input = event.currentTarget;
        const original = input.value;
        const decimal = plainDecimal(original);
        const caret = input.selectionStart ?? 0;

        if (!/^\d*(?:\.\d*)?$/.test(decimal)) {
          event.stopPropagation();
          const previous = before.current ?? props.value;

          input.value = previous;
          const restored = Math.max(0, caret - (original.length - previous.length));

          input.setSelectionRange(restored, restored);
        } else if (decimal !== original.replace(/\s/g, '')) {
          // A comma or a leading point becomes the plain decimal; the caret
          // keeps its place among the characters before it.
          input.value = decimal;
          const nextCaret = plainDecimal(original.slice(0, caret)).length;

          input.setSelectionRange(nextCaret, nextCaret);
        }
      }}
      onValueChange={({ value }, source) => {
        if (source.source === 'event') props.onChangeText(value);
      }}
      onPaste={(event) => {
        // Grouping spaces, such as in a figure copied from the app, are only formatting.
        const text = event.clipboardData.getData('text').replace(/\s/g, '');

        // Reject ambiguous or over-precise pasted amounts rather than changing their meaning.
        if (!/^\d*(?:[.,]\d*)?$/.test(text) || (text.split(/[.,]/)[1]?.length ?? 0) > minorDigits(props.currency)) event.preventDefault();
      }}
      onKeyDown={(event) => {
        remember(event);

        if (event.key === 'Enter') props.onSubmitEditing();
      }}
      style={{
        flex: 1, minWidth: 0, width: '100%', height: props.height, padding: 0, border: 0,
        boxSizing: 'border-box', background: 'transparent', outline: 'none',
        color: colors.ink, fontFamily: monoFamily, fontSize: props.fontSize,
        fontWeight: 500, letterSpacing: -0.05 * props.fontSize,
        ...(props.inline && { textAlign: 'right', borderBottom: `1.5px solid ${colors.ink}`, letterSpacing: 0 }),
      }}
    />
  );
}
