import { describe, expect, it } from 'vitest';
import { commonCurrencies, currencyOptions } from '../apps/client/src/model/currency';

const codes = (recent: string[], query: string) => currencyOptions(recent, query).map((option) => option.code);

describe('currency options', () => {
  it('lists the group’s currencies, then the common ones, then the rest, each once', () => {
    const listed = codes(['THB', 'EUR'], '');

    expect(listed.slice(0, 3)).toEqual(['THB', 'EUR', 'USD']);
    expect(listed.slice(2, commonCurrencies.length)).toEqual(commonCurrencies.filter((code) => code !== 'THB' && code !== 'EUR'));
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toContain('ISK');
  });

  it('matches a code before names, and a word start before the middle of a name', () => {
    expect(codes([], 'eur')[0]).toBe('EUR');
    expect(codes([], 'yen')[0]).toBe('JPY');
    expect(codes([], 'franc').slice(0, 1)).toEqual(['CHF']);
    expect(codes([], 'eu')[0]).toBe('EUR');
  });

  it('offers a typed three-letter code only when nothing listed matches', () => {
    expect(currencyOptions([], 'qqq')).toEqual([{ code: 'QQQ', name: 'Not a listed currency' }]);
    expect(codes([], 'yen')).not.toContain('YEN');
    expect(currencyOptions([], 'nothing like this')).toEqual([]);
  });
});
