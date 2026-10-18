// SHA-256 (FIPS 180-4) in plain TypeScript over the UTF-8 bytes of a string: the same result on the web, on native
// and in tests, with no platform crypto and no dependency. Semantic hashes and receipt checksums are built on it.

/** The SHA-256 of the UTF-8 encoding of `text`, in lowercase hex. */
export function sha256Hex(_text: string): string {
  throw new Error('sha256Hex is not implemented yet');
}
