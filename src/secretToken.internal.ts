const SECRET_BYTES = 32;

/** Generates an unguessable secret suitable for a bearer-style capability. */
export function generateSecretToken(): string {
  const bytes = new Uint8Array(SECRET_BYTES);

  crypto.getRandomValues(bytes);

  return toHex(bytes);
}

/** Produces the only representation of a secret that may be persisted. */
export async function hashSecretToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', encoded);

  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
