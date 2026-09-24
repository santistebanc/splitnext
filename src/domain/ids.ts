import { z } from 'zod';

const identifierPattern = /^[A-Za-z0-9_-]{22}$/;

export const identifierSchema = z.string().regex(identifierPattern).meta({
  description: 'A 128-bit identifier encoded as unpadded base64url.',
  example: 'uy9ogmKJRD2VRfbN4PDsAw',
});

export type Identifier = z.output<typeof identifierSchema>;

export function createIdentifier(): Identifier {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

  const encoded = btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

  return identifierSchema.parse(encoded);
}
