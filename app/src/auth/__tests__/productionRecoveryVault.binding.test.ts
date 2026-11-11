// The production pending-recovery store's binding, hardening. A kept attempt is taken only by this installation, account
// API, Auth root and native callback, as the store captured them when it was built, within its lifetime and only when
// its kept text is whole: anything else is null, and the attempt is removed all the same, so its verifier is never
// handed over or left behind. A record of another profile or callback is never saved. Each case has its own in-memory
// parts (a secure-store map and a marker database): no Keychain, file, native module or network, and fixture values only.
import { createSecureRecoveryStore, RECOVERY_ATTEMPT_TTL_MS, RECOVERY_CLOCK_SKEW_MS, RECOVERY_VAULT_KEY, type RecoveryAttemptRecord } from '@/auth/recovery';
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

/** Fresh in-memory parts: the secure store's map and this installation's marker database. */
function rig() {
  const secure = new Map<string, string>();
  const db: { marker: string | null } = { marker: null };
  let made = 0;
  const parts: SessionVaultParts = {
    secureStore: {
      getItem: (key) => secure.get(key) ?? null,
      setItem: (key, value) => {
        secure.set(key, value);
      },
    },
    whenUnlockedThisDeviceOnly: 7,
    marker: {
      read: () => db.marker,
      write: (id) => {
        db.marker = id;
      },
    },
    newMarker: () => `install-${(made += 1)}`,
  };
  /** Whether the kept text still holds the verifier: a boolean, so it is never printed. */
  const holdsVerifier = () => (secure.get(RECOVERY_VAULT_KEY) ?? '').includes(RECORD.verifier);
  return { secure, db, parts, holdsVerifier };
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

it('a saved attempt is taken only by this installation, API and Auth root, as captured at build time, and is removed either way', () => {
  const reinstalled = rig();
  createSecureRecoveryStore(reinstalled.parts, BINDING, at(NOW)).save(RECORD);
  reinstalled.db.marker = null; // a new installation: the secure item outlived the marker database
  expect(createSecureRecoveryStore(reinstalled.parts, BINDING, at(NOW)).take()).toBeNull();
  expect(reinstalled.holdsVerifier()).toBe(false);

  for (const other of [{ ...BINDING, api: 'https://api-other.example.org' }, { ...BINDING, auth: 'https://auth-other.example.org' }]) {
    const { parts, holdsVerifier } = rig();
    createSecureRecoveryStore(parts, BINDING, at(NOW)).save(RECORD);
    expect({ other, taken: createSecureRecoveryStore(parts, other, at(NOW)).take() }).toEqual({ other, taken: null });
    expect(holdsVerifier()).toBe(false);
  }

  // The binding is captured: changing the caller's object afterwards redirects nothing.
  const { parts, holdsVerifier } = rig();
  const binding = { ...BINDING };
  const store = createSecureRecoveryStore(parts, binding, at(NOW));
  Object.assign(binding, { api: 'https://api-other.example.org', auth: 'https://auth-other.example.org', callbackUrl: 'arabictrial://other' });
  expect(thrown(() => store.save({ ...RECORD, auth: binding.auth, callbackUrl: binding.callbackUrl }))).toMatchObject({ code: 'unavailable' });
  store.save(RECORD);
  expect(createSecureRecoveryStore(parts, BINDING, at(NOW)).take()).toStrictEqual(RECORD);
  expect(holdsVerifier()).toBe(false);
});

it('a kept attempt altered in the store is never taken, and a record of another profile or callback is never saved', () => {
  const altered: [string, Record<string, string>][] = [
    ['the local profile', { profile: 'local' }],
    ['another public Auth root', { auth: 'https://auth-other.example.org' }],
    ['another callback', { callbackUrl: 'arabictrial://other' }],
    ['an extra key', { extra: 'x' }],
  ];
  for (const [name, change] of altered) {
    const { secure, parts, holdsVerifier } = rig();
    createSecureRecoveryStore(parts, BINDING, at(NOW)).save(RECORD);
    const envelope = JSON.parse(secure.get(RECOVERY_VAULT_KEY) ?? '{}') as Record<string, unknown>;
    secure.set(RECOVERY_VAULT_KEY, JSON.stringify({ ...envelope, record: { ...(envelope.record as Record<string, unknown>), ...change } }));
    expect({ name, taken: createSecureRecoveryStore(parts, BINDING, at(NOW)).take() }).toEqual({ name, taken: null });
    expect(holdsVerifier()).toBe(false);
  }

  for (const wrong of [{ ...RECORD, profile: 'staging' as const }, { ...RECORD, callbackUrl: 'arabictrial://other' }]) {
    const { parts, holdsVerifier } = rig();
    expect(thrown(() => createSecureRecoveryStore(parts, BINDING, at(NOW)).save(wrong))).toMatchObject({ code: 'unavailable' });
    expect(holdsVerifier()).toBe(false);
  }
});

it('an attempt past its lifetime or from beyond the clock skew, or kept text that is malformed or oversized, is never taken and is removed', () => {
  const times: [string, number, number][] = [
    ['past its lifetime', NOW, NOW + RECOVERY_ATTEMPT_TTL_MS + 1],
    ['from beyond the clock skew', NOW + RECOVERY_CLOCK_SKEW_MS + 1, NOW],
  ];
  for (const [name, createdAt, takenAt] of times) {
    const { parts, holdsVerifier } = rig();
    createSecureRecoveryStore(parts, BINDING, at(createdAt)).save({ ...RECORD, createdAt });
    expect({ name, taken: createSecureRecoveryStore(parts, BINDING, at(takenAt)).take() }).toEqual({ name, taken: null });
    expect(holdsVerifier()).toBe(false);
  }

  // Each kept text below holds the verifier; a whole envelope with trailing spaces would parse, so only the size refuses it.
  const texts: [string, (kept: string) => string][] = [
    ['malformed JSON', (kept) => kept.slice(0, -1)],
    ['over 2048 UTF-8 bytes', (kept) => `${kept}${' '.repeat(2048)}`],
  ];
  for (const [name, spoil] of texts) {
    const { secure, parts, holdsVerifier } = rig();
    createSecureRecoveryStore(parts, BINDING, at(NOW)).save(RECORD);
    secure.set(RECOVERY_VAULT_KEY, spoil(secure.get(RECOVERY_VAULT_KEY) ?? ''));
    expect({ name, taken: createSecureRecoveryStore(parts, BINDING, at(NOW)).take() }).toEqual({ name, taken: null });
    expect(holdsVerifier()).toBe(false);
  }
});
