import { describe, expect, it } from 'vitest';
import { resolveDevtools } from '../apps/client/src/devtools/toggle';

describe('devtools toggle', () => {
  it('stays off unless switched on', () => {
    expect(resolveDevtools('', null)).toEqual({ enabled: false, remember: null });
    expect(resolveDevtools('?group=1', '0')).toEqual({
      enabled: false,
      remember: null,
    });
  });

  it('switches on from the URL and remembers it', () => {
    expect(resolveDevtools('?devtools', null)).toEqual({
      enabled: true,
      remember: '1',
    });
    expect(resolveDevtools('?devtools=1', '0')).toEqual({
      enabled: true,
      remember: '1',
    });
    expect(resolveDevtools('', '1')).toEqual({ enabled: true, remember: null });
  });

  it('switches off from the URL and remembers that too', () => {
    for (const value of ['0', 'off', 'false'])
      expect(resolveDevtools(`?devtools=${value}`, '1')).toEqual({
        enabled: false,
        remember: '0',
      });
  });
});
