// preparePrivateQaNetwork decides which fetch a build's account clients get. These tests pin its contract before it
// exists: an ordinary or disabled profile is off and never loads native code; any private marker that is not the whole
// private shape is unavailable, never off; a private profile on another platform, with a malformed fingerprint, a
// missing, throwing or malformed bridge, or a binding that is absent, throws or does not match is unavailable with its
// reason only; a usable one is ready with the private transport, which forwards exactly and checks the binding again on
// every call. Preparing sends nothing. The global fetch is replaced by a spy that must never run. The bridge is an
// in-memory fixture and the digests are fictional: no device, network, certificate or account.
import { PRIVATE_QA, PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN } from '@/account/privateQa';
import { LOCAL_SUPABASE, loadSupabaseConfig } from '@/account/supabaseConfig';
import type { EnabledSupabaseConfig, SupabaseConfig } from '@/account/supabaseConfig';
import * as network from '@/auth/privateQaNetwork';
import type {
  PreparePrivateQaNetwork,
  PrivateQaNetwork,
  PrivateQaNetworkFacade,
  PrivateQaNetworkFailure,
  PrivateQaNetworkOptions,
  PrivateQaNetworkReady,
} from '@/auth/privateQaNetwork';
import type { PrivateQaBinding, PrivateQaNativeReply, PrivateQaNativeRequest, PrivateQaTransportError } from '@/auth/privateQaTransport';

/** Fixture digests: 64 lowercase hex characters each, of no real certificate. */
const CA_SHA256 = '0123456789abcdef'.repeat(4);
const OTHER_SHA256 = 'fedcba9876543210'.repeat(4);

const BINDING: PrivateQaBinding = { enabled: true, apiOrigin: PRIVATE_QA_API_ORIGIN, authOrigin: PRIVATE_QA_AUTH_ORIGIN, caSha256: CA_SHA256 };

const PRIVATE: EnabledSupabaseConfig = {
  enabled: true,
  provider: LOCAL_SUPABASE,
  environment: PRIVATE_QA,
  privateQa: true,
  apiBaseUrl: PRIVATE_QA_API_ORIGIN,
  authUrl: PRIVATE_QA_AUTH_ORIGIN,
};
const LOCAL: EnabledSupabaseConfig = { enabled: true, provider: LOCAL_SUPABASE, apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:54321' };
const STAGING: EnabledSupabaseConfig = {
  enabled: true,
  provider: LOCAL_SUPABASE,
  environment: 'staging',
  apiBaseUrl: 'https://api.staging.example.test',
  authUrl: 'https://auth.staging.example.test',
};
const PRODUCTION: EnabledSupabaseConfig = {
  enabled: true,
  provider: LOCAL_SUPABASE,
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: 'https://api.example.test',
  authUrl: 'https://auth.example.test',
};
const DISABLED: SupabaseConfig = { enabled: false, reason: 'EXPO_PUBLIC_AUTH_PROVIDER is not set, so account sync is off.' };

const TOKEN_URL = `${PRIVATE_QA_AUTH_ORIGIN}/token?grant_type=password`;
/** Planted in every throw, so a result that carries any exception detail is caught. */
const SECRET = 'fixture-native-detail';

/** The function, asserted to exist first, so a missing implementation fails here and never passes as a refusal. */
function prepare(): PreparePrivateQaNetwork {
  const facade = network as Partial<PrivateQaNetworkFacade>;
  expect(typeof facade.preparePrivateQaNetwork).toBe('function');
  return facade.preparePrivateQaNetwork as PreparePrivateQaNetwork;
}

/** An in-memory bridge: it reports `binding` and answers every request at once with the URL asked for. */
function nativeBridge(binding: () => PrivateQaBinding | null = () => BINDING) {
  return {
    binding: jest.fn(binding),
    request: jest.fn(
      async (asked: PrivateQaNativeRequest): Promise<PrivateQaNativeReply> => ({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"ok":true}',
        url: asked.url,
      })
    ),
    cancel: jest.fn(),
  };
}

/** Prepares `config` on iOS with the fixture digest and a loader of a bound bridge, unless `over` says otherwise. */
function run(config: unknown, over: Partial<Record<keyof PrivateQaNetworkOptions, unknown>> = {}) {
  const bridge = nativeBridge();
  const loadBridge = jest.fn(() => bridge);
  const options = { platform: 'ios', expectedCaSha256: CA_SHA256, loadBridge, ...over } as PrivateQaNetworkOptions;
  const result = prepare()(config as SupabaseConfig, options);
  return { result, bridge, loadBridge };
}

function expectUnavailable(result: PrivateQaNetwork, reason: PrivateQaNetworkFailure) {
  expect(result).toStrictEqual({ state: 'unavailable', reason });
  expect(JSON.stringify(result)).not.toContain(SECRET);
}

function readyFetch(result: PrivateQaNetwork): typeof fetch {
  expect(result.state).toBe('ready');
  return (result as PrivateQaNetworkReady).fetch;
}

const throwing = () => {
  throw new Error(SECRET);
};

let realFetch: typeof globalThis.fetch;
let globalFetch: jest.Mock;

beforeEach(() => {
  realFetch = globalThis.fetch;
  globalFetch = jest.fn(async () => {
    throw new Error('the global fetch was called; the private QA network has no fallback');
  });
  globalThis.fetch = globalFetch as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  expect(globalFetch).not.toHaveBeenCalled();
});

describe('the module', () => {
  it('loads without any native package and exposes preparePrivateQaNetwork only', () => {
    prepare();
    jest.isolateModules(() => {
      for (const name of ['react-native', 'expo-modules-core', 'expo']) {
        jest.doMock(name, () => {
          throw new Error(`the private QA network loaded ${name}`);
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require('@/auth/privateQaNetwork') as Record<string, unknown>;
      expect(Object.keys(loaded).filter((key) => key !== '__esModule' && key !== 'default')).toEqual(['preparePrivateQaNetwork']);
    });
    for (const name of ['react-native', 'expo-modules-core', 'expo']) jest.dontMock(name);
  });
});

describe('off', () => {
  it.each<[string, SupabaseConfig]>([
    ['disabled', DISABLED],
    ['local', LOCAL],
    ['staging', STAGING],
    ['production', PRODUCTION],
  ])('for the %s profile, whatever the platform or fingerprint, without loading the bridge', (_, config) => {
    for (const platform of ['ios', 'android', 'web']) {
      for (const expectedCaSha256 of [CA_SHA256, undefined, 'not-a-digest']) {
        const loadBridge = jest.fn(throwing);
        expect(prepare()(config, { platform, expectedCaSha256, loadBridge })).toStrictEqual({ state: 'off' });
        expect(loadBridge).not.toHaveBeenCalled();
      }
    }
    expect(run(config, { loadBridge: undefined }).result).toStrictEqual({ state: 'off' });
  });
});

describe('unavailable: configuration', () => {
  it.each<[string, unknown]>([
    ['without privateQa', { ...PRIVATE, privateQa: undefined }],
    ['with privateQa false', { ...PRIVATE, privateQa: false }],
    ['with privateQa as a string', { ...PRIVATE, privateQa: 'true' }],
    ['with productionAccounts', { ...PRIVATE, productionAccounts: true }],
    ['with productionAccounts false', { ...PRIVATE, productionAccounts: false }],
    ['under the staging profile', { ...PRIVATE, environment: 'staging' }],
    ['under the production profile', { ...PRIVATE, environment: 'production' }],
    ['without a profile', { ...PRIVATE, environment: undefined }],
    ['disabled', { ...PRIVATE, enabled: false }],
    ['enabled as a string', { ...PRIVATE, enabled: 'true' }],
    ['with another provider', { ...PRIVATE, provider: 'supabase' }],
    ['with the API root and a trailing slash', { ...PRIVATE, apiBaseUrl: `${PRIVATE_QA_API_ORIGIN}/` }],
    ['with the API root over http', { ...PRIVATE, apiBaseUrl: 'http://localhost:58444' }],
    ['with the API root by address', { ...PRIVATE, apiBaseUrl: 'https://127.0.0.1:58444' }],
    ['with the API on the Auth root', { ...PRIVATE, apiBaseUrl: PRIVATE_QA_AUTH_ORIGIN }],
    ['with the Auth root on another port', { ...PRIVATE, authUrl: 'https://localhost:58446' }],
    ['with the Auth root in upper case', { ...PRIVATE, authUrl: 'https://LOCALHOST:58445' }],
    ['a local profile with the private capability', { ...LOCAL, privateQa: true }],
    ['a local profile on the private API root', { ...LOCAL, apiBaseUrl: PRIVATE_QA_API_ORIGIN }],
    ['a local profile on the private Auth root', { ...LOCAL, authUrl: PRIVATE_QA_AUTH_ORIGIN }],
    ['a staging profile with the private capability', { ...STAGING, privateQa: true }],
    ['a disabled configuration with the private capability', { ...DISABLED, privateQa: true }],
    ['a disabled configuration under the private profile', { ...DISABLED, environment: PRIVATE_QA }],
  ])('%s, never off, without loading the bridge', (_, config) => {
    const { result, loadBridge } = run(config);
    expectUnavailable(result, 'configuration');
    expect(loadBridge).not.toHaveBeenCalled();
  });

  it('names the configuration, then the platform, then the certificate, all before loading the bridge', () => {
    const loadBridge = jest.fn(throwing);
    expectUnavailable(run({ ...PRIVATE, privateQa: undefined }, { platform: 'web', expectedCaSha256: undefined, loadBridge }).result, 'configuration');
    expectUnavailable(run(PRIVATE, { platform: 'web', expectedCaSha256: undefined, loadBridge }).result, 'platform');
    expectUnavailable(run(PRIVATE, { expectedCaSha256: undefined, loadBridge }).result, 'certificate');
    expect(loadBridge).not.toHaveBeenCalled();
    expectUnavailable(run(PRIVATE, { loadBridge }).result, 'native');
  });
});

describe('unavailable: platform', () => {
  it.each<[string, unknown]>([
    ['web', 'web'],
    ['windows', 'windows'],
    ['macos', 'macos'],
    ['IOS', 'IOS'],
    ['Android', 'Android'],
    ['a padded ios', ' ios'],
    ['empty', ''],
    ['absent', undefined],
    ['not a string', 1],
  ])('%s, without loading the bridge', (_, platform) => {
    const { result, loadBridge } = run(PRIVATE, { platform });
    expectUnavailable(result, 'platform');
    expect(loadBridge).not.toHaveBeenCalled();
  });
});

describe('unavailable: certificate', () => {
  it.each<[string, unknown]>([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
    ['in upper case', CA_SHA256.toUpperCase()],
    ['one character short', CA_SHA256.slice(1)],
    ['one character long', `${CA_SHA256}0`],
    ['padded', ` ${CA_SHA256}`],
    ['with a line break', `${CA_SHA256}\n`],
    ['not hex', 'g'.repeat(64)],
    ['a number', 0x0123],
    // eslint-disable-next-line no-new-wrappers
    ['a String object', new String(CA_SHA256)],
    ['an array', [CA_SHA256]],
  ])('%s, without loading the bridge', (_, expectedCaSha256) => {
    const { result, loadBridge } = run(PRIVATE, { expectedCaSha256 });
    expectUnavailable(result, 'certificate');
    expect(loadBridge).not.toHaveBeenCalled();
  });
});

describe('unavailable: native', () => {
  // Every method a malformed bridge offers is this spy, which must never run.
  const touched = jest.fn(throwing);
  const partial = (omit: string) => {
    const methods: Record<string, unknown> = { binding: touched, request: touched, cancel: touched };
    delete methods[omit];
    return methods;
  };

  beforeEach(() => touched.mockClear());

  it.each<[string, unknown]>([
    ['no loader', undefined],
    ['a loader that is not a function', { binding: touched, request: touched, cancel: touched }],
    ['a loader that throws', throwing],
    ['a loader of null', () => null],
    ['a loader of nothing', () => undefined],
    ['a loader of a number', () => 42],
    ['a loader of a string', () => 'bridge'],
    ['a loader of a promise of a bridge', () => Promise.resolve(nativeBridge())],
    ['a bridge without binding', () => partial('binding')],
    ['a bridge without request', () => partial('request')],
    ['a bridge without cancel', () => partial('cancel')],
    ['a bridge whose binding is not a function', () => ({ binding: BINDING, request: touched, cancel: touched })],
    [
      'a bridge whose binding getter throws',
      () => Object.defineProperty({ request: touched, cancel: touched }, 'binding', { enumerable: true, get: throwing }),
    ],
  ])('%s, with the reason only and no request', (_, loadBridge) => {
    expectUnavailable(run(PRIVATE, { loadBridge }).result, 'native');
    expect(touched).not.toHaveBeenCalled();
  });
});

describe('unavailable: binding', () => {
  it.each<[string, () => unknown]>([
    ['no binding', () => null],
    ['an absent binding', () => undefined],
    ['a binding that throws', throwing],
    ['a binding of another CA', () => ({ ...BINDING, caSha256: OTHER_SHA256 })],
    ['the CA hash in upper case', () => ({ ...BINDING, caSha256: CA_SHA256.toUpperCase() })],
    ['no CA hash', () => ({ ...BINDING, caSha256: undefined })],
    ['disabled', () => ({ ...BINDING, enabled: false })],
    ['another API origin', () => ({ ...BINDING, apiOrigin: 'https://localhost:58446' })],
    ['swapped origins', () => ({ ...BINDING, apiOrigin: PRIVATE_QA_AUTH_ORIGIN, authOrigin: PRIVATE_QA_API_ORIGIN })],
    ['a promise of the binding', () => Promise.resolve(BINDING)],
  ])('%s, with the reason only and no request', (_, binding) => {
    const bridge = nativeBridge(binding as () => PrivateQaBinding | null);
    expectUnavailable(run(PRIVATE, { loadBridge: () => bridge }).result, 'binding');
    expect(bridge.request).not.toHaveBeenCalled();
    expect(bridge.cancel).not.toHaveBeenCalled();
  });

  it('never takes the expected fingerprint from the bridge', () => {
    const bridge = nativeBridge(() => ({ ...BINDING, caSha256: OTHER_SHA256 }));
    const loadBridge = jest.fn(() => bridge);
    expectUnavailable(run(PRIVATE, { expectedCaSha256: undefined, loadBridge }).result, 'certificate');
    expect(loadBridge).not.toHaveBeenCalled();
    expectUnavailable(run(PRIVATE, { loadBridge }).result, 'binding');
  });
});

describe('ready', () => {
  it.each(['ios', 'android'])('on %s, loading the bridge once and sending nothing', (platform) => {
    const { result, bridge, loadBridge } = run(PRIVATE, { platform });
    const privateFetch = readyFetch(result);
    expect(Object.keys(result).sort()).toEqual(['fetch', 'state']);
    expect(typeof privateFetch).toBe('function');
    expect(privateFetch).not.toBe(globalThis.fetch);
    expect(privateFetch).not.toBe(realFetch);
    expect(loadBridge).toHaveBeenCalledTimes(1);
    expect(loadBridge).toHaveBeenCalledWith();
    expect(bridge.binding).toHaveBeenCalled();
    expect(bridge.request).not.toHaveBeenCalled();
    expect(bridge.cancel).not.toHaveBeenCalled();
  });

  it('for the configuration loadSupabaseConfig gives a private QA build', () => {
    const config = loadSupabaseConfig({
      EXPO_PUBLIC_AUTH_PROVIDER: LOCAL_SUPABASE,
      EXPO_PUBLIC_ACCOUNT_ENV: PRIVATE_QA,
      EXPO_PUBLIC_PRIVATE_QA: 'on',
      EXPO_PUBLIC_API_BASE_URL: PRIVATE_QA_API_ORIGIN,
      EXPO_PUBLIC_SUPABASE_AUTH_URL: PRIVATE_QA_AUTH_ORIGIN,
    });
    readyFetch(run(config).result);
  });

  it('forwards one request to the bridge exactly as asked', async () => {
    const { result, bridge } = run(PRIVATE);
    const body = JSON.stringify({ email: 'fixture@example.test', password: 'fixture-password' });
    const response = await readyFetch(result)(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(bridge.request).toHaveBeenCalledTimes(1);
    expect(bridge.request.mock.calls[0][0]).toStrictEqual({
      id: expect.any(String),
      url: TOKEN_URL,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(response.status).toBe(200);
    expect(response.url).toBe(TOKEN_URL);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('refuses a URL outside the private roots without the bridge or the global fetch', async () => {
    const { result, bridge } = run(PRIVATE);
    const error = await readyFetch(result)('https://example.test/token').then(
      () => {
        throw new Error('expected a rejection');
      },
      (refused: unknown) => refused
    );
    expect((error as PrivateQaTransportError).code).toBe('request');
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it('checks the binding again on every call, so a later native change is refused', async () => {
    let current: PrivateQaBinding | null = BINDING;
    const bridge = nativeBridge(() => current);
    const privateFetch = readyFetch(run(PRIVATE, { loadBridge: () => bridge }).result);
    await privateFetch(TOKEN_URL, { method: 'POST', body: '{}' });
    const checks = bridge.binding.mock.calls.length;

    for (const drifted of [{ ...BINDING, caSha256: OTHER_SHA256 }, null]) {
      current = drifted;
      const error = await privateFetch(TOKEN_URL, { method: 'POST', body: '{}' }).then(
        () => {
          throw new Error('expected a rejection');
        },
        (refused: unknown) => refused
      );
      expect((error as PrivateQaTransportError).code).toBe('binding');
    }
    expect(bridge.binding.mock.calls.length).toBe(checks + 2);
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing between preparations', () => {
    const failing = jest.fn(throwing);
    expectUnavailable(run(PRIVATE, { loadBridge: failing }).result, 'native');
    const { result, loadBridge } = run(PRIVATE);
    readyFetch(result);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(loadBridge).toHaveBeenCalledTimes(1);
    const again = run(PRIVATE);
    readyFetch(again.result);
    expect(again.loadBridge).toHaveBeenCalledTimes(1);
  });
});
