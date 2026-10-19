// The local Supabase Auth account configuration, written before its implementation (frontend only): the explicit
// local-supabase provider, the loopback account API on port 8092 and the local Auth server's root on its own port.
// Anything absent or unsafe, the legacy Firebase emulator variables on their own included, keeps account sync off with
// a reason that names the setting, never its value; nothing builds an SDK client or contacts anything.
import type { AccountEnv } from '@/account/config';
import { loadSupabaseConfig, type EnabledSupabaseConfig, type SupabaseEnv } from '@/account/supabaseConfig';
import { createSupabaseAuth } from '@/auth/supabaseAuth';

/** Every build variable set here: the local-supabase ones and the legacy Firebase emulator pilot's. */
type Env = SupabaseEnv & AccountEnv;
const ENV_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
] as const;

const SAFE: Env = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838',
};
/** The legacy pilot's variables: no provider named and no Auth server address. */
const LEGACY_ONLY: Env = {
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092',
  EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-ayailmu',
};
const ENABLED: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' };

/** Replaces a global for one test; returns the undo. */
function replaceGlobal(name: 'fetch', value: unknown): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(globalThis, name, before);
    else Reflect.deleteProperty(globalThis, name);
  };
}

/** Sets (or, for undefined, removes) the build variables in process.env; returns their previous values. */
function setProcessEnv(values: Env): Env {
  const previous: Env = {};
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return previous;
}

/** What `run` throws, or undefined when it does not throw. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('local-supabase account configuration', () => {
  let networkProbe = jest.fn();
  let restoreFetch: () => void = () => undefined;
  beforeEach(() => {
    networkProbe = jest.fn();
    restoreFetch = replaceGlobal('fetch', networkProbe);
  });
  afterEach(() => {
    restoreFetch();
    // Reading the configuration, or refusing it, never contacts anything.
    expect(networkProbe).not.toHaveBeenCalled();
  });

  it.each([
    {
      where: '127.0.0.1, with root slashes',
      env: { ...SAFE, EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092/', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838/' },
      apiBaseUrl: 'http://127.0.0.1:8092',
      authUrl: 'http://127.0.0.1:59838',
    },
    {
      where: 'localhost',
      env: { ...SAFE, EXPO_PUBLIC_API_BASE_URL: 'http://localhost:8092', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://localhost:54321' },
      apiBaseUrl: 'http://localhost:8092',
      authUrl: 'http://localhost:54321',
    },
    { where: 'the lowest Auth port', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:1' }, apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:1' },
    { where: 'the highest Auth port', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:65535' }, apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:65535' },
    { where: '127.0.0.1, ignoring leftover legacy Firebase variables', env: { ...LEGACY_ONLY, ...SAFE }, apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' },
  ])('turns on with the provider named and the API and the Auth root on $where', ({ env, apiBaseUrl, authUrl }) => {
    // Exactly these fields: no emulator address or project carried over from the legacy pilot.
    expect(loadSupabaseConfig(env)).toEqual({ enabled: true, provider: 'local-supabase', apiBaseUrl, authUrl });
  });

  const AUTH = 'EXPO_PUBLIC_SUPABASE_AUTH_URL';
  const OFF: { case: string; env: Env; setting: keyof SupabaseEnv; notShown?: string }[] = [
    { case: 'no provider named', env: { ...SAFE, EXPO_PUBLIC_AUTH_PROVIDER: undefined }, setting: 'EXPO_PUBLIC_AUTH_PROVIDER' },
    { case: 'the legacy Firebase emulator variables alone', env: LEGACY_ONLY, setting: 'EXPO_PUBLIC_AUTH_PROVIDER', notShown: '9099' },
    { case: 'the legacy provider named', env: { ...SAFE, EXPO_PUBLIC_AUTH_PROVIDER: 'firebase-emulator' }, setting: 'EXPO_PUBLIC_AUTH_PROVIDER', notShown: 'firebase-emulator' },
    { case: 'a hosted provider named', env: { ...SAFE, EXPO_PUBLIC_AUTH_PROVIDER: 'supabase-cloud' }, setting: 'EXPO_PUBLIC_AUTH_PROVIDER', notShown: 'supabase-cloud' },
    { case: 'local-supabase with only the legacy emulator address', env: { ...LEGACY_ONLY, EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase' }, setting: AUTH, notShown: '9099' },
    { case: 'an empty Auth address', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: '' }, setting: AUTH },
    { case: 'a missing API address', env: { ...SAFE, EXPO_PUBLIC_API_BASE_URL: undefined }, setting: 'EXPO_PUBLIC_API_BASE_URL' },
    { case: 'the API on another local port (the public guest server)', env: { ...SAFE, EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8088' }, setting: 'EXPO_PUBLIC_API_BASE_URL', notShown: '8088' },
    { case: 'Auth port 0', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:0' }, setting: AUTH, notShown: '127.0.0.1:0' },
    { case: 'an Auth port above 65535', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:65536' }, setting: AUTH, notShown: '65536' },
    { case: 'an Auth address without a port', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1' }, setting: AUTH },
    { case: 'an Auth path (the hosted /auth/v1 prefix)', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838/auth/v1' }, setting: AUTH, notShown: '/auth/v1' },
    { case: 'an Auth query carrying a key', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838/?apikey=sb-local-key' }, setting: AUTH, notShown: 'sb-local-key' },
    { case: 'an Auth fragment', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838/#access_token=leak' }, setting: AUTH, notShown: 'access_token' },
    { case: 'credentials in the Auth address', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://service:hunter2@127.0.0.1:59838' }, setting: AUTH, notShown: 'hunter2' },
    { case: 'user info hiding another host', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838@evil.test:59838' }, setting: AUTH, notShown: 'evil.test' },
    { case: 'an external Auth host', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://auth.example.com:59838' }, setting: AUTH, notShown: 'example.com' },
    { case: 'a look-alike loopback host', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1.evil.test:59838' }, setting: AUTH, notShown: 'evil.test' },
    { case: 'https on loopback', env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://127.0.0.1:59838' }, setting: AUTH, notShown: 'https://127.0.0.1:59838' },
    { case: "the tokens' logical issuer, which is no transport address", env: { ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.ayailmu-local.test/auth/v1' }, setting: AUTH, notShown: 'ayailmu-local.test' },
  ];
  it.each(OFF)('$case keeps account sync off instead of failing; the reason names $setting, not its value', ({ env, setting, notShown }) => {
    const config = loadSupabaseConfig(env);
    expect(config).toEqual({ enabled: false, reason: expect.any(String) });
    const reason = config.enabled ? '' : config.reason;
    expect(reason).toContain(setting);
    if (notShown) expect(reason).not.toContain(notShown);
  });

  it('reads the static EXPO_PUBLIC_* build variables by default; the legacy Firebase variables alone keep it off', () => {
    const previous = setProcessEnv({ ...SAFE, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838/' });
    try {
      expect(loadSupabaseConfig()).toEqual({ enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' });
      // No fallback: the legacy pilot's variables never turn on the default, nor the legacy adapter.
      setProcessEnv(LEGACY_ONLY);
      expect(loadSupabaseConfig()).toEqual({ enabled: false, reason: expect.stringContaining('EXPO_PUBLIC_AUTH_PROVIDER') });
    } finally {
      setProcessEnv(previous);
    }
  });

  it('builds no SDK client for a disabled, unsafe or legacy configuration, and none for a safe one before a sign-in', () => {
    const createClient = jest.fn();
    // Safe: ready and signed out, with nothing built or sent yet.
    expect(createSupabaseAuth({ config: ENABLED, createClient }).status()).toEqual({ state: 'signed-out' });

    const REFUSED: unknown[] = [
      undefined,
      { enabled: false, reason: 'EXPO_PUBLIC_AUTH_PROVIDER is not set, so account sync is off.' },
      // The legacy Firebase emulator pilot's configuration.
      { enabled: true, apiBaseUrl: 'http://127.0.0.1:8092', authEmulatorUrl: 'http://127.0.0.1:9099', projectId: 'demo-ayailmu' },
      { ...ENABLED, provider: 'firebase-emulator' },
      { ...ENABLED, authUrl: 'http://auth.evil.test:59838' },
      { ...ENABLED, authUrl: 'http://127.0.0.1:59838/auth/v1' },
      { ...ENABLED, authUrl: 'https://auth.ayailmu-local.test/auth/v1' },
    ];
    for (const config of REFUSED) {
      // Revalidated by the adapter itself: refused at once, naming no value.
      const error = thrown(() => createSupabaseAuth({ config: config as EnabledSupabaseConfig, createClient }));
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('nothing was sent');
      expect(String(error)).not.toMatch(/evil\.test|auth\/v1|9099|firebase-emulator/);
    }
    expect(createClient).not.toHaveBeenCalled();
  });
});
