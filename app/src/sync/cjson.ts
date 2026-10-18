// aya-cjson-1, the canonical JSON form of the account API (backend/internal/envelope/cjson.go), and the hashes built
// on it. A strict RFC 8259 reader: valid escapes only, no lone surrogates, no repeated member name (compared after
// unescaping), no data after the value, nesting of at most 64. The canonical form has no insignificant whitespace,
// members sorted by the UTF-8 bytes of their unescaped names, strings re-escaped minimally and numbers kept as their
// literal text. Errors give a code and an offset, never content.

export type CjsonErrorCode = 'invalid_json' | 'duplicate_key';

export class CjsonError extends Error {
  constructor(
    readonly code: CjsonErrorCode,
    /** Offset (in UTF-16 code units) where the text was refused. */
    readonly at: number
  ) {
    super(`aya-cjson-1 refused the text (${code} at ${at})`);
    this.name = 'CjsonError';
  }
}

/** Objects and arrays nest at most this deep, as on the server. */
export const MAX_DEPTH = 64;

/** The aya-cjson-1 form of one JSON text. Throws CjsonError. */
export function canonicalize(_text: string): string {
  throw new Error('canonicalize is not implemented yet');
}

/**
 * The semantic hash of an envelope v1 text: SHA-256 of aya-cjson-1({curriculum, kind, payload, schema,
 * schema_version}), in lowercase hex. Source and envelope_version are transport and stay out.
 */
export function semanticSha256(_envelope: string): string {
  throw new Error('semanticSha256 is not implemented yet');
}

/**
 * The import receipt checksum: SHA-256 of every event ID sent, repeats included, sorted bytewise and joined by
 * newlines, in lowercase hex.
 */
export function eventIdsSha256(_ids: readonly string[]): string {
  throw new Error('eventIdsSha256 is not implemented yet');
}
