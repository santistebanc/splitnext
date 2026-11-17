import { fromByteArray } from 'base64-js';

/** The shared identifier format uses btoa, which Hermes does not supply. */
export function encodeBinary(binary: string): string {
  const bytes = Uint8Array.from(binary, (character) => {
    const byte = character.charCodeAt(0);

    if (byte > 255) throw new Error('InvalidCharacterError');

    return byte;
  });

  return fromByteArray(bytes);
}
