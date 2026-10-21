// The secure session vault on a native device (D1 in docs/plans/2026-10-20-session-recovery.md). The one remembered
// sign-in record is kept in expo-secure-store (the iOS Keychain, or Android Keystore-encrypted storage). It is read and
// written synchronously, readable only while the device is unlocked, never moved to another device, and never behind a
// biometric prompt. This installation's non-secret marker lives in a small expo-sqlite database of its own. The
// database goes with the app when it is uninstalled, but a Keychain item may outlive it, so a record from an earlier
// installation never matches again. The native modules load only when a remembering build asks for the vault. The web
// build uses sessionVault.web.ts, which has no vault.
import type { SessionVault } from '@/auth/types';

/** The secure store's key for the one remembered record. */
export const SESSION_VAULT_KEY = 'ayailmu.remembered-session.v1';
/** What a cleared record is overwritten with: never a record, so it reads as nothing. */
const CLEARED = 'cleared';
/** The installation marker's own database: nothing else is kept in it. */
const MARKER_DATABASE = 'ayailmu-installation.db';

/** The secure store's options on every call: only while unlocked, on this device only, without user authentication. */
export interface VaultStoreOptions {
  keychainAccessible: number;
  requireAuthentication: false;
}

/** What the vault is made of: the secure store's synchronous calls, its accessibility constant and the marker's store. */
export interface SessionVaultParts {
  secureStore: {
    getItem(key: string, options: VaultStoreOptions): string | null;
    setItem(key: string, value: string, options: VaultStoreOptions): void;
  };
  /** expo-secure-store's WHEN_UNLOCKED_THIS_DEVICE_ONLY. */
  whenUnlockedThisDeviceOnly: number;
  /** This installation's marker, as its own database keeps it: null before the first. */
  marker: { read(): string | null; write(id: string): void };
  /** A new random marker. */
  newMarker: () => string;
}

/**
 * The vault over its parts. A clear overwrites the record synchronously and never deletes it: a delete still on its
 * way could land after a newer record was saved under the same key, and erase it. When the secure store refuses that
 * overwrite, the marker is renewed instead, so the record left behind never matches this installation again. The
 * refusal is still thrown, since the record is still there.
 */
export function createSessionVault({ secureStore, whenUnlockedThisDeviceOnly, marker, newMarker }: SessionVaultParts): SessionVault {
  const options: VaultStoreOptions = { keychainAccessible: whenUnlockedThisDeviceOnly, requireAuthentication: false };
  let installation: string | null = null;
  const renew = (): string => {
    const fresh = newMarker();
    marker.write(fresh);
    installation = fresh;
    return fresh;
  };
  return {
    installation() {
      if (installation !== null) return installation;
      const kept = marker.read();
      if (typeof kept === 'string' && kept !== '') {
        installation = kept;
        return kept;
      }
      return renew();
    },
    read() {
      const text = secureStore.getItem(SESSION_VAULT_KEY, options);
      return text === CLEARED ? null : text;
    },
    write(text) {
      secureStore.setItem(SESSION_VAULT_KEY, text, options);
    },
    clear() {
      try {
        secureStore.setItem(SESSION_VAULT_KEY, CLEARED, options);
      } catch (error) {
        try {
          renew();
        } catch {
          // Neither: the refusal below says so.
        }
        throw error;
      }
    },
  };
}

type SecureStoreModule = Pick<typeof import('expo-secure-store'), 'getItem' | 'setItem' | 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'>;
type SqliteModule = Pick<typeof import('expo-sqlite'), 'openDatabaseSync'>;
type CryptoModule = Pick<typeof import('expo-crypto'), 'randomUUID'>;

/**
 * This device's session vault, or null where there is none: a build without the native modules, or a marker database
 * that will not open. The modules load only here, so a build that does not remember never loads them.
 */
export function deviceSessionVault(): SessionVault | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const secureStore = require('expo-secure-store') as SecureStoreModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require('expo-sqlite') as SqliteModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('expo-crypto') as CryptoModule;
    const db = sqlite.openDatabaseSync(MARKER_DATABASE);
    // One row at most, replaced whole by one statement.
    db.execSync('CREATE TABLE IF NOT EXISTS installation (slot INTEGER PRIMARY KEY CHECK (slot = 1), id TEXT NOT NULL)');
    return createSessionVault({
      secureStore,
      whenUnlockedThisDeviceOnly: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      marker: {
        read: () => {
          const row = db.getFirstSync<{ id: unknown }>('SELECT id FROM installation WHERE slot = 1');
          return typeof row?.id === 'string' ? row.id : null;
        },
        write: (id) => {
          db.runSync('INSERT OR REPLACE INTO installation (slot, id) VALUES (1, ?)', id);
        },
      },
      newMarker: () => crypto.randomUUID(),
    });
  } catch {
    return null;
  }
}
