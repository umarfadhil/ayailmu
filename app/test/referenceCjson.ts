// Test-only oracle for aya-cjson-1 hashes, independent of the app's canonicalizer: JSON.parse decodes, member names
// are sorted by their UTF-8 bytes (Buffer.compare), strings are written by JSON.stringify (the same minimal escapes as
// the server's appendString for well-formed text) and hashing is Node's crypto. JSON.parse cannot keep a number's
// spelling, so this oracle refuses every number that is not a plain safe integer instead of guessing its literal.
import { createHash } from 'crypto';

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const utf8Order = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

export function referenceCanonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('reference oracle: only plain safe integers have a known literal');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(referenceCanonical).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort(utf8Order)
      .map((k) => `${JSON.stringify(k)}:${referenceCanonical(obj[k])}`)
      .join(',')}}`;
  }
  throw new Error('reference oracle: not a JSON value');
}

/** SHA-256 of aya-cjson-1({curriculum, kind, payload, schema, schema_version}) of an envelope v1 text. */
export function referenceSemanticSha256(envelope: string): string {
  const e = JSON.parse(envelope) as Record<string, unknown>;
  return sha256(referenceCanonical({ curriculum: e.curriculum, kind: e.kind, payload: e.payload, schema: e.schema, schema_version: e.schema_version }));
}

/** The receipt checksum: SHA-256 of the event IDs, repeats included, sorted bytewise and joined by newlines. */
export function referenceIdsChecksum(ids: readonly string[]): string {
  return sha256([...ids].sort(utf8Order).join('\n'));
}
