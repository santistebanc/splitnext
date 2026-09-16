import { describe, expect, it } from 'vitest';
import { deviceUserIdSchema } from '../src/accessCredential';
import { accessHeadersSchema } from '../src/routes/groupRequest';

describe('module import order', () => {
  it('loads HTTP schemas after a plain-Zod domain schema', () => {
    const accessToken = 'a'.repeat(64);

    expect(deviceUserIdSchema.parse(' device-1 ')).toBe('device-1');

    expect(
      accessHeadersSchema.parse({
        authorization: `Bearer ${accessToken}`,
        'x-device-user-id': ' device-1 ',
      }),
    ).toEqual({
      authorization: `Bearer ${accessToken}`,
      'x-device-user-id': 'device-1',
    });
  });
});
