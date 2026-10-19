// The short-lived record of the one pending Google attempt, written before its implementation (phase 10). Between
// leaving for the browser and the callback, the app keeps only what PKCE needs to finish that attempt (the SDK's flow
// id and code verifier) with its exact callback and start time, never a token or a session. On the web a full-page
// redirect ends the page's memory, so the record waits in this tab's sessionStorage (never localStorage: not shared
// with other tabs, gone with the tab) under one key; on native the app stays alive behind the system browser, so it
// stays in RAM. Either store holds one record, hands it over once and drops anything malformed.
import { GOOGLE_ATTEMPT_KEY, memoryGoogleStore, sessionGoogleStore, type GoogleAttemptRecord, type PendingGoogleStore } from '@/auth/google';

const T = Date.UTC(2026, 9, 19, 4, 0, 0);
/** As the SDK makes them: a 32-hex flow id and a 112-hex code verifier. */
const RECORD: GoogleAttemptRecord = { v: 1, flowId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', verifier: 'ab'.repeat(56), callbackUrl: 'http://localhost:8081/account', createdAt: T };
const NEWER: GoogleAttemptRecord = { ...RECORD, flowId: '1f1e2d3c4b5a69788796a5b4c3d2e1f0', verifier: 'cd'.repeat(56), createdAt: T + 60_000 };

/** This tab's sessionStorage, its entries visible to the test. */
function fakeSessionStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: jest.fn((key: string) => items.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      items.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      items.delete(key);
    }),
  };
}

const STORES: [string, () => PendingGoogleStore][] = [
  ["the web store (this tab's sessionStorage)", () => sessionGoogleStore(fakeSessionStorage())],
  ['the native store (RAM)', () => memoryGoogleStore()],
];

describe.each(STORES)('%s', (_name, open) => {
  it('holds one record, hands it over once, keeps only the latest attempt, and clear removes it', () => {
    const store = open();
    expect(store.take()).toBeNull();

    store.save(RECORD);
    expect(store.take()).toEqual(RECORD);
    expect(store.take()).toBeNull(); // single use

    store.save(RECORD);
    store.save(NEWER);
    expect(store.take()).toEqual(NEWER); // one slot: a newer attempt replaces an older one
    expect(store.take()).toBeNull();

    store.save(RECORD);
    store.clear();
    expect(store.take()).toBeNull();
  });
});

describe("the web store in this tab's sessionStorage", () => {
  it('writes exactly the record under its one key and nothing else; taking it removes the entry', () => {
    const storage = fakeSessionStorage();
    const store = sessionGoogleStore(storage);

    store.save(RECORD);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = storage.setItem.mock.calls[0];
    expect(key).toBe(GOOGLE_ATTEMPT_KEY);
    expect(JSON.parse(value)).toEqual(RECORD); // exactly the record's fields: no token, session or address
    expect([...storage.items.keys()]).toEqual([GOOGLE_ATTEMPT_KEY]);

    expect(store.take()).toEqual(RECORD);
    expect(storage.items.size).toBe(0);
    // Only its own key is ever read or removed.
    for (const [used] of [...storage.getItem.mock.calls, ...storage.removeItem.mock.calls]) expect(used).toBe(GOOGLE_ATTEMPT_KEY);
  });

  const MALFORMED: [string, string][] = [
    ['not JSON', '{"v":1,'],
    ['JSON null', 'null'],
    ['an array', '[]'],
    ['another version', JSON.stringify({ ...RECORD, v: 2 })],
    ['no verifier', JSON.stringify({ ...RECORD, verifier: undefined })],
    ['a verifier too short for PKCE', JSON.stringify({ ...RECORD, verifier: 'abc123' })],
    ["a password-recovery verifier (the SDK's «/recovery» form)", JSON.stringify({ ...RECORD, verifier: `${'ab'.repeat(30)}/recovery` })],
    ['a flow id that is no flow id', JSON.stringify({ ...RECORD, flowId: '../../code-verifier' })],
    ['a start time that is not a number', JSON.stringify({ ...RECORD, createdAt: '2026-10-19T04:00:00Z' })],
    ['a callback that is not text', JSON.stringify({ ...RECORD, callbackUrl: 42 })],
    ['a token beside the record', JSON.stringify({ ...RECORD, access_token: 'leaked-access-token' })],
  ];
  it.each(MALFORMED)('%s: nothing is handed over, and the entry is removed', (_case, raw) => {
    const storage = fakeSessionStorage();
    storage.items.set(GOOGLE_ATTEMPT_KEY, raw);
    const store = sessionGoogleStore(storage);
    expect(store.take()).toBeNull();
    expect(storage.items.has(GOOGLE_ATTEMPT_KEY)).toBe(false);
  });

  it('a sessionStorage that refuses writes makes saving fail; one that fails reads hands nothing over', () => {
    const refusing = {
      getItem: jest.fn((): string | null => {
        throw new Error('SecurityError');
      }),
      setItem: jest.fn((): void => {
        throw new Error('QuotaExceededError');
      }),
      removeItem: jest.fn(),
    };
    const store = sessionGoogleStore(refusing);
    expect(() => store.save(RECORD)).toThrow();
    expect(store.take()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });
});
