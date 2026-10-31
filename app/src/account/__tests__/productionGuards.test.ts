// Production admission guards. A production account build needs the exact provider (local-supabase) and both exact
// opt-ins (EXPO_PUBLIC_ACCOUNT_ENV=production and EXPO_PUBLIC_PRODUCTION_ACCOUNTS=on), and its API and Auth server are two
// distinct strict canonical HTTPS root origins of public DNS names. The loader turns anything else off with a reason that
// never quotes a value; the API client and the Auth adapter revalidate the same rules themselves, refusing before
// anything is sent. The host names are fictional placeholders (example.org): nothing here contacts anything.
import { loadSupabaseConfig, type EnabledSupabaseConfig, type SupabaseEnv } from '@/account/supabaseConfig';
import { createApiClient } from '@/api/client';
import { createSupabaseAuth } from '@/auth/supabaseAuth';

const API = 'https://api.example.org';
const AUTH = 'https://auth.example.org';
/** A synthetic marker placed where a value must never be quoted from. */
const MARKER = 'unsafe-marker-not-real-7719';

const PRODUCTION: SupabaseEnv = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_API_BASE_URL: API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH,
};
const CONFIG = { enabled: true, provider: 'local-supabase', environment: 'production', productionAccounts: true, apiBaseUrl: API, authUrl: AUTH } as const;
/** PRODUCTION with some variables changed (undefined: unset). */
const productionWith = (over: SupabaseEnv): SupabaseEnv => ({ ...PRODUCTION, ...over });

/** Account sync is off, with a reason that names `setting` (where given) and quotes no address, marker or `value`. */
function expectOff(env: SupabaseEnv, setting?: string, value?: string) {
  const config = loadSupabaseConfig(env);
  expect(config).toEqual({ enabled: false, reason: expect.any(String) });
  const reason = config.enabled ? '' : config.reason;
  if (setting) expect(reason).toContain(setting);
  if (value) expect(reason).not.toContain(value);
  expect(reason).not.toMatch(/example\.org|unsafe-marker/);
}

/** Addresses for host `host` that are not a strict canonical HTTPS root origin of a public DNS name. */
function badRoots(host: string): [string, string][] {
  return [
    ['plain http', `http://${host}`],
    ['loopback', 'https://127.0.0.1'],
    ['an IP literal', 'https://203.0.113.7'],
    ['a root trailing slash', `https://${host}/`],
    ['a path', `https://${host}/v1`],
    ['the hosted /auth/v1 prefix', `https://${host}/auth/v1`],
    ['a query', `https://${host}?k=${MARKER}`],
    ['a fragment', `https://${host}#${MARKER}`],
    ['userinfo', `https://user:${MARKER}@${host}`],
    ['port 443 written out', `https://${host}:443`],
  ];
}

it('the valid production roots are taken by the loader, the API client and the Auth adapter, as a control', () => {
  expect(loadSupabaseConfig(PRODUCTION)).toEqual(CONFIG);
  const probe = jest.fn() as unknown as typeof fetch;
  expect(() => createApiClient({ baseUrl: API, environment: 'production', productionAccounts: true, fetch: probe })).not.toThrow();
  expect(() => createSupabaseAuth({ config: CONFIG, fetch: probe })).not.toThrow();
});

it.each([undefined, 'off', 'true', 'ON', 'on ', ' on'])('a production build with the production flag %j stays off', (flag) => {
  expectOff(productionWith({ EXPO_PUBLIC_PRODUCTION_ACCOUNTS: flag }));
});

it.each([
  ['no provider', { EXPO_PUBLIC_AUTH_PROVIDER: undefined }],
  ['another provider', { EXPO_PUBLIC_AUTH_PROVIDER: 'supabase' }],
  ['the provider in another case', { EXPO_PUBLIC_AUTH_PROVIDER: 'Local-Supabase' }],
  ['no profile', { EXPO_PUBLIC_ACCOUNT_ENV: undefined }],
  ['the profile in another case', { EXPO_PUBLIC_ACCOUNT_ENV: 'Production' }],
  ['the profile with a space', { EXPO_PUBLIC_ACCOUNT_ENV: 'production ' }],
  ['a short profile', { EXPO_PUBLIC_ACCOUNT_ENV: 'prod' }],
])('the production flag with %s turns nothing on', (_case, over: SupabaseEnv) => {
  expectOff(productionWith(over));
});

it('the production flag never turns a staging build into a production one', () => {
  expect(loadSupabaseConfig(productionWith({ EXPO_PUBLIC_ACCOUNT_ENV: 'staging' }))).toEqual({
    enabled: true,
    provider: 'local-supabase',
    environment: 'staging',
    apiBaseUrl: API,
    authUrl: AUTH,
  });
});

it.each(badRoots('api.example.org'))('an API address with %s is refused by the loader, the API client and the Auth adapter, sending nothing', (_case, value) => {
  expectOff(productionWith({ EXPO_PUBLIC_API_BASE_URL: value }), 'EXPO_PUBLIC_API_BASE_URL', value);
  const probe = jest.fn();
  expect(() => createApiClient({ baseUrl: value, environment: 'production', productionAccounts: true, fetch: probe as unknown as typeof fetch })).toThrow();
  expect(() => createSupabaseAuth({ config: { ...CONFIG, apiBaseUrl: value }, fetch: probe as unknown as typeof fetch })).toThrow();
  expect(probe).not.toHaveBeenCalled();
});

it.each(badRoots('auth.example.org'))('an Auth address with %s is refused by the loader and the Auth adapter, sending nothing', (_case, value) => {
  expectOff(productionWith({ EXPO_PUBLIC_SUPABASE_AUTH_URL: value }), 'EXPO_PUBLIC_SUPABASE_AUTH_URL', value);
  const probe = jest.fn();
  expect(() => createSupabaseAuth({ config: { ...CONFIG, authUrl: value }, fetch: probe as unknown as typeof fetch })).toThrow();
  expect(probe).not.toHaveBeenCalled();
});

it('an Auth address equal to the API address is refused by the loader and the Auth adapter, sending nothing', () => {
  expectOff(productionWith({ EXPO_PUBLIC_SUPABASE_AUTH_URL: API }), 'EXPO_PUBLIC_SUPABASE_AUTH_URL');
  const probe = jest.fn();
  expect(() => createSupabaseAuth({ config: { ...CONFIG, authUrl: API }, fetch: probe as unknown as typeof fetch })).toThrow();
  expect(probe).not.toHaveBeenCalled();
});

it.each([
  ['missing', undefined],
  ['false', false],
  ['the string "true"', 'true'],
])('with the production capability %s, the API client and the Auth adapter refuse production, sending nothing', (_case, capability: unknown) => {
  const probe = jest.fn();
  const capable = capability === undefined ? {} : { productionAccounts: capability };
  // Runtime input on purpose: these values are what the types rule out.
  const options = { baseUrl: API, environment: 'production', ...capable, fetch: probe } as unknown as Parameters<typeof createApiClient>[0];
  expect(() => createApiClient(options)).toThrow();
  const config = { enabled: true, provider: 'local-supabase', environment: 'production', apiBaseUrl: API, authUrl: AUTH, ...capable } as unknown as EnabledSupabaseConfig;
  expect(() => createSupabaseAuth({ config, fetch: probe as unknown as typeof fetch })).toThrow();
  expect(probe).not.toHaveBeenCalled();
});
