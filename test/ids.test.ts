import { describe, expect, it } from 'vitest';
import { createIdentifier, identifierSchema } from '../src/domain/ids';

describe('compact identifiers', () => {
  it('generates unique 128-bit base64url identifiers', () => {
    const identifiers = Array.from({ length: 100 }, createIdentifier);

    expect(new Set(identifiers)).toHaveLength(identifiers.length);

    for (const identifier of identifiers) {
      expect(identifierSchema.parse(identifier)).toBe(identifier);
      expect(identifier).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('does not accept legacy UUIDs or credentials as identifiers', () => {
    expect(
      identifierSchema.safeParse('bb2f6882-6289-443d-9545-f6cde0f0ec03')
        .success,
    ).toBe(false);
    expect(identifierSchema.safeParse('A'.repeat(43)).success).toBe(false);
  });
});
