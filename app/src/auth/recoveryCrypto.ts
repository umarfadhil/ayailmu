// A private native QA build's password recovery entropy and SHA-256, through a small port: the device's own (expo-crypto,
// loaded only when asked for) or one a test injects. Never getRandomBytes, a global shim or Math.random; a port that does
// not answer with the right bytes refuses instead of standing in for one. Nothing here sends, stores or logs anything.

/** Secure entropy and SHA-256, as a private recovery uses them. */
export interface RecoveryCrypto {
  /** `size` bytes from the platform's secure generator. */
  random(size: number): Uint8Array;
  /** The SHA-256 digest of `data` (32 bytes). */
  sha256(data: Uint8Array): Promise<Uint8Array | ArrayBuffer>;
}

/** Whether `port` has both methods. Whether they answer well is checked each time they are used. */
export const isRecoveryCrypto = (port: unknown): port is RecoveryCrypto =>
  typeof port === 'object' &&
  port !== null &&
  typeof (port as Partial<RecoveryCrypto>).random === 'function' &&
  typeof (port as Partial<RecoveryCrypto>).sha256 === 'function';

/** `size` bytes from `port`; throws unless it gave exactly that many, not all zero. */
export function secureBytes(port: RecoveryCrypto, size: number): Uint8Array {
  const bytes = ownBytes(port.random(size));
  if (!bytes || bytes.length !== size || bytes.every((byte) => byte === 0)) throw new Error('No secure entropy.');
  return bytes;
}

/** The SHA-256 of `data` from `port`, as 32 bytes; throws on anything else. */
export async function sha256Bytes(port: RecoveryCrypto, data: Uint8Array): Promise<Uint8Array> {
  const bytes = ownBytes(await port.sha256(data));
  if (!bytes || bytes.length !== 32) throw new Error('No SHA-256 digest.');
  return bytes;
}

/** A copy of a Uint8Array's or an ArrayBuffer's bytes, from whichever realm it came (a native module's included); else null. */
function ownBytes(value: unknown): Uint8Array | null {
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object ArrayBuffer]') return Uint8Array.from(new Uint8Array(value as ArrayBuffer));
  if (tag === '[object Uint8Array]') return Uint8Array.from(value as Uint8Array);
  return null;
}

/** Lower-case hex of `bytes`. */
export const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The bytes of an ASCII `text` (a PKCE verifier is ASCII by its pattern). */
export const asciiBytes = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0x7f);

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url of `bytes`, without Buffer or btoa (React Native need not have either). */
export function base64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64URL[a >> 2] + BASE64URL[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += BASE64URL[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += BASE64URL[c & 63];
  }
  return out;
}

type ExpoCryptoModule = Pick<typeof import('expo-crypto'), 'getRandomValues' | 'digest' | 'CryptoDigestAlgorithm'>;

/**
 * The device's port: expo-crypto's getRandomValues and digest(SHA256), loaded only now. Null when the module or either
 * method is not there; there is no weaker stand-in.
 */
export function nativeRecoveryCrypto(): RecoveryCrypto | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('expo-crypto') as ExpoCryptoModule;
    const algorithm = crypto?.CryptoDigestAlgorithm?.SHA256;
    if (typeof crypto?.getRandomValues !== 'function' || typeof crypto.digest !== 'function' || typeof algorithm !== 'string') return null;
    return {
      random: (size) => crypto.getRandomValues(new Uint8Array(size)),
      sha256: (data) => crypto.digest(algorithm, Uint8Array.from(data).buffer),
    };
  } catch {
    return null;
  }
}
