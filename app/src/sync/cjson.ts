// aya-cjson-1, the canonical JSON form of the account API (backend/internal/envelope/cjson.go), and the hashes built
// on it. A strict RFC 8259 reader: valid escapes only, no lone surrogates, no repeated member name (compared after
// unescaping), no data after the value, nesting of at most 64. The canonical form has no insignificant whitespace,
// members sorted by the UTF-8 bytes of their unescaped names, strings re-escaped minimally and numbers kept as their
// literal text. Errors give a code and an offset, never content.
import { sha256Hex } from './sha256';

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

/** One parsed value with its exact source span [start, end). */
export interface JsonNode {
  kind: 'null' | 'bool' | 'number' | 'string' | 'array' | 'object';
  start: number;
  end: number;
  /** A string's unescaped text. */
  text?: string;
  bool?: boolean;
  items?: JsonNode[];
  /** In source order; names are unique. */
  members?: { key: string; node: JsonNode }[];
}

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const HEX = '0123456789abcdef';
const isDigit = (c: number) => c >= 48 && c <= 57;

/** A strict reader that keeps each value's span. Syntax errors win over a repeated name, as on the server. */
class Reader {
  pos = 0;
  private depth = 0;
  dupAt = -1;

  constructor(private readonly src: string) {}

  fail(): never {
    throw new CjsonError('invalid_json', this.pos);
  }

  space(): void {
    for (;;) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 10 || c === 13) this.pos++;
      else return;
    }
  }

  value(): JsonNode {
    if (this.pos >= this.src.length) this.fail();
    const start = this.pos;
    const c = this.src.charCodeAt(this.pos);
    if (c === 123) return this.object();
    if (c === 91) return this.array();
    if (c === 34) {
      const text = this.string();
      return { kind: 'string', start, end: this.pos, text };
    }
    if (c === 45 || isDigit(c)) return this.number();
    for (const [word, kind, bool] of [
      ['true', 'bool', true],
      ['false', 'bool', false],
      ['null', 'null', undefined],
    ] as const) {
      if (this.src.startsWith(word, this.pos)) {
        this.pos += word.length;
        return { kind, start, end: this.pos, bool };
      }
    }
    return this.fail();
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) this.fail();
  }

  private object(): JsonNode {
    const start = this.pos;
    this.enter();
    this.pos++;
    const members: { key: string; node: JsonNode }[] = [];
    const seen = new Set<string>();
    this.space();
    if (this.src.charCodeAt(this.pos) === 125) {
      this.pos++;
      this.depth -= 1;
      return { kind: 'object', start, end: this.pos, members };
    }
    for (;;) {
      this.space();
      if (this.src.charCodeAt(this.pos) !== 34) this.fail();
      const keyAt = this.pos;
      const key = this.string();
      if (seen.has(key) && this.dupAt < 0) this.dupAt = keyAt;
      seen.add(key);
      this.space();
      if (this.src.charCodeAt(this.pos) !== 58) this.fail();
      this.pos++;
      this.space();
      members.push({ key, node: this.value() });
      this.space();
      const c = this.src.charCodeAt(this.pos);
      if (c === 44) {
        this.pos++;
        continue;
      }
      if (c === 125) {
        this.pos++;
        this.depth -= 1;
        return { kind: 'object', start, end: this.pos, members };
      }
      this.fail();
    }
  }

  private array(): JsonNode {
    const start = this.pos;
    this.enter();
    this.pos++;
    const items: JsonNode[] = [];
    this.space();
    if (this.src.charCodeAt(this.pos) === 93) {
      this.pos++;
      this.depth -= 1;
      return { kind: 'array', start, end: this.pos, items };
    }
    for (;;) {
      this.space();
      items.push(this.value());
      this.space();
      const c = this.src.charCodeAt(this.pos);
      if (c === 44) {
        this.pos++;
        continue;
      }
      if (c === 93) {
        this.pos++;
        this.depth -= 1;
        return { kind: 'array', start, end: this.pos, items };
      }
      this.fail();
    }
  }

  /** Reads a string at its opening quote; raw control characters, bad escapes and lone surrogates are refused. */
  private string(): string {
    this.pos++;
    let out = '';
    let from = this.pos;
    for (;;) {
      if (this.pos >= this.src.length) this.fail();
      const c = this.src.charCodeAt(this.pos);
      if (c === 34) {
        out += this.src.slice(from, this.pos);
        this.pos++;
        return out;
      }
      if (c === 92) {
        out += this.src.slice(from, this.pos);
        out += this.escape();
        from = this.pos;
        continue;
      }
      if (c < 0x20) this.fail();
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = this.src.charCodeAt(this.pos + 1);
        if (!(d >= 0xdc00 && d <= 0xdfff)) this.fail(); // no UTF-8 form
        this.pos += 2;
        continue;
      }
      if (c >= 0xdc00 && c <= 0xdfff) this.fail();
      this.pos++;
    }
  }

  private escape(): string {
    const c = this.src.charCodeAt(this.pos + 1);
    this.pos += 2;
    switch (c) {
      case 34:
      case 92:
      case 47:
        return String.fromCharCode(c);
      case 98:
        return String.fromCharCode(8);
      case 102:
        return String.fromCharCode(12);
      case 110:
        return String.fromCharCode(10);
      case 114:
        return String.fromCharCode(13);
      case 116:
        return String.fromCharCode(9);
      case 117: {
        const u = this.hex4();
        if (u >= 0xd800 && u <= 0xdbff) {
          if (this.src.charCodeAt(this.pos) === 92 && this.src.charCodeAt(this.pos + 1) === 117) {
            this.pos += 2;
            const lo = this.hex4();
            if (lo >= 0xdc00 && lo <= 0xdfff) return String.fromCharCode(u, lo);
          }
          this.fail();
        }
        if (u >= 0xdc00 && u <= 0xdfff) this.fail();
        return String.fromCharCode(u);
      }
      default:
        return this.fail();
    }
  }

  private hex4(): number {
    let u = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.src.charCodeAt(this.pos + i);
      const v = isDigit(c) ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1;
      if (v < 0) this.fail();
      u = u * 16 + v;
    }
    this.pos += 4;
    return u;
  }

  /** -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?, kept as its literal text. */
  private number(): JsonNode {
    const start = this.pos;
    const at = () => this.src.charCodeAt(this.pos);
    if (at() === 45) this.pos++;
    if (at() === 48) this.pos++;
    else if (at() >= 49 && at() <= 57) while (isDigit(at())) this.pos++;
    else this.fail();
    if (at() === 46) {
      this.pos++;
      if (!isDigit(at())) this.fail();
      while (isDigit(at())) this.pos++;
    }
    if (at() === 101 || at() === 69) {
      this.pos++;
      if (at() === 43 || at() === 45) this.pos++;
      if (!isDigit(at())) this.fail();
      while (isDigit(at())) this.pos++;
    }
    return { kind: 'number', start, end: this.pos };
  }
}

/** Parses one JSON text strictly, keeping every value's span. Throws CjsonError. */
export function decodeJson(text: string): JsonNode {
  const r = new Reader(text);
  r.space();
  const v = r.value();
  r.space();
  if (r.pos < text.length) r.fail();
  if (r.dupAt >= 0) throw new CjsonError('duplicate_key', r.dupAt);
  return v;
}

/** An object member, or undefined. */
export const memberOf = (node: JsonNode | undefined, key: string): JsonNode | undefined => node?.members?.find((m) => m.key === key)?.node;

/** Orders strings by their UTF-8 bytes: by code point, which UTF-16 order is not above U+FFFF. */
export function compareUtf8(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i++;
  }
  return a.length - b.length;
}

/** A string as aya-cjson-1 writes it: only quote, backslash and control characters are escaped. */
function quote(s: string): string {
  let out = '"';
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c !== 34 && c !== 92) continue;
    out += s.slice(from, i);
    if (c === 34 || c === 92) out += BS + String.fromCharCode(c);
    else if (c === 8) out += `${BS}b`;
    else if (c === 12) out += `${BS}f`;
    else if (c === 10) out += `${BS}n`;
    else if (c === 13) out += `${BS}r`;
    else if (c === 9) out += `${BS}t`;
    else out += `${BS}u00${HEX[c >> 4]}${HEX[c & 15]}`;
    from = i + 1;
  }
  return `${out}${s.slice(from)}"`;
}

function write(src: string, node: JsonNode, out: string[]): void {
  switch (node.kind) {
    case 'null':
      out.push('null');
      return;
    case 'bool':
      out.push(node.bool ? 'true' : 'false');
      return;
    case 'number':
      out.push(src.slice(node.start, node.end));
      return;
    case 'string':
      out.push(quote(node.text ?? ''));
      return;
    case 'array':
      out.push('[');
      (node.items ?? []).forEach((item, i) => {
        if (i) out.push(',');
        write(src, item, out);
      });
      out.push(']');
      return;
    case 'object': {
      const members = [...(node.members ?? [])].sort((x, y) => compareUtf8(x.key, y.key));
      out.push('{');
      members.forEach((m, i) => {
        if (i) out.push(',');
        out.push(quote(m.key), ':');
        write(src, m.node, out);
      });
      out.push('}');
    }
  }
}

/** The canonical text of one node of `src`. */
export function canonicalOf(src: string, node: JsonNode): string {
  const out: string[] = [];
  write(src, node, out);
  return out.join('');
}

/** The aya-cjson-1 form of one JSON text. Throws CjsonError. */
export function canonicalize(text: string): string {
  return canonicalOf(text, decodeJson(text));
}

/**
 * The semantic hash of an envelope v1 text: SHA-256 of aya-cjson-1({curriculum, kind, payload, schema,
 * schema_version}), in lowercase hex. Source and envelope_version are transport and stay out.
 */
export function semanticSha256(envelope: string): string {
  const root = decodeJson(envelope);
  const parts = ['curriculum', 'kind', 'payload', 'schema', 'schema_version'].map((key) => memberOf(root, key));
  if (root.kind !== 'object' || parts.some((p) => p === undefined)) throw new Error('semanticSha256: not an envelope v1');
  const [curriculum, kind, payload, schema, version] = parts.map((p) => canonicalOf(envelope, p!));
  return sha256Hex(`{"curriculum":${curriculum},"kind":${kind},"payload":${payload},"schema":${schema},"schema_version":${version}}`);
}

/**
 * The import receipt checksum: SHA-256 of every event ID sent, repeats included, sorted bytewise and joined by
 * newlines, in lowercase hex.
 */
export function eventIdsSha256(ids: readonly string[]): string {
  return sha256Hex([...ids].sort(compareUtf8).join(NL));
}
