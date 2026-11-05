import { colors } from '../design';
import { moneyLabel } from '../model/expenses';

/** A balance figure, such as "+12.50", "−12.50", or "0.00". */
export function signedFigure(amount: number, currency: string): string {
  return `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${moneyLabel(Math.abs(amount), currency)}`;
}

/** A balance's color: green when money comes back, orange when owed, grey when settled. */
export function balanceColor(amount: number): string {
  return amount > 0 ? colors.owed : amount < 0 ? colors.danger : colors.muted;
}
