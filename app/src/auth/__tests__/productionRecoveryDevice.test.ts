// The native build's pending-recovery store for a production build, RED. deviceRecoveryStore(config) keeps the attempt in
// the secure store (its own item, ayailmu.pending-recovery.v1, and its own marker database) only for a validated
// production build with recovery on, outside Expo Go; a new run then takes it once, and prepareRecovery hands over that
// same store. Without a configuration, in a local or staging build, the attempt stays in memory as before; any other
// production build gets no store at all. Only the OS boundaries are mocked here (expo-constants, expo-secure-store,
// expo-sqlite, expo-crypto, all in memory): no Keychain, file or network, and the native callback is the existing
// development scheme's arabictrial://recover, not a final app identity.
import type { SupabaseConfig } from '@/account/supabaseConfig';
import type { RecoveryAttemptRecord, RecoveryAttemptStore } from '@/auth/recovery';
import type * as RecoveryDevice from '@/auth/recoveryDevice';
import type { RecoveryRuntime } from '@/auth/recoveryRuntime';
import type * as RecoverySetup from '@/auth/recoverySetup';

const mockNative = {
  environment: 'standalone',
  secure: new Map<string, string>(),
  secureCalls: [] as { key: string; options: unknown }[],
  markers: new Map<string, string>(),
  databases: [] as string[],
  uuids: 0,
  loaded: [] as string[],
};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get executionEnvironment() {
      return mockNative.environment;
    },
  },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));
jest.mock('expo-secure-store', () => {
  mockNative.loaded.push('expo-secure-store');
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    getItem: (key: string, options: unknown) => {
      mockNative.secureCalls.push({ key, options });
      return mockNative.secure.get(key) ?? null;
    },
    setItem: (key: string, value: string, options: unknown) => {
      mockNative.secureCalls.push({ key, options });
      mockNative.secure.set(key, value);
    },
  };
});
jest.mock('expo-sqlite', () => {
  mockNative.loaded.push('expo-sqlite');
  return {
    openDatabaseSync: (name: string) => {
      mockNative.databases.push(name);
      return {
        execSync: () => undefined,
        getFirstSync: () => (mockNative.markers.has(name) ? { id: mockNative.markers.get(name) } : null),
        runSync: (_sql: string, ...params: unknown[]) => {
          const id = params.find((param) => typeof param === 'string');
          if (typeof id === 'string') mockNative.markers.set(name, id);
        },
      };
    },
  };
});
jest.mock('expo-crypto', () => {
  mockNative.loaded.push('expo-crypto');
  return { randomUUID: () => `install-${(mockNative.uuids += 1)}` };
});

const NOW = Date.UTC(2026, 9, 22, 5, 0, 0);
const API = 'https://api.example.org';
const AUTH = 'https://auth.example.org';
const CALLBACK = 'arabictrial://recover';
const PRODUCTION = { enabled: true, provider: 'local-supabase', environment: 'production', productionAccounts: true, apiBaseUrl: API, authUrl: AUTH } as const;
const RECORD: RecoveryAttemptRecord = { v: 1, flowId: 'flow_production_01', verifier: 'fixture-verifier-0123456789abcdefghijklmnopqrstuvwxyz', callbackUrl: CALLBACK, createdAt: NOW, auth: AUTH, profile: 'production' };
const LOCAL_RECORD: RecoveryAttemptRecord = { ...RECORD, auth: 'http://127.0.0.1:54321', profile: 'local' };

/** A cold start: fresh app modules over the same mocked OS parts. */
function coldStart() {
  jest.resetModules();
  // The planned signature, typed here before the function takes a configuration.
  const deviceRecoveryStore: (config?: SupabaseConfig) => RecoveryAttemptStore | null = jest.requireActual<typeof RecoveryDevice>('@/auth/recoveryDevice').deviceRecoveryStore;
  const { prepareRecovery } = jest.requireActual<typeof RecoverySetup>('@/auth/recoverySetup');
  return { deviceRecoveryStore, prepareRecovery };
}

const savedRecovery = process.env.EXPO_PUBLIC_PASSWORD_RECOVERY;
beforeEach(() => {
  Object.assign(mockNative, { environment: 'standalone', secure: new Map(), secureCalls: [], markers: new Map(), databases: [], uuids: 0, loaded: [] });
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = 'on';
});
afterEach(() => {
  jest.restoreAllMocks();
  if (savedRecovery === undefined) delete process.env.EXPO_PUBLIC_PASSWORD_RECOVERY;
  else process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = savedRecovery;
});

it('outside a validated production build with recovery on, the attempt stays in memory or there is no store, and no OS storage is loaded', () => {
  const local = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:54321' } as const;
  const staging = { ...local, environment: 'staging', apiBaseUrl: 'https://api-staging.example.com', authUrl: 'https://auth-staging.example.com' } as const;
  for (const [name, config] of [['no configuration', undefined], ['the local default', local], ['staging', staging]] as const) {
    const { deviceRecoveryStore } = coldStart();
    const first = deviceRecoveryStore(config);
    first?.save(LOCAL_RECORD);
    expect({ name, kept: first !== null, takenByAnother: deviceRecoveryStore(config)?.take() ?? null }).toEqual({ name, kept: true, takenByAnother: null });
  }

  const refused: [string, unknown, string | undefined, string][] = [
    ['recovery off', PRODUCTION, undefined, 'standalone'],
    ['no capability', { ...PRODUCTION, productionAccounts: undefined }, 'on', 'standalone'],
    ['the capability false', { ...PRODUCTION, productionAccounts: false }, 'on', 'standalone'],
    ['the capability "true"', { ...PRODUCTION, productionAccounts: 'true' }, 'on', 'standalone'],
    ['the same API and Auth root', { ...PRODUCTION, authUrl: API }, 'on', 'standalone'],
    ['a loopback root', { ...PRODUCTION, apiBaseUrl: 'https://127.0.0.1' }, 'on', 'standalone'],
    ['a plain-http root', { ...PRODUCTION, authUrl: 'http://auth.example.org' }, 'on', 'standalone'],
    ['Expo Go', PRODUCTION, 'on', 'storeClient'],
  ];
  for (const [name, config, recovery, environment] of refused) {
    if (recovery === undefined) delete process.env.EXPO_PUBLIC_PASSWORD_RECOVERY;
    else process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = recovery;
    mockNative.environment = environment;
    // Runtime input on purpose: some of these are what the types rule out.
    expect({ name, store: coldStart().deviceRecoveryStore(config as SupabaseConfig) }).toEqual({ name, store: null });
  }
  expect(mockNative.loaded).toEqual([]);
});

it('a validated production build with recovery on keeps the attempt in its own secure item, taken once after a cold start, also through prepareRecovery', () => {
  coldStart().deviceRecoveryStore(PRODUCTION)?.save(RECORD);
  const later = coldStart().deviceRecoveryStore(PRODUCTION);
  expect(later?.take()).toStrictEqual(RECORD);
  expect(later?.take()).toBeNull();

  coldStart().deviceRecoveryStore(PRODUCTION)?.save(RECORD);
  const runtime: RecoveryRuntime = { platform: { kind: 'native', unavailable: null }, takeLaunchUrl: () => null, subscribe: () => () => undefined };
  const setup = coldStart().prepareRecovery(PRODUCTION, runtime);
  expect(setup?.config).toEqual({ enabled: true, platform: 'native', callbackUrl: CALLBACK });
  expect(setup?.store?.take()).toStrictEqual(RECORD);

  // Only its own secure item and marker database, always only while unlocked, on this device, without authentication.
  expect(new Set(mockNative.secureCalls.map((call) => call.key))).toEqual(new Set(['ayailmu.pending-recovery.v1']));
  for (const call of mockNative.secureCalls) expect(call.options).toEqual({ keychainAccessible: 7, requireAuthentication: false });
  expect(new Set(mockNative.databases)).toEqual(new Set(['ayailmu-recovery-installation.db']));
});
