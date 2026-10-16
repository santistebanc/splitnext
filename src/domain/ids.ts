import { z } from 'zod';

const identifierPattern = /^[A-Za-z0-9_-]{22}$/;

export const identifierSchema = z.string().regex(identifierPattern).meta({
  description: 'A 128-bit identifier encoded as unpadded base64url.',
  example: 'uy9ogmKJRD2VRfbN4PDsAw',
});

export type Identifier = z.output<typeof identifierSchema>;

/** Unpadded base64url, the encoding of identifiers, secrets, and token hashes. */
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function createIdentifier(): Identifier {
  return identifierSchema.parse(
    base64url(crypto.getRandomValues(new Uint8Array(16))),
  );
}
