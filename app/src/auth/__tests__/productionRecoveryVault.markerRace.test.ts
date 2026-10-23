// Two live production pending-recovery stores over the same parts, RED. When one store cannot overwrite an attempt, it
// renews this installation's marker so the attempt left behind never matches again. Another store that read the old
// marker earlier must not hand that attempt over afterwards: it goes by the marker as the database now holds it, not a
// copy it kept. In-memory parts only (a secure-store map whose writes can be refused, and a marker database): no
// Keychain, file, native module or network, and fixture values only.
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

it('a store that kept the old marker takes nothing once another store renewed it: an attempt cancelled there stays cancelled', () => {
  const secure = new Map<string, string>();
  const db: { marker: string | null } = { marker: null };
  let writesRefused = false;
  let made = 0;
  const parts: SessionVaultParts = {
    secureStore: {
      getItem: (key) => secure.get(key) ?? null,
      setItem: (key, value) => {
        if (writesRefused) throw new Error('the secure store refused a write');
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

  const first = createSecureRecoveryStore(parts, BINDING, () => NOW);
  first.save(RECORD); // the first store now knows this installation as install-1
  const second = createSecureRecoveryStore(parts, BINDING, () => NOW);
  writesRefused = true;
  expect(second.take()).toBeNull(); // it cannot overwrite the attempt, so it renews the marker instead
  writesRefused = false;

  // The attempt is physically still there, but the installation's marker is no longer the one it was saved under.
  expect(holdsVerifier()).toBe(true);
  expect(db.marker).toBe('install-2');

  expect(first.take()).toBeNull();
  expect(holdsVerifier()).toBe(false);
});
