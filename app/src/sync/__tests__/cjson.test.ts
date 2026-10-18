/**
 * @jest-environment node
 */
// aya-cjson-1 and its hashes must agree with the server, written before their implementation. The oracles are
// independent of the app: the Go vectors of backend/internal/envelope (TestCanonicalizeVectors), the six real contract
// fixtures (byte-identical copies in test/fixtures/envelopes) hashed by a JSON.parse-based reference with Node's
// crypto, and the documented semantic-hash input. Escapes are assembled at run time so no editor or transport can
// decode them in this source.
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { canonicalize, CjsonError, eventIdsSha256, semanticSha256 } from '@/sync/cjson';
import { sha256Hex } from '@/sync/sha256';
import { objectMembers } from '@/storage/rawRecords';
import { referenceIdsChecksum, referenceSemanticSha256, sha256 } from '../../../test/referenceCjson';

const BS = String.fromCharCode(92);
/** The JSON escape of one UTF-16 code unit. */
const esc = (hex4: string) => `${BS}u${hex4}`;
const cp = (...points: number[]) => String.fromCodePoint(...points);

const FIXTURES = [
  'expo-v1-typed.envelope.json',
  'expo-v1-pending.envelope.json',
  'expo-v2-practice.envelope.json',
  'expo-v2-check-deferred.envelope.json',
  'kotlin-v1-arab-type-in-hinted.envelope.json',
  'kotlin-v1-arab-choose-defaults-omitted.envelope.json',
];
const fixture = (name: string) => readFileSync(join(__dirname, '..', '..', '..', 'test', 'fixtures', 'envelopes', name), 'utf8').replace(/\n$/, '');

function refused(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

/** Replaces one occurrence that must exist, so a changed fixture fails setup loudly instead of silently testing nothing. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`test setup: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
}

describe('aya-cjson-1', () => {
  it('matches the server vectors: whitespace, member order by UTF-8 bytes, literal numbers, minimal escapes, depth', () => {
    const eAcute = cp(0xe9);
    const sadiqun = cp(0x635, 0x64e, 0x627, 0x62f, 0x650, 0x642, 0x64c);
    const nest = (n: number) => '['.repeat(n) + ']'.repeat(n);
    const cases: { name: string; input: string; want: string }[] = [
      // TestCanonicalizeVectors, verbatim.
      { name: 'whitespace and member order', input: ` { "b" : 1 , "a" : [ true , null , false ] } `, want: `{"a":[true,null,false],"b":1}` },
      { name: 'nested objects sorted, array order kept', input: `{"z":{"y":2,"x":[{"b":1,"a":2},3]},"a":0}`, want: `{"a":0,"z":{"x":[{"a":2,"b":1},3],"y":2}}` },
      { name: 'keys sorted by UTF-8 bytes', input: `{"${eAcute}":1,"z":2,"A":3,"a":4,"_":5}`, want: `{"A":3,"_":5,"a":4,"z":2,"${eAcute}":1}` },
      { name: 'numbers kept as literal text', input: `{"a":1.50,"b":-0,"c":1e3,"d":12345678901234567890}`, want: `{"a":1.50,"b":-0,"c":1e3,"d":12345678901234567890}` },
      { name: 'needless escapes removed', input: `{"s":"${esc('00e9')}${esc('0041')}${BS}/"}`, want: `{"s":"${eAcute}A/"}` },
      {
        name: 'control characters escaped minimally',
        input: `{"s":"${esc('0001')}${esc('001F')}${esc('0008')}${esc('000c')}${esc('000A')}${esc('000d')}${esc('0009')}"}`,
        want: `{"s":"${esc('0001')}${esc('001f')}${BS}b${BS}f${BS}n${BS}r${BS}t"}`,
      },
      { name: 'quote and backslash', input: `{"s":"a${BS}"b${BS}${BS}c"}`, want: `{"s":"a${BS}"b${BS}${BS}c"}` },
      {
        name: 'Arabic decoded from escapes',
        input: `{"s":"${['0635', '064e', '0627', '062f', '0650', '0642', '064c'].map(esc).join('')}"}`,
        want: `{"s":"${sadiqun}"}`,
      },
      { name: 'surrogate pair decoded', input: `{"s":"${esc('d83d')}${esc('de00')}"}`, want: `{"s":"${cp(0x1f600)}"}` },
      { name: 'DEL and U+2028 become literal', input: `{"s":"${esc('007f')}${esc('2028')}"}`, want: `{"s":"${cp(0x7f, 0x2028)}"}` },
      { name: 'top-level scalar', input: ` "x" `, want: `"x"` },
      // The documented rule where UTF-16 order differs: U+FF61 (UTF-8 EF BD A1) sorts before U+1F600 (F0 9F 98 80).
      { name: 'UTF-8 order, not UTF-16 order', input: `{"${cp(0x1f600)}":1,"${cp(0xff61)}":2}`, want: `{"${cp(0xff61)}":2,"${cp(0x1f600)}":1}` },
      { name: '64 nested arrays are accepted', input: nest(64), want: nest(64) },
    ];
    for (const c of cases) expect({ name: c.name, out: canonicalize(c.input) }).toEqual({ name: c.name, out: c.want });

    const bad: { name: string; input: string; code: string }[] = [
      { name: 'duplicate key', input: `{"a":1,"a":1}`, code: 'duplicate_key' },
      { name: 'duplicate key after unescaping', input: `{"a":1,"${esc('0061')}":2}`, code: 'duplicate_key' },
      { name: 'nested duplicate key', input: `{"x":[{"k":1,"k":2}]}`, code: 'duplicate_key' },
      { name: 'lone high surrogate escape', input: `{"a":"${esc('d800')}"}`, code: 'invalid_json' },
      { name: 'lone low surrogate escape', input: `{"a":"${esc('dc00')}x"}`, code: 'invalid_json' },
      { name: 'high surrogate followed by a non-surrogate', input: `{"a":"${esc('d83d')}${esc('0041')}"}`, code: 'invalid_json' },
      { name: 'raw lone surrogate (no UTF-8 form)', input: `{"a":"${String.fromCharCode(0xd800)}"}`, code: 'invalid_json' },
      { name: 'raw control character', input: `{"a":"${String.fromCharCode(10)}"}`, code: 'invalid_json' },
      { name: 'trailing data', input: `{"a":1} {"b":2}`, code: 'invalid_json' },
      { name: 'truncated', input: `{"a":`, code: 'invalid_json' },
      { name: 'empty input', input: ``, code: 'invalid_json' },
      { name: '65 nested arrays', input: nest(65), code: 'invalid_json' },
      { name: '65 nested objects', input: `${'{"a":'.repeat(65)}1${'}'.repeat(65)}`, code: 'invalid_json' },
    ];
    for (const b of bad) {
      const error = refused(() => canonicalize(b.input));
      expect({ name: b.name, isCjsonError: error instanceof CjsonError, code: (error as CjsonError | null)?.code }).toEqual({ name: b.name, isCjsonError: true, code: b.code });
      // The refusal names a code and an offset, never the input.
      if (b.input.length > 8) expect(String(error)).not.toContain(b.input);
    }
  });

  it('SHA-256 of UTF-8 text agrees with Node crypto', () => {
    const ascii = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join('');
    for (const text of ['', 'abc', cp(0x635, 0x64e, 0x627, 0x62f, 0x650, 0x642, 0x64c), cp(0x1f600), 'a'.repeat(1000), ascii]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });

  it('semantic hashes of the six real fixtures and the receipt checksum agree with the independent reference', () => {
    for (const name of FIXTURES) {
      const text = fixture(name);
      expect({ name, hash: semanticSha256(text) }).toEqual({ name, hash: referenceSemanticSha256(text) });
    }

    // Transport never changes the hash: another install and app version, reordered members with whitespace, an escape.
    const base = fixture('expo-v2-practice.envelope.json');
    const members = objectMembers(base);
    const want = referenceSemanticSha256(base);
    const reinstalled = swap(base, `"install_id":"inst-fx-expo-a","app_version":"0.3.0"`, `"install_id":"inst-fx-reinstalled","app_version":"0.4.0"`);
    const reordered =
      ` {\n "payload" : ${members.get('payload')} , "source":${members.get('source')},` +
      ` "curriculum" : {"rules_version":"pilot-0.3-local","content_version":"demo-synthetic-0.3","track":"arab","family":"expo-trial-arabic"},` +
      ` "schema_version":2,"schema":"expo.answer_record","kind":"answer","event_id":"ans-fx-v2-practice","envelope_version":1 } `;
    const escaped = swap(base, `"text":"orang yang jujur"`, `"text":"orang yang ${esc('006a')}ujur"`);
    for (const [name, text] of [['reinstalled', reinstalled], ['reordered', reordered], ['escaped', escaped]] as const) {
      expect({ name, hash: semanticSha256(text) }).toEqual({ name, hash: want });
    }
    // Content always does, number spelling included (numbers compare as text).
    const flipped = swap(base, `"synthetic":true`, `"synthetic":false`);
    expect(semanticSha256(flipped)).toBe(referenceSemanticSha256(flipped));
    expect(semanticSha256(flipped)).not.toBe(want);
    expect(semanticSha256(swap(base, `"time_on_item_ms":5300`, `"time_on_item_ms":5.3e3`))).not.toBe(want);
    // An envelope that is not canonical JSON has no hash: the duplicate is refused, not resolved.
    const duplicated = swap(base, `"outcome":"correct"`, `"outcome":"correct","${esc('006f')}utcome":"wrong"`);
    expect(refused(() => semanticSha256(duplicated))).toMatchObject({ code: 'duplicate_key' });

    // Receipt checksum: every ID sent, repeats included, sorted bytewise, joined by newlines.
    const sent = ['ans-f-2', 'ans-f-1', 'ans-f-1'];
    expect(eventIdsSha256(sent)).toBe(referenceIdsChecksum(sent));
    expect(eventIdsSha256(sent)).toBe(sha256(['ans-f-1', 'ans-f-1', 'ans-f-2'].join(String.fromCharCode(10))));
    expect(eventIdsSha256(sent)).not.toBe(referenceIdsChecksum(['ans-f-1', 'ans-f-2']));
    expect(eventIdsSha256([])).toBe(sha256(''));
  });
});
