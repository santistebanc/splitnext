import { describe, expect, it } from 'vitest';
import { resolveDevtools } from '../apps/client/src/devtools/toggle';

describe('devtools toggle', () => {
  it('stays off without the URL parameter', () => {
    expect(resolveDevtools('')).toBe(false);
    expect(resolveDevtools('?group=1')).toBe(false);
  });

  it('switches on from the URL', () => {
    expect(resolveDevtools('?devtools')).toBe(true);
    expect(resolveDevtools('?devtools=1')).toBe(true);
  });

  it('switches off from the URL', () => {
    for (const value of ['0', 'off', 'false'])
      expect(resolveDevtools(`?devtools=${value}`)).toBe(false);
  });
});
