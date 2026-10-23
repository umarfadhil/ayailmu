// The recovery callback's pure guards (src/auth/recovery.ts), pinned after review: the one code of a callback, and the
// pending attempt's record. A code, flow ID or verifier followed by a line terminator is refused, never handed to the SDK.
// The record's whole serialized JSON must fit 2048 UTF-8 bytes (counted as bytes, not UTF-16 code units), so an
// oversized callback or Auth text is refused before any SDK use; a record with any key beyond its seven is refused. A
// well-formed callback and a live record of exactly that shape are the passing controls. No SDK, server or network.
import { readRecoveryCallback, recoveryAttemptRecord } from '@/auth/recovery';

const CALLBACK = 'arabictrial://recover';
const CODE = '5d3c1b2a-8f7e-4d6c-9b5a-4e3d2c1b0a9f';
const MAX_RECORD_BYTES = 2048;

/** A live record of exactly the accepted shape, with `overrides`. */
const record = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  flowId: '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  verifier: '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(3).concat('a1b2c3d4e5f60718'),
  callbackUrl: CALLBACK,
  createdAt: 1_790_000_000_000,
  auth: 'http://127.0.0.1:54321',
  profile: 'local',
  ...overrides,
});

/** The fixture's own premise, measured in the test only: its JSON's UTF-8 bytes and UTF-16 code units. */
const size = (value: unknown) => {
  const text = JSON.stringify(value);
  return { bytes: Buffer.byteLength(text, 'utf8'), units: text.length };
};

describe('recovery callback code', () => {
  it('control: the exact callback with one canonical code gives that code', () => {
    expect(readRecoveryCallback(`${CALLBACK}?code=${CODE}`, CALLBACK)).toBe(CODE);
  });

  it('refuses a code followed by a line terminator', () => {
    expect(readRecoveryCallback(`${CALLBACK}?code=${CODE}\n`, CALLBACK)).toBeNull();
  });
});

describe('recovery attempt record', () => {
  it('control: a short live record of exactly its shape is accepted as it is', () => {
    const live = record();
    expect(size(live).bytes).toBeLessThan(MAX_RECORD_BYTES);
    expect(recoveryAttemptRecord(live)).toEqual(live);
  });

  it('refuses a flow ID followed by a line terminator', () => {
    expect(recoveryAttemptRecord(record({ flowId: '9f8e7d6c5b4a39281706f5e4d3c2b1a0\n' }))).toBeNull();
  });

  it('refuses a verifier followed by a line terminator', () => {
    const verifier = `${String(record().verifier)}\n`;
    expect(recoveryAttemptRecord(record({ verifier }))).toBeNull();
  });

  it('refuses a record over 2048 UTF-8 bytes that is under 2048 code units', () => {
    const multiByte = record({ auth: 'é'.repeat(1100) });
    expect(size(multiByte).units).toBeLessThan(MAX_RECORD_BYTES);
    expect(size(multiByte).bytes).toBeGreaterThan(MAX_RECORD_BYTES);
    expect(recoveryAttemptRecord(multiByte)).toBeNull();
  });

  it('refuses an oversized callback text', () => {
    const oversized = record({ callbackUrl: `${CALLBACK}?${'a'.repeat(2100)}` });
    expect(size(oversized).bytes).toBeGreaterThan(MAX_RECORD_BYTES);
    expect(recoveryAttemptRecord(oversized)).toBeNull();
  });

  it('refuses an oversized Auth text', () => {
    const oversized = record({ auth: `http://127.0.0.1:54321/${'a'.repeat(2100)}` });
    expect(size(oversized).bytes).toBeGreaterThan(MAX_RECORD_BYTES);
    expect(recoveryAttemptRecord(oversized)).toBeNull();
  });

  it.each(['refreshToken', 'accessToken', 'email', 'password'])('refuses a record carrying an extra %s key', (key) => {
    expect(recoveryAttemptRecord(record({ [key]: 'secret-value' }))).toBeNull();
  });
});
