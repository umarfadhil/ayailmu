// The native session vault's port (D1 in app/docs/plans/2026-10-20-session-recovery.md), over pure in-memory fakes:
// a secure store that logs every call and outlives a reinstall, as a Keychain item may, and a marker database that
// outlives each vault over it but not a reinstall. No Keychain, Keystore or SQLite file is touched. Every native module
// is unavailable here: the web build's vault, and a native build without its modules, are null.
import { createSessionVault, deviceSessionVault, SESSION_VAULT_KEY, type SessionVaultParts, type VaultStoreOptions } from '@/auth/sessionVault';
import { deviceSessionVault as webSessionVault } from '@/auth/sessionVault.web';

/** Every native module asked for so far; none is available. */
const mockNative = { loaded: [] as string[] };
jest.mock('expo-secure-store', () => {
  mockNative.loaded.push('expo-secure-store');
  throw new Error('Cannot find native module ExpoSecureStore');
});
jest.mock('expo-sqlite', () => {
  mockNative.loaded.push('expo-sqlite');
  throw new Error('Cannot find native module ExpoSQLite');
});
jest.mock('expo-crypto', () => {
  mockNative.loaded.push('expo-crypto');
  throw new Error('Cannot find native module ExpoCrypto');
});

/** This suite's stand-in for expo-secure-store's WHEN_UNLOCKED_THIS_DEVICE_ONLY. */
const THIS_DEVICE_WHEN_UNLOCKED = 7;
/** Every call's options: only while unlocked, on this device only, never behind user authentication. */
const OPTIONS: VaultStoreOptions = { keychainAccessible: THIS_DEVICE_WHEN_UNLOCKED, requireAuthentication: false };

/**
 * The secure store's synchronous calls over its items, each logged with its options. With `refuseWrites`, a write
 * throws, as the Keychain does while the device is locked. Its deleteItemAsync, never one of the vault's parts, lands
 * 10 ms after it is asked for.
 */
function secureStore() {
  const items = new Map<string, string>();
  const calls: { call: string; key: string; options: unknown }[] = [];
  const deletes: string[] = [];
  const state = { refuseWrites: false };
  const store = {
    getItem(key: string, options: VaultStoreOptions): string | null {
      calls.push({ call: 'getItem', key, options });
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string, options: VaultStoreOptions): void {
      calls.push({ call: 'setItem', key, options });
      if (state.refuseWrites) throw new Error('User interaction is not allowed.');
      items.set(key, value);
    },
    deleteItemAsync(key: string, options?: VaultStoreOptions): Promise<void> {
      calls.push({ call: 'deleteItemAsync', key, options });
      return new Promise((resolve) => {
        setTimeout(() => {
          items.delete(key);
          deletes.push(key);
          resolve();
        }, 10);
      });
    },
  };
  return { store, items, calls, deletes, state };
}

/** The marker's own database: one id at most. With `refuseReads` or `refuseWrites`, that call throws. */
function markerDatabase() {
  const state = { id: null as string | null, writes: 0, refuseWrites: false, refuseReads: false };
  const marker = {
    read(): string | null {
      if (state.refuseReads) throw new Error('database is locked');
      return state.id;
    },
    write(id: string): void {
      if (state.refuseWrites) throw new Error('database or disk is full');
      state.id = id;
      state.writes += 1;
    },
  };
  return { marker, state };
}

let minted = 0;
/** A new marker each time, as randomUUID gives one. */
const newMarker = () => `install-${(minted += 1)}`;

function parts(device: ReturnType<typeof secureStore>, db: ReturnType<typeof markerDatabase>): SessionVaultParts {
  return { secureStore: device.store, whenUnlockedThisDeviceOnly: THIS_DEVICE_WHEN_UNLOCKED, marker: db.marker, newMarker };
}

/** Everything the secure store holds, as one text. */
const held = (device: ReturnType<typeof secureStore>) => [...device.items.values()].join('\n');

describe('the native session vault over its parts', () => {
  it('uses only the synchronous calls, for the one key, readable only while unlocked on this device and never behind user authentication', () => {
    const device = secureStore();
    const vault = createSessionVault(parts(device, markerDatabase()));
    const installation = vault.installation();
    vault.write('{"v":1,"refreshToken":"rt-synthetic"}');
    expect(vault.read()).toBe('{"v":1,"refreshToken":"rt-synthetic"}');
    vault.clear();
    expect(vault.read()).toBeNull();

    expect(new Set(device.calls.map(({ call }) => call))).toEqual(new Set(['getItem', 'setItem']));
    for (const { key, options } of device.calls) {
      expect(key).toBe(SESSION_VAULT_KEY);
      expect(options).toStrictEqual(OPTIONS);
    }
    // The marker is kept in its own database, never in the secure store.
    expect([...device.items.keys()]).toEqual([SESSION_VAULT_KEY]);
    expect(held(device)).not.toContain(installation);
  });

  it('keeps the marker across vaults over the same database, and a reinstall brings a new one beside the record the secure store kept', () => {
    const device = secureStore();
    const db = markerDatabase();
    const first = createSessionVault(parts(device, db));
    const marker = first.installation();
    expect(first.installation()).toBe(marker);
    first.write('record-of-the-first-installation');

    // The next start of the same installation.
    expect(createSessionVault(parts(device, db)).installation()).toBe(marker);
    expect(db.state).toMatchObject({ id: marker, writes: 1 });

    // A reinstall: the app's own files are gone, while the Keychain item may outlive them.
    const fresh = markerDatabase();
    const reinstalled = createSessionVault(parts(device, fresh));
    const renewed = reinstalled.installation();
    expect(renewed).not.toBe(marker);
    expect(fresh.state).toMatchObject({ id: renewed, writes: 1 });
    // The vault says truthfully what is still there; its installation no longer matches the record's.
    expect(reinstalled.read()).toBe('record-of-the-first-installation');
  });

  it('a clear overwrites the record at once and never deletes it later, so a record saved after it survives', async () => {
    const device = secureStore();
    const vault = createSessionVault(parts(device, markerDatabase()));
    vault.write('first-token');
    vault.clear();
    expect(vault.read()).toBeNull();
    expect(held(device)).not.toContain('first-token');

    vault.write('second-token');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(vault.read()).toBe('second-token');
    expect(device.deletes).toEqual([]);
  });

  it('when the secure store refuses the overwrite, the clear throws, the record is truthfully still there, and a renewed marker is kept', () => {
    const device = secureStore();
    const db = markerDatabase();
    const vault = createSessionVault(parts(device, db));
    const before = vault.installation();
    vault.write('kept-record');
    device.state.refuseWrites = true;

    expect(() => vault.clear()).toThrow();

    expect(vault.read()).toBe('kept-record');
    const renewed = vault.installation();
    expect(renewed).not.toBe(before);
    expect(db.state.id).toBe(renewed);
    // The next start reads the renewed marker, so the record left behind never matches this installation again.
    expect(createSessionVault(parts(device, db)).installation()).toBe(renewed);
  });

  it('a marker the database will not keep or read fails truthfully: no installation is claimed, nor a clear the store refused', () => {
    const device = secureStore();
    const db = markerDatabase();
    db.state.refuseWrites = true;
    const vault = createSessionVault(parts(device, db));
    expect(() => vault.installation()).toThrow();
    expect(db.state).toMatchObject({ id: null, writes: 0 });

    // Once the database takes it, a marker is made and kept.
    db.state.refuseWrites = false;
    const kept = vault.installation();
    expect(db.state).toMatchObject({ id: kept, writes: 1 });

    // A marker that cannot be read is never replaced by a new one, which would orphan the record it matches.
    db.state.refuseReads = true;
    expect(() => createSessionVault(parts(device, db)).installation()).toThrow();
    expect(db.state).toMatchObject({ id: kept, writes: 1 });
    db.state.refuseReads = false;
    expect(createSessionVault(parts(device, db)).installation()).toBe(kept);

    // Neither the overwrite nor the marker's renewal: the clear throws, the record is still there, the marker as kept.
    vault.write('kept-record');
    device.state.refuseWrites = true;
    db.state.refuseWrites = true;
    expect(() => vault.clear()).toThrow();
    expect(vault.read()).toBe('kept-record');
    expect(vault.installation()).toBe(kept);
    expect(db.state).toMatchObject({ id: kept, writes: 1 });
  });
});

describe('where there is no vault', () => {
  it('the web build has none and loads no native module; a native build without its modules has none either', () => {
    // Importing the native vault loaded nothing: its modules load only when a remembering build asks for it.
    expect(mockNative.loaded).toEqual([]);
    expect(webSessionVault()).toBeNull();
    expect(mockNative.loaded).toEqual([]);

    expect(deviceSessionVault()).toBeNull();
    expect(mockNative.loaded).not.toEqual([]);
  });
});
