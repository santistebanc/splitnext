import { getRandomValues, randomUUID } from 'expo-crypto';
import { encodeBinary } from './base64';

if (!globalThis.btoa) Object.defineProperty(globalThis, 'btoa', { value: encodeBinary });

// The shared SDK uses Web Crypto's secure random primitives, never Math.random.
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: {} });

if (!globalThis.crypto.getRandomValues) Object.defineProperty(globalThis.crypto, 'getRandomValues', { value: getRandomValues });

if (!globalThis.crypto.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });
