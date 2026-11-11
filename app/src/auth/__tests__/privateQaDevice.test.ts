// The private native QA device adapter, RED until it exists. devicePrivateQaNetwork(config) gathers Platform.OS, the
// build's public fingerprint (Constants.expoConfig.extra.ayaPrivateQa.caSha256) and a lazy native loader
// (requireOptionalNativeModule('AyaPrivateQaTransport')) for preparePrivateQaNetwork, and returns its decision. Every native
// API is a double here: the platform, the build metadata and an in-memory module with fictional hashes. No certificate,
// native code or service is involved, and the global fetch fails every call. The module is read through its namespace,
// so a missing function fails an assertion rather than the import.
import { Platform } from 'react-native';

import { PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN } from '@/account/privateQa';
import { loadSupabaseConfig, type SupabaseConfig } from '@/account/supabaseConfig';
import * as deviceModule from '@/auth/privateQaDevice';
import type { DevicePrivateQaNetwork, PrivateQaDeviceFacade, PrivateQaNativeModuleName } from '@/auth/privateQaDevice';
import type { PrivateQaNetwork } from '@/auth/privateQaNetwork';
import type { PrivateQaBridge, PrivateQaNativeReply, PrivateQaNativeRequest } from '@/auth/privateQaTransport';

// The native module loader the adapter takes from 'expo'. Only that export is doubled: expo-modules-core and the Jest
// preset stay intact, so Expo's lazy global fetch still resolves its own native module.
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
// The build's public metadata, set per test.
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));

const native = jest.requireMock<{ requireOptionalNativeModule: jest.Mock<unknown, [string]> }>('expo');
const constants = jest.requireMock<{ default: { expoConfig: unknown } }>('expo-constants');
/** How often the native module was requested while this suite imported the adapter: never, for a lazy loader. */
const requestedAtImport = native.requireOptionalNativeModule.mock.calls.length;

const facade = deviceModule as unknown as Partial<PrivateQaDeviceFacade>;

/** The adapter's decision for `config`; asserts first that the runtime function exists. */
function prepare(config: SupabaseConfig): PrivateQaNetwork {
  expect(typeof facade.devicePrivateQaNetwork).toBe('function');
  return (facade.devicePrivateQaNetwork as DevicePrivateQaNetwork)(config);
}

/** Fictional public fingerprints: no certificate has either. */
const FICTIONAL_CA = '0123456789abcdef'.repeat(4);
const OTHER_CA = 'fedcba9876543210'.repeat(4);
const MODULE_NAME: PrivateQaNativeModuleName = 'AyaPrivateQaTransport';
const withFingerprint = (caSha256: unknown) => ({ extra: { ayaPrivateQa: { caSha256 } } });

/** An in-memory native module bound to `caSha256` (none with null); it answers every request with a fixed JSON reply. */
function nativeModule(caSha256: string | null = FICTIONAL_CA) {
  return {
    binding: jest.fn(() => (caSha256 === null ? null : { enabled: true as const, apiOrigin: PRIVATE_QA_API_ORIGIN, authOrigin: PRIVATE_QA_AUTH_ORIGIN, caSha256 })),
    request: jest.fn(
      async (request: PrivateQaNativeRequest): Promise<PrivateQaNativeReply> => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"fixture":true}', url: request.url })
    ),
    cancel: jest.fn<void, [string]>(),
  } satisfies PrivateQaBridge;
}

const PRIVATE = loadSupabaseConfig({
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'private-qa',
  EXPO_PUBLIC_PRIVATE_QA: 'on',
  EXPO_PUBLIC_API_BASE_URL: PRIVATE_QA_API_ORIGIN,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: PRIVATE_QA_AUTH_ORIGIN,
});
const ORDINARY: [string, SupabaseConfig][] = [
  ['local', loadSupabaseConfig({ EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321' })],
  ['staging', { enabled: true, provider: 'local-supabase', environment: 'staging', apiBaseUrl: 'https://api.staging.example.org', authUrl: 'https://auth.staging.example.org' }],
  ['production', { enabled: true, provider: 'local-supabase', environment: 'production', productionAccounts: true, apiBaseUrl: 'https://api.example.org', authUrl: 'https://auth.example.org' }],
  ['disabled', loadSupabaseConfig({})],
];

const PLATFORM_OS = Object.getOwnPropertyDescriptor(Platform, 'OS');
const realFetch = globalThis.fetch;
let os = 'ios';
let globalFetch: jest.Mock;

beforeEach(() => {
  os = 'ios';
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  constants.default.expoConfig = withFingerprint(FICTIONAL_CA);
  native.requireOptionalNativeModule.mockReset().mockReturnValue(nativeModule());
  globalFetch = jest.fn(async () => {
    throw new TypeError('The global fetch is never used for private QA.');
  });
  globalThis.fetch = globalFetch as unknown as typeof fetch;
});

afterEach(() => {
  // Every case: the global fetch was never used.
  expect(globalFetch).not.toHaveBeenCalled();
  globalThis.fetch = realFetch;
  if (PLATFORM_OS) Object.defineProperty(Platform, 'OS', PLATFORM_OS);
});

describe('devicePrivateQaNetwork', () => {
  it("is the module's runtime function, and importing the module requested no native module", () => {
    expect(typeof facade.devicePrivateQaNetwork).toBe('function');
    expect(requestedAtImport).toBe(0);
  });

  it.each(ORDINARY)('a %s profile is off on every platform and never requests the native module', (_name, config) => {
    for (const platform of ['ios', 'android', 'web']) {
      os = platform;
      expect(prepare(config)).toEqual({ state: 'off' });
    }
    expect(native.requireOptionalNativeModule).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])("the private profile on %s is ready over the native module, bound to the build's own fingerprint", async (platform) => {
    expect(PRIVATE).toMatchObject({ enabled: true, environment: 'private-qa', privateQa: true });
    os = platform;
    const bridge = nativeModule();
    native.requireOptionalNativeModule.mockReturnValue(bridge);

    const network = prepare(PRIVATE);
    expect(network.state).toBe('ready');
    expect(native.requireOptionalNativeModule.mock.calls).toEqual([[MODULE_NAME]]);
    if (network.state !== 'ready') return;

    const reply = await network.fetch(`${PRIVATE_QA_API_ORIGIN}/v1/me`, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit' });
    expect(reply.status).toBe(200);
    expect(bridge.request.mock.calls.map(([request]) => `${request.method} ${request.url}`)).toEqual([`GET ${PRIVATE_QA_API_ORIGIN}/v1/me`]);
  });

  it.each(['web', 'windows', 'macos'])('the private profile on %s is unavailable for its platform, before any native module is requested', (platform) => {
    os = platform;
    expect(prepare(PRIVATE)).toEqual({ state: 'unavailable', reason: 'platform' });
    expect(native.requireOptionalNativeModule).not.toHaveBeenCalled();
  });

  const NO_FINGERPRINT: [string, unknown][] = [
    ['no expoConfig', null],
    ['no extra', {}],
    ['no ayaPrivateQa', { extra: {} }],
    ['no caSha256', { extra: { ayaPrivateQa: {} } }],
    ['an upper-case fingerprint', withFingerprint(FICTIONAL_CA.toUpperCase())],
    ['a 63-character fingerprint', withFingerprint(FICTIONAL_CA.slice(1))],
    ['a fingerprint that is not a string', withFingerprint(64)],
  ];
  it.each(NO_FINGERPRINT)('with %s in the build metadata the private profile is unavailable for its certificate, whatever the module reports', (_case, expoConfig) => {
    constants.default.expoConfig = expoConfig;
    expect(prepare(PRIVATE)).toEqual({ state: 'unavailable', reason: 'certificate' });
    expect(native.requireOptionalNativeModule).not.toHaveBeenCalled();
  });

  const NO_MODULE: [string, () => unknown][] = [
    ['a binary without the module', () => null],
    [
      'a loader that throws',
      () => {
        throw new Error('fixture: the native module failed to load');
      },
    ],
    ['a module without request and cancel', () => ({ binding: () => null })],
  ];
  it.each(NO_MODULE)('%s leaves the private profile unavailable as native', (_case, load) => {
    native.requireOptionalNativeModule.mockReset().mockImplementation(load);
    expect(prepare(PRIVATE)).toEqual({ state: 'unavailable', reason: 'native' });
    expect(native.requireOptionalNativeModule.mock.calls).toEqual([[MODULE_NAME]]);
  });

  const UNBOUND: [string, () => ReturnType<typeof nativeModule>][] = [
    ['bound to another CA', () => nativeModule(OTHER_CA)],
    ['with no binding', () => nativeModule(null)],
    [
      'whose binding throws',
      () => {
        const unbound = nativeModule();
        unbound.binding.mockImplementation(() => {
          throw new Error('fixture: no binding');
        });
        return unbound;
      },
    ],
  ];
  it.each(UNBOUND)('a native module %s leaves the private profile unavailable as binding, sending nothing', (_case, make) => {
    const bridge = make();
    native.requireOptionalNativeModule.mockReturnValue(bridge);
    expect(prepare(PRIVATE)).toEqual({ state: 'unavailable', reason: 'binding' });
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it('a drifted private configuration is unavailable as configuration, before its platform, fingerprint or module', () => {
    os = 'web';
    constants.default.expoConfig = null;
    const drifted = { ...PRIVATE, productionAccounts: true } as unknown as SupabaseConfig;
    expect(prepare(drifted)).toEqual({ state: 'unavailable', reason: 'configuration' });
    expect(native.requireOptionalNativeModule).not.toHaveBeenCalled();
  });
});
