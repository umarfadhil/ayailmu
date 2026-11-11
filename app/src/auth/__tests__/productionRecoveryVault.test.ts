// A native production device keeps its one pending password-recovery attempt in the secure store, RED. The planned
// createSecureRecoveryStore (in @/auth/recovery) keeps it under its own key, ayailmu.pending-recovery.v1, never the
// session vault's, always readable only while unlocked, on this device only and without user authentication. A later
// store over the same parts takes it back once, exactly as saved, and leaves no verifier behind. In memory only: no
// Keychain, file, account or network is reached, and the verifier is a fixture.
import * as recoveryModule from '@/auth/recovery';
import type { RecoveryAttemptRecord, RecoveryAttemptStore } from '@/auth/recovery';
import type { SessionVaultParts, VaultStoreOptions } from '@/auth/sessionVault';

/** The planned factory, typed here before the module exports it. */
type SecureRecoveryStoreFactory = (parts: SessionVaultParts, binding: { api: string; auth: string; callbackUrl: string }, now: () => number) => RecoveryAttemptStore;
const { createSecureRecoveryStore } = recoveryModule as unknown as { createSecureRecoveryStore: SecureRecoveryStoreFactory };

const KEY = 'ayailmu.pending-recovery.v1';
const OPTIONS: VaultStoreOptions = { keychainAccessible: 7, requireAuthentication: false };
const API = 'https://api.example.org';
const AUTH = 'https://auth.example.org';
const CALLBACK = 'arabictrial://recover';
const NOW = Date.UTC(2026, 9, 22, 5, 0, 0);
const RECORD: RecoveryAttemptRecord = {
  v: 1,
  flowId: 'flow_production_01',
  verifier: 'fixture-verifier-0123456789abcdefghijklmnopqrstuvwxyz',
  callbackUrl: CALLBACK,
  createdAt: NOW,
  auth: AUTH,
  profile: 'production',
};

it('a production recovery attempt saved in the secure store is taken once, exactly, by a later store over the same parts', () => {
  const secure = new Map<string, string>();
  const calls: { key: string; options: VaultStoreOptions }[] = [];
  let marker: string | null = null;
  const parts: SessionVaultParts = {
    secureStore: {
      getItem: (key, options) => {
        calls.push({ key, options });
        return secure.get(key) ?? null;
      },
      setItem: (key, value, options) => {
        calls.push({ key, options });
        secure.set(key, value);
      },
    },
    whenUnlockedThisDeviceOnly: 7,
    marker: {
      read: () => marker,
      write: (id) => {
        marker = id;
      },
    },
    newMarker: () => 'install-1',
  };
  const binding = { api: API, auth: AUTH, callbackUrl: CALLBACK };

  createSecureRecoveryStore(parts, binding, () => NOW).save(RECORD);
  const later = createSecureRecoveryStore(parts, binding, () => NOW);
  expect(later.take()).toStrictEqual(RECORD);
  expect(later.take()).toBeNull();

  // Only the dedicated key was touched, always with the exact options.
  expect(new Set(calls.map((call) => call.key))).toEqual(new Set([KEY]));
  for (const call of calls) expect(call.options).toEqual(OPTIONS);
  // Compared as a boolean, so the verifier is never printed: none is left behind once taken.
  expect((secure.get(KEY) ?? '').includes(RECORD.verifier)).toBe(false);
});
