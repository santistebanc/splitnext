/** Keep decimal input editable until Save; formatting each key prevents typing 12.34. */
export function nativeAmountDraft(value: string): string | null {
  const decimal = value.replace(',', '.');

  if (!/^\d*(?:\.\d{0,2})?$/.test(decimal)) return null;

  return decimal.startsWith('.') ? `0${decimal}` : decimal;
}
