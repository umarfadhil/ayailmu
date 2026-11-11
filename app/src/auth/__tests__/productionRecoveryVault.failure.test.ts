// The production pending-recovery store when its storage fails, hardening. A read, an overwrite or a write that fails,
// or that is silently not done (its confirmation does not match), hands no attempt over, and the store that met it keeps
// refusing even after the storage recovers. When an attempt cannot be overwritten it may physically remain, and nothing
// claims otherwise: this installation's marker is renewed instead, so no later store takes it. A marker that cannot be
// read or written fails closed too. Each case has its own in-memory parts (a secure-store map with injected faults and a
// marker database) and no delete at all: no Keychain, file, native module or network, and fixture values only.
import { createSecureRecoveryStore, RECOVERY_VAULT_KEY, type RecoveryAttemptRecord } from '@/auth/recovery';
import type { SessionVaultParts } from '@/auth/sessionVault';

const API = 'https://api.example.org';
const AUTH = 'https://auth.example.org';
const CALLBACK = 'arabictrial://recover';
const NOW = Date.UTC(2026, 9, 22, 5, 0, 0);
const BINDING = { api: API, auth: AUTH, callbackUrl: CALLBACK };
const RECORD: RecoveryAttemptRecord = {
  v: 1,
  flowId: 'flow_production_01',
  verifier: 'fixture-verifier-0123456789abcdefghijklmnopqrstuvwxyz',
  callbackUrl: CALLBACK,
  createdAt: NOW,
  auth: AUTH,
  profile: 'production',
};
const at = (time: number) => () => time;

/** Fresh in-memory parts with switchable faults: thrown reads or writes, silently dropped writes, and marker faults. */
function rig() {
  const secure = new Map<string, string>();
  const db: { marker: string | null } = { marker: null };
  const faults = { read: false, write: false, dropWrites: false, dropRecords: false, markerRead: false, markerWrite: false, dropMarker: false };
  let made = 0;
  const parts: SessionVaultParts = {
    secureStore: {
      getItem: (key) => {
        if (faults.read) throw new Error('the secure store refused a read');
        return secure.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (faults.write) throw new Error('the secure store refused a write');
        // Silently not done: every write, or only those holding an attempt (a non-record overwrite still lands).
        if (faults.dropWrites || (faults.dropRecords && value.includes(RECORD.verifier))) return;
        secure.set(key, value);
      },
    },
    whenUnlockedThisDeviceOnly: 7,
    marker: {
      read: () => {
        if (faults.markerRead) throw new Error('the marker database refused a read');
        return db.marker;
      },
      write: (id) => {
        if (faults.markerWrite) throw new Error('the marker database refused a write');
        if (!faults.dropMarker) db.marker = id;
      },
    },
    newMarker: () => `install-${(made += 1)}`,
  };
  /** Whether the kept text still holds the verifier: a boolean, so it is never printed. */
  const holdsVerifier = () => (secure.get(RECOVERY_VAULT_KEY) ?? '').includes(RECORD.verifier);
  return { db, faults, parts, holdsVerifier };
}

/** What `act` throws, or null. */
function thrown(act: () => void): unknown {
  try {
    act();
    return null;
  } catch (error) {
    return error;
  }
}

it('a store whose read fails takes nothing and keeps refusing after the storage recovers; a new store clears and starts afresh', () => {
  const { faults, parts } = rig();
  createSecureRecoveryStore(parts, BINDING, at(NOW)).save(RECORD);
  const store = createSecureRecoveryStore(parts, BINDING, at(NOW));
  faults.read = true;
  expect(store.take()).toBeNull();
  faults.read = false; // the storage recovers
  expect(store.take()).toBeNull();
  expect(thrown(() => store.save(RECORD))).toMatchObject({ code: 'unavailable' });

  const fresh = createSecureRecoveryStore(parts, BINDING, at(NOW));
  fresh.clear();
  const next = { ...RECORD, flowId: 'flow_production_02' };
  fresh.save(next);
  expect(createSecureRecoveryStore(parts, BINDING, at(NOW)).take()).toStrictEqual(next);
  expect(createSecureRecoveryStore(parts, BINDING, at(NOW)).take()).toBeNull();
});

it('an attempt that cannot be overwritten is never handed over: the marker is renewed, and no later store takes it', () => {
  for (const fault of ['write', 'dropWrites'] as const) {
    const { db, faults, parts, holdsVerifier } = rig();
    createSecureRecoveryStore(parts, BINDING, at(NOW)).save(RECORD);
    const store = createSecureRecoveryStore(parts, BINDING, at(NOW));
    faults[fault] = true;
    expect({ fault, taken: store.take() }).toEqual({ fault, taken: null });
    faults[fault] = false; // the storage recovers
    expect(store.take()).toBeNull();
    expect(thrown(() => store.save(RECORD))).toMatchObject({ code: 'unavailable' });
    // The attempt may physically remain, and is not claimed gone; its installation is no longer this one.
    expect(holdsVerifier()).toBe(true);
    expect(db.marker).not.toBeNull();
    expect(db.marker).not.toBe('install-1');
    expect(createSecureRecoveryStore(parts, BINDING, at(NOW)).take()).toBeNull();
  }

  // A clear the store refuses: unavailable, the attempt left as it is, the marker renewed, nothing taken later.
  const { db, faults, parts, holdsVerifier } = rig();
  const store = createSecureRecoveryStore(parts, BINDING, at(NOW));
  store.save(RECORD);
  faults.write = true;
  expect(thrown(() => store.clear())).toMatchObject({ code: 'unavailable' });
  faults.write = false;
  expect(holdsVerifier()).toBe(true);
  expect(db.marker).not.toBe('install-1');
  expect(thrown(() => store.save(RECORD))).toMatchObject({ code: 'unavailable' });
  expect(createSecureRecoveryStore(parts, BINDING, at(NOW)).take()).toBeNull();
});

it('a save whose write cannot be confirmed, or whose marker cannot be read or written, throws unavailable and keeps nothing', () => {
  for (const fault of ['dropRecords', 'markerRead', 'markerWrite', 'dropMarker'] as const) {
    const { faults, parts, holdsVerifier } = rig();
    const store = createSecureRecoveryStore(parts, BINDING, at(NOW));
    faults[fault] = true;
    expect({ fault, refusal: thrown(() => store.save(RECORD)) }).toMatchObject({ fault, refusal: { code: 'unavailable' } });
    faults[fault] = false;
    expect(holdsVerifier()).toBe(false);
    expect(store.take()).toBeNull();
    expect(createSecureRecoveryStore(parts, BINDING, at(NOW)).take()).toBeNull();
  }
});
