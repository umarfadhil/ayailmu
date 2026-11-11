// Password recovery's build flag and attempt stores (src/auth/recovery.ts), written before the change. They are reached
// through the module's namespace and a test-local type, so each missing export fails as an ordinary assertion.
// - passwordRecoveryEnabled() is true only when process.env.EXPO_PUBLIC_PASSWORD_RECOVERY is exactly "on", read when
//   called, and touches no storage.
// - memoryRecoveryStore() holds one pending attempt in RAM: a copy of a valid record only, taken once, cleared on demand.
// - sessionRecoveryStore(storage) keeps it in the given same-tab sessionStorage-like port under the one key
//   'ayailmu-recovery-attempt', and nowhere else. A save writes only a valid record and confirms the write; take reads a
//   text bounded to 2048 UTF-8 bytes before parsing it, removes it and confirms that before handing it over (single use),
//   and discards anything that is not a valid record. A refused or silently ignored write, or a clear that cannot remove
//   it, is the fixed AuthError('unavailable'); a take that cannot remove it gives nothing. Other keys are never touched,
//   and storage.clear() is never called.
// The stores are in-memory fakes; no SDK, network, browser storage or keychain is involved.
import * as recoveryModule from '@/auth/recovery';
import { recoveryAttemptRecord, type RecoveryAttemptRecord, type RecoveryAttemptStore } from '@/auth/recovery';
import { AuthError } from '@/auth/types';

/** The same-tab storage port a web build hands the session store: window.sessionStorage's three methods. */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
/** The exports this file is written before. */
interface FutureRecovery {
  passwordRecoveryEnabled?: () => boolean;
  memoryRecoveryStore?: () => RecoveryAttemptStore;
  sessionRecoveryStore?: (storage: StorageLike) => RecoveryAttemptStore;
}
const future = recoveryModule as unknown as FutureRecovery;
function need<K extends keyof FutureRecovery>(name: K): NonNullable<FutureRecovery[K]> {
  const value = future[name];
  if (typeof value !== 'function') throw new Error(`auth/recovery has no ${name} export yet.`);
  return value as NonNullable<FutureRecovery[K]>;
}

const KEY = 'ayailmu-recovery-attempt';
const RECORD: RecoveryAttemptRecord = {
  v: 1,
  flowId: '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  verifier: '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(3).concat('a1b2c3d4e5f60718'),
  callbackUrl: 'arabictrial://recover',
  createdAt: 1_790_000_000_000,
  auth: 'http://127.0.0.1:54321',
  profile: 'local',
};
/** Other keys of the same tab (a Google attempt, a remembered-session marker, guest data): never touched. */
const SENTINELS = { 'ayailmu-google-attempt': 'google-sentinel', 'ayailmu-remembered-marker': 'd1-sentinel', 'ayailmu-guest-progress': 'guest-sentinel' };
/** Test-only text in every store failure: it must never show in an error. */
const STORE_TEXT = 'STORE-TEXT-7b2e';

/** A sessionStorage-like fake over a Map, with levers to refuse or silently ignore reads, writes and removals. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries({ ...SENTINELS, ...seed }));
  const levers = { refuseRead: false, refuseWrite: false, ignoreWrite: false, refuseRemove: false, ignoreRemove: false, clears: 0 };
  const port = {
    getItem: (key: string) => {
      if (levers.refuseRead) throw new Error(`${STORE_TEXT} read refused`);
      return map.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (levers.refuseWrite) throw new Error(`${STORE_TEXT} quota exceeded`);
      if (!levers.ignoreWrite) map.set(key, value);
    },
    removeItem: (key: string) => {
      if (levers.refuseRemove) throw new Error(`${STORE_TEXT} remove refused`);
      if (!levers.ignoreRemove) map.delete(key);
    },
    /** A trap: the store must never clear the whole tab's storage. */
    clear: () => {
      levers.clears += 1;
      map.clear();
    },
  };
  const others = () => Object.fromEntries([...map].filter(([key]) => key !== KEY));
  return { map, levers, port, others };
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}
function expectUnavailable(error: unknown) {
  expect(error).toBeInstanceOf(AuthError);
  expect(error).toMatchObject({ code: 'unavailable', message: 'Account sign-in problem: unavailable' });
  expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(STORE_TEXT);
}

const undo: (() => void)[] = [];
afterEach(() => {
  while (undo.length > 0) undo.pop()?.();
});

describe('password recovery flag and stores', () => {
  it('control: the seeded record is a valid attempt record', () => {
    expect(recoveryAttemptRecord({ ...RECORD })).toEqual(RECORD);
  });

  it('turns recovery on only for EXPO_PUBLIC_PASSWORD_RECOVERY exactly "on", touching no storage', () => {
    const before = process.env.EXPO_PUBLIC_PASSWORD_RECOVERY;
    undo.push(() => (before === undefined ? delete process.env.EXPO_PUBLIC_PASSWORD_RECOVERY : (process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = before)));
    const touched: string[] = [];
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      const was = Object.getOwnPropertyDescriptor(globalThis, name);
      Object.defineProperty(globalThis, name, { configurable: true, get: () => void touched.push(name) });
      undo.push(() => (was ? Object.defineProperty(globalThis, name, was) : Reflect.deleteProperty(globalThis, name)));
    }
    const enabled = need('passwordRecoveryEnabled');
    delete process.env.EXPO_PUBLIC_PASSWORD_RECOVERY;
    expect(enabled()).toBe(false);
    for (const value of ['', 'ON', 'On', ' on', 'on ', 'true', '1', 'yes', 'enabled']) {
      process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = value;
      expect([value, enabled()]).toEqual([value, false]);
    }
    process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = 'on';
    expect(enabled()).toBe(true);
    expect(touched).toEqual([]);
  });

  it('memory store: keeps a copy of a valid record, gives it once, clears, and refuses anything else', () => {
    const store = need('memoryRecoveryStore')();
    const given = { ...RECORD };
    store.save(given);
    given.verifier = 'changed-after-save';
    expect(store.take()).toEqual(RECORD);
    expect(store.take()).toBeNull();
    store.save({ ...RECORD });
    store.clear();
    expect(store.take()).toBeNull();
    for (const bad of [{ ...RECORD, refreshToken: 'secret-refresh' }, { ...RECORD, email: 'ani@ayailmu.test' }, { ...RECORD, v: 2 }, { ...RECORD, auth: 'é'.repeat(1100) }]) {
      expectUnavailable(thrown(() => store.save(bad as unknown as RecoveryAttemptRecord)));
      expect(store.take()).toBeNull();
    }
  });

  it('session store: one key in the same tab, readable by another store over it once, never other keys', () => {
    const tab = fakeStorage();
    const sessionRecoveryStore = need('sessionRecoveryStore');
    const first = sessionRecoveryStore(tab.port);
    first.save({ ...RECORD });
    expect(JSON.parse(tab.map.get(KEY) ?? 'null')).toEqual(RECORD);
    const second = sessionRecoveryStore(tab.port);
    expect(second.take()).toEqual(RECORD);
    expect(tab.map.has(KEY)).toBe(false);
    expect(first.take()).toBeNull();
    first.save({ ...RECORD });
    second.clear();
    expect(tab.map.has(KEY)).toBe(false);
    expect(tab.others()).toEqual(SENTINELS);
    expect(tab.levers.clears).toBe(0);
  });

  it('session store: a refused, ignored or invalid write is unavailable, and nothing else is written', () => {
    const sessionRecoveryStore = need('sessionRecoveryStore');
    for (const lever of ['refuseWrite', 'ignoreWrite'] as const) {
      const tab = fakeStorage();
      tab.levers[lever] = true;
      expectUnavailable(thrown(() => sessionRecoveryStore(tab.port).save({ ...RECORD })));
      expect(tab.map.has(KEY)).toBe(false);
      expect(tab.others()).toEqual(SENTINELS);
    }
    const tab = fakeStorage();
    expectUnavailable(thrown(() => sessionRecoveryStore(tab.port).save({ ...RECORD, accessToken: 'secret-access' } as unknown as RecoveryAttemptRecord)));
    expect(tab.map.has(KEY)).toBe(false);
    expect(tab.others()).toEqual(SENTINELS);
    expect(tab.levers.clears).toBe(0);
  });

  it('session store: discards and removes anything stored that is not a valid record, oversized text before parsing it', () => {
    const sessionRecoveryStore = need('sessionRecoveryStore');
    const multiByte = JSON.stringify({ ...RECORD, auth: 'é'.repeat(1100) });
    const huge = JSON.stringify({ ...RECORD, auth: 'a'.repeat(5000) });
    expect(multiByte.length).toBeLessThan(2048);
    const parse = jest.spyOn(JSON, 'parse');
    undo.push(() => parse.mockRestore());
    for (const text of ['{not json', '[]', JSON.stringify({ ...RECORD, v: 2 }), JSON.stringify({ ...RECORD, accessToken: 'secret-access' }), multiByte, huge]) {
      const tab = fakeStorage({ [KEY]: text });
      expect([text.slice(0, 20), sessionRecoveryStore(tab.port).take()]).toEqual([text.slice(0, 20), null]);
      expect(tab.map.has(KEY)).toBe(false);
      expect(tab.others()).toEqual(SENTINELS);
    }
    expect(parse.mock.calls.some(([text]) => text === multiByte || text === huge)).toBe(false);
  });

  it('session store: gives nothing when the record cannot be read or removed, and a clear that cannot remove it is unavailable', () => {
    const sessionRecoveryStore = need('sessionRecoveryStore');
    for (const lever of ['refuseRead', 'refuseRemove', 'ignoreRemove'] as const) {
      const tab = fakeStorage({ [KEY]: JSON.stringify(RECORD) });
      tab.levers[lever] = true;
      const store = sessionRecoveryStore(tab.port);
      expect([lever, store.take()]).toEqual([lever, null]);
      if (lever !== 'refuseRead') expectUnavailable(thrown(() => store.clear()));
      expect(tab.others()).toEqual(SENTINELS);
      expect(tab.levers.clears).toBe(0);
    }
  });
});
