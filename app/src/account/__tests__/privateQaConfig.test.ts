// Private native QA account configuration, RED. A private QA build opts in with EXPO_PUBLIC_ACCOUNT_ENV=private-qa and
// EXPO_PUBLIC_PRIVATE_QA=on beside the explicit self-hosted provider (EXPO_PUBLIC_AUTH_PROVIDER=local-supabase), with the
// production flag left off, and is then bound to exactly two fixed HTTPS loopback roots. Nothing here contacts anything:
// the loopback roots are only compared, and the public names are fictional placeholders (example.org).
import { loadSupabaseConfig, type SupabaseEnv } from '@/account/supabaseConfig';

/** The build variables with the private QA flag, until SupabaseEnv names it. */
type PrivateQaEnv = SupabaseEnv & { EXPO_PUBLIC_PRIVATE_QA?: string };

const QA_API = 'https://localhost:58444';
const QA_AUTH = 'https://localhost:58445';
const PUBLIC_API = 'https://api.example.org';
const PUBLIC_AUTH = 'https://auth.example.org';

const PRIVATE_QA: PrivateQaEnv = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'private-qa',
  EXPO_PUBLIC_PRIVATE_QA: 'on',
  EXPO_PUBLIC_API_BASE_URL: QA_API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: QA_AUTH,
};

function load(overrides: PrivateQaEnv): ReturnType<typeof loadSupabaseConfig> {
  const env: PrivateQaEnv = { ...PRIVATE_QA, ...overrides };
  return loadSupabaseConfig(env);
}

function expectOff(overrides: PrivateQaEnv): void {
  const config = load(overrides);
  expect(config.enabled).toBe(false);
  expect(config).not.toHaveProperty('privateQa');
  expect(config).not.toHaveProperty('environment');
}

describe('the private QA profile', () => {
  it('turns account sync on at exactly the two fixed roots, marked private-qa with the privateQa capability and nothing of production', () => {
    expect(load({})).toStrictEqual({
      enabled: true,
      provider: 'local-supabase',
      environment: 'private-qa',
      privateQa: true,
      apiBaseUrl: QA_API,
      authUrl: QA_AUTH,
    });
  });

  it('reads a frozen environment without writing to it, and is not a live view of it afterwards', () => {
    expect(loadSupabaseConfig(Object.freeze({ ...PRIVATE_QA }))).toMatchObject({ enabled: true, privateQa: true });

    const env: PrivateQaEnv = { ...PRIVATE_QA };
    const config = loadSupabaseConfig(env);
    env.EXPO_PUBLIC_API_BASE_URL = 'https://localhost:58443';
    env.EXPO_PUBLIC_PRIVATE_QA = 'off';
    expect(config).toMatchObject({ enabled: true, privateQa: true, apiBaseUrl: QA_API, authUrl: QA_AUTH });
    expect(loadSupabaseConfig(env).enabled).toBe(false);
  });

  it.each([undefined, '', 'ON', 'On', ' on', 'on ', 'true', '1', 'yes', 'off'])('stays off when the private QA flag is %p', (flag) => {
    expectOff({ EXPO_PUBLIC_PRIVATE_QA: flag });
  });

  it.each([undefined, '', 'private_qa', 'PRIVATE-QA', ' private-qa', 'private-qa ', 'privateqa', 'qa', 'staging'])(
    'stays off when the account profile is %p',
    (profile) => {
      expectOff({ EXPO_PUBLIC_ACCOUNT_ENV: profile });
    }
  );

  it.each([undefined, '', 'supabase', 'LOCAL-SUPABASE', 'firebase'])('stays off when the provider is %p', (provider) => {
    expectOff({ EXPO_PUBLIC_AUTH_PROVIDER: provider });
  });

  it('stays off when the production flag is also on', () => {
    expectOff({ EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on' });
  });

  it.each<[string, string, string]>([
    ['the API on another port', 'https://localhost:58443', QA_AUTH],
    ['the API on the local pilot port', 'https://localhost:8092', QA_AUTH],
    ['the API on the default port', 'https://localhost', QA_AUTH],
    ['the Auth server on another port', QA_API, 'https://localhost:58446'],
    ['the Auth server on the local GoTrue port', QA_API, 'https://localhost:54321'],
    ['the Auth server on the default port', QA_API, 'https://localhost'],
    ['the two roots swapped', QA_AUTH, QA_API],
    ['both at the API root', QA_API, QA_API],
    ['both at the Auth root', QA_AUTH, QA_AUTH],
  ])('stays off with %s', (_, api, auth) => {
    expectOff({ EXPO_PUBLIC_API_BASE_URL: api, EXPO_PUBLIC_SUPABASE_AUTH_URL: auth });
  });

  it.each([
    'https://127.0.0.1:58444',
    'https://[::1]:58444',
    'https://LOCALHOST:58444',
    'https://localhost.:58444',
    'HTTPS://localhost:58444',
    'http://localhost:58444',
    'https://localhost.example.org:58444',
  ])('stays off when a root is substituted by %s (or its Auth-port twin)', (api) => {
    expectOff({ EXPO_PUBLIC_API_BASE_URL: api });
    expectOff({ EXPO_PUBLIC_SUPABASE_AUTH_URL: api.replace('58444', '58445') });
  });

  it.each(['/', '//', '/v1', '/auth/v1', '?x=1', '#x', ' ', '\n', '\\'])('stays off when a root is followed by %p', (suffix) => {
    expectOff({ EXPO_PUBLIC_API_BASE_URL: `${QA_API}${suffix}` });
    expectOff({ EXPO_PUBLIC_SUPABASE_AUTH_URL: `${QA_AUTH}${suffix}` });
  });

  it.each<[string, PrivateQaEnv]>([
    ['API credentials', { EXPO_PUBLIC_API_BASE_URL: 'https://qa:hunter2@localhost:58444' }],
    ['Auth credentials', { EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://qa:hunter2@localhost:58445' }],
    ['a leading space', { EXPO_PUBLIC_API_BASE_URL: ' https://localhost:58444' }],
    ['a zero-padded port', { EXPO_PUBLIC_API_BASE_URL: 'https://localhost:058444' }],
  ])('stays off, never echoing a credential, with %s', (_, overrides) => {
    expectOff(overrides);
    expect(JSON.stringify(load(overrides))).not.toContain('hunter2');
  });
});

describe('the private QA flag in another build', () => {
  it.each<[string, string, string]>([
    ['QA API and QA Auth', QA_API, QA_AUTH],
    ['a public API and QA Auth', PUBLIC_API, QA_AUTH],
    ['QA API and a public Auth', QA_API, PUBLIC_AUTH],
  ])('does not relax a production build to the loopback roots (%s)', (_, api, auth) => {
    expectOff({
      EXPO_PUBLIC_ACCOUNT_ENV: 'production',
      EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
      EXPO_PUBLIC_API_BASE_URL: api,
      EXPO_PUBLIC_SUPABASE_AUTH_URL: auth,
    });
  });

  it.each<[string, PrivateQaEnv]>([
    ['local', { EXPO_PUBLIC_ACCOUNT_ENV: undefined, EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321' }],
    ['staging', { EXPO_PUBLIC_ACCOUNT_ENV: 'staging', EXPO_PUBLIC_API_BASE_URL: PUBLIC_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: PUBLIC_AUTH }],
    [
      'production',
      { EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on', EXPO_PUBLIC_API_BASE_URL: PUBLIC_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: PUBLIC_AUTH },
    ],
  ])('never confers the privateQa capability on a %s build', (_, overrides) => {
    const config = load(overrides);
    expect(config).not.toHaveProperty('privateQa');
    expect(config).not.toMatchObject({ environment: 'private-qa' });
  });
});
