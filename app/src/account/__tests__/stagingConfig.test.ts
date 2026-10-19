// Staging account configuration, Phase 18 RED. A staging build opts in explicitly with EXPO_PUBLIC_ACCOUNT_ENV=staging
// beside the existing explicit self-hosted provider (EXPO_PUBLIC_AUTH_PROVIDER=local-supabase); without it the local
// configuration is exactly as before, and staging addresses keep account sync off. With it, the account API and the
// standalone GoTrue are strict canonical HTTPS root origins of public DNS names: https, a lowercase host name of at least
// two labels, no explicit port, nothing after the host (so Auth is at its root, never a guessed hosted /auth/v1 prefix),
// and no userinfo, query, fragment, whitespace, control character, backslash, percent-encoding, wildcard, trailing dot,
// IP literal, loopback, private, link-local, local or test name. A local or plain-http address never turns staging on,
// and an opt-in that is not exactly "staging" turns nothing on. The Google web callback is exactly the staging page's own
// https origin + /account, and only under the opt-in; native rules are unchanged. Every refusal keeps account sync (or
// Google sign-in) off with a reason that names the setting, never its value. The host names are documented
// placeholders (example.com): nothing here builds a client or contacts anything.
import { loadGoogleConfig, type GoogleEnv, type GooglePlatform } from '@/account/googleConfig';
import { loadSupabaseConfig, type SupabaseEnv } from '@/account/supabaseConfig';

const STAGING_API = 'https://api-staging.example.com';
const STAGING_AUTH = 'https://auth-staging.example.com';
const STAGING_APP = 'https://app-staging.example.com';
/** A synthetic marker placed where a value must never be quoted from. */
const MARKER = 'unsafe-marker-not-real-7719';

/** The build-time variables, the staging opt-in included. */
type StagingEnv = SupabaseEnv & { EXPO_PUBLIC_ACCOUNT_ENV?: string };
type StagingGoogleEnv = GoogleEnv & { EXPO_PUBLIC_ACCOUNT_ENV?: string };

const LOCAL: StagingEnv = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838',
};
const STAGING: StagingEnv = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  EXPO_PUBLIC_API_BASE_URL: STAGING_API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: STAGING_AUTH,
};
/** STAGING, or LOCAL, with some variables changed (undefined: unset). */
const stagingWith = (over: StagingEnv): StagingEnv => ({ ...STAGING, ...over });
const localWith = (over: StagingEnv): StagingEnv => ({ ...LOCAL, ...over });

/** Account sync is off, with a reason that names `setting` and quotes no marker. */
function expectOff(config: ReturnType<typeof loadSupabaseConfig>, setting: string) {
  expect(config).toEqual({ enabled: false, reason: expect.any(String) });
  const reason = config.enabled ? '' : config.reason;
  expect(reason).toContain(setting);
  expect(reason).not.toContain(MARKER);
}

/** Addresses that are not a strict canonical HTTPS root origin of a public DNS name, for host `host` (e.g. api-staging.example.com). */
function notStagingOrigins(host: string): [string, string][] {
  return [
    ['plain http', `http://${host}`],
    ['a trailing slash', `https://${host}/`],
    ['a path', `https://${host}/v1`],
    ['the hosted /auth/v1 prefix', `https://${host}/auth/v1`],
    ['credentials', `https://user:${MARKER}@${host}`],
    ['a query', `https://${host}?k=${MARKER}`],
    ['a fragment', `https://${host}#${MARKER}`],
    ['the default port written out', `https://${host}:443`],
    ['another port', `https://${host}:8443`],
    ['port zero', `https://${host}:0`],
    ['upper case', `https://${host.toUpperCase()}`],
    ['an upper-case scheme', `HTTPS://${host}`],
    ['a trailing dot', `https://${host}.`],
    ['a wildcard', 'https://*.example.com'],
    ['a backslash', `https://${host}\\@evil.example.com`],
    ['an encoded authority', `https://${host}%2F@evil.example.com`],
    ['a userinfo-like port', `https://${host}:443@evil.example.com`],
    ['a leading space', ` https://${host}`],
    ['a trailing newline', `https://${host}\n`],
    ['a control character', `https://${host}\u0000`],
    ['a non-ASCII host', 'https://ápi-staging.example.com'],
    ['no scheme', host],
    ['a scheme-relative address', `//${host}`],
    ['loopback', 'https://127.0.0.1'],
    ['localhost', 'https://localhost'],
    ['IPv6 loopback', 'https://[::1]'],
    ['a private address', 'https://10.0.0.5'],
    ['another private address', 'https://192.168.1.10'],
    ['a private 172.16/12 address', 'https://172.16.0.1'],
    ['a link-local address', 'https://169.254.10.1'],
    ['a shared-address-space address', 'https://100.64.0.1'],
    ['the unspecified address', 'https://0.0.0.0'],
    ['an IPv6 link-local address', 'https://[fe80::1]'],
    ['an IPv6 unique local address', 'https://[fd00::1]'],
    ['a public IP literal', 'https://203.0.113.7'],
    ['a test domain', 'https://api.ayailmu-local.test'],
    ['a .local name', 'https://api.local'],
    ['a .localhost name', 'https://api.localhost'],
    ['an .internal name', 'https://api.internal'],
    ['a single-label name', 'https://api'],
  ];
}

describe('without the staging opt-in', () => {
  it('the local configuration is exactly as before, an empty opt-in included', () => {
    const local = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' };
    expect(loadSupabaseConfig(LOCAL)).toEqual(local);
    expect(loadSupabaseConfig(localWith({ EXPO_PUBLIC_ACCOUNT_ENV: '' }))).toEqual(local);
  });

  it('staging addresses keep account sync off', () => {
    expectOff(loadSupabaseConfig(stagingWith({ EXPO_PUBLIC_ACCOUNT_ENV: undefined })), 'EXPO_PUBLIC_API_BASE_URL');
  });
});

describe('with the staging opt-in', () => {
  it('the staging API and Auth root origins turn account sync on, marked staging', () => {
    expect(loadSupabaseConfig(STAGING)).toEqual({
      enabled: true,
      provider: 'local-supabase',
      environment: 'staging',
      apiBaseUrl: STAGING_API,
      authUrl: STAGING_AUTH,
    });
  });

  it.each(['Staging', 'staging ', ' staging', 'production', 'prod', 'stage', 'true'])(
    'an opt-in of %j turns nothing on, and names the opt-in',
    (value) => {
      expectOff(loadSupabaseConfig(stagingWith({ EXPO_PUBLIC_ACCOUNT_ENV: value })), 'EXPO_PUBLIC_ACCOUNT_ENV');
      // An unknown opt-in never falls back to the local configuration either.
      expectOff(loadSupabaseConfig(localWith({ EXPO_PUBLIC_ACCOUNT_ENV: value })), 'EXPO_PUBLIC_ACCOUNT_ENV');
    }
  );

  it('a local or plain-http address never turns staging on', () => {
    expectOff(loadSupabaseConfig(localWith({ EXPO_PUBLIC_ACCOUNT_ENV: 'staging' })), 'EXPO_PUBLIC_API_BASE_URL');
    expectOff(loadSupabaseConfig(stagingWith({ EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092' })), 'EXPO_PUBLIC_API_BASE_URL');
    expectOff(loadSupabaseConfig(stagingWith({ EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:59838' })), 'EXPO_PUBLIC_SUPABASE_AUTH_URL');
  });

  it.each(notStagingOrigins('api-staging.example.com'))('an API address with %s keeps account sync off, naming the API setting', (_case, value) => {
    expectOff(loadSupabaseConfig(stagingWith({ EXPO_PUBLIC_API_BASE_URL: value })), 'EXPO_PUBLIC_API_BASE_URL');
  });

  it.each(notStagingOrigins('auth-staging.example.com'))('an Auth address with %s keeps account sync off, naming the Auth setting', (_case, value) => {
    expectOff(loadSupabaseConfig(stagingWith({ EXPO_PUBLIC_SUPABASE_AUTH_URL: value })), 'EXPO_PUBLIC_SUPABASE_AUTH_URL');
  });
});

describe('Continue with Google in a staging build', () => {
  const page: GooglePlatform = { kind: 'web', origin: STAGING_APP };
  const on: StagingGoogleEnv = {
    EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on',
    EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: `${STAGING_APP}/account`,
    EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  };
  /** `on` with some variables changed (undefined: unset). */
  const onWith = (over: StagingGoogleEnv): StagingGoogleEnv => ({ ...on, ...over });

  /** Google sign-in is off, with a reason that names `setting` and quotes no marker. */
  function expectGoogleOff(config: ReturnType<typeof loadGoogleConfig>, setting: string) {
    expect(config.enabled).toBe(false);
    const reason = config.enabled ? '' : config.reason;
    expect(reason).toContain(setting);
    expect(reason).not.toContain(MARKER);
  }

  it("the web callback is exactly the staging page's own https origin and /account, and only under the opt-in", () => {
    expect(loadGoogleConfig(page, on)).toMatchObject({ enabled: true, provider: 'google', platform: 'web', callbackUrl: `${STAGING_APP}/account` });
    expectGoogleOff(loadGoogleConfig(page, onWith({ EXPO_PUBLIC_ACCOUNT_ENV: undefined })), 'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL');
  });

  it.each([
    ['plain http', 'http://app-staging.example.com/account'],
    ['a trailing slash', `${STAGING_APP}/account/`],
    ['a look-alike route', `${STAGING_APP}/accounts`],
    ['another case', `${STAGING_APP}/Account`],
    ['a query', `${STAGING_APP}/account?k=${MARKER}`],
    ['a fragment', `${STAGING_APP}/account#${MARKER}`],
    ['another origin than the page', 'https://evil.example.com/account'],
    ['another port than the page', `${STAGING_APP}:8443/account`],
    ['credentials', `https://user:${MARKER}@app-staging.example.com/account`],
  ])('a web callback with %s keeps Google sign-in off', (_case, callbackUrl) => {
    expectGoogleOff(loadGoogleConfig(page, onWith({ EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: callbackUrl })), 'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL');
  });

  it('a staging build never takes the local web callback', () => {
    const localPage: GooglePlatform = { kind: 'web', origin: 'http://localhost:8081' };
    expectGoogleOff(
      loadGoogleConfig(localPage, onWith({ EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: 'http://localhost:8081/account' })),
      'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL'
    );
  });

  it('native rules are unchanged under the opt-in: the app scheme only, a build that can run the auth session, and the explicit Google opt-in', () => {
    const native: StagingGoogleEnv = { EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: 'arabictrial://account', EXPO_PUBLIC_ACCOUNT_ENV: 'staging' };
    expect(loadGoogleConfig({ kind: 'native', unavailable: null }, native)).toEqual({
      enabled: true,
      provider: 'google',
      platform: 'native',
      callbackUrl: 'arabictrial://account',
    });
    expectGoogleOff(loadGoogleConfig({ kind: 'native', unavailable: 'Expo Go' }, native), 'Google sign-in is off');
    expectGoogleOff(loadGoogleConfig(page, onWith({ EXPO_PUBLIC_GOOGLE_SIGN_IN: undefined })), 'EXPO_PUBLIC_GOOGLE_SIGN_IN');
  });
});
