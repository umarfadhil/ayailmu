// Learning-beta Auth and API adapters (B2), RED. The approved normal-email learning beta is the profile 'learning-beta' with
// the explicit capability learningBeta: true, taken here from a valid B1 environment by loadSupabaseConfig. These cases pin
// what the Auth adapter, the API client and the neighbouring registration, Google and recovery checks do with it: a
// conventional address signs in and reauthenticates through its exact Auth root only; a remembered session is bound to the
// learning-beta profile, its two roots and this installation; anything short of the exact capability, equal roots or an
// injected Google or recovery option builds nothing; registration, Google and recovery stay off. Until the adapters forward
// the capability, building them throws, so the positive cases fail at their construction assertions. Nothing here contacts
// anything: the roots are fictional example.com hosts answered by the frozen fakes of test/fakeAccountApi.ts, never
// resolved, and the vault is in memory. The profile and its flags are literals on purpose, so no import can be missing.
import { createAccountSession, reauthenticateOwnAccount } from '@/account/session';
import { isSafeGoogleConfig, loadGoogleConfig, type EnabledGoogleConfig, type GoogleEnv } from '@/account/googleConfig';
import { PRIVATE_QA_REGISTRATION_POLICY } from '@/account/privateQa';
import { loadSupabaseConfig, type EnabledSupabaseConfig, type SupabaseEnv } from '@/account/supabaseConfig';
import { createApiClient, type ApiClient } from '@/api/client';
import type { PendingGoogleStore } from '@/auth/google';
import { isSafeRecoveryConfig, type RecoveryAttemptStore, type RecoveryConfig } from '@/auth/recovery';
import { prepareRecovery, type RecoveryRuntime } from '@/auth/recoverySetup';
import { createRegistration, type RegistrationOptions } from '@/auth/registration';
import { createSupabaseAuth, type CreateSdkClient, type SupabaseAuth, type SupabaseAuthOptions } from '@/auth/supabaseAuth';
import type { SessionVault } from '@/auth/types';
import { registrationPolicy } from '@/ui/account/registrationController';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeUser } from '../../../test/fakeAccountApi';

const PROFILE = 'learning-beta';
const API = 'https://api.beta.example.com';
const AUTH = 'https://auth.beta.example.com';
const APP = 'https://app.beta.example.com';
const OTHER_API = 'https://api.other.example.com';
const OTHER_AUTH = 'https://auth.other.example.com';
const INSTALLATION = 'fixture-installation';
const PASSWORD = 'fixture-password-only';

/** A real-format address, known to the fake GoTrue only. */
const LEARNER: FakeUser = {
  email: 'learner@example.org',
  password: PASSWORD,
  uid: 'uid-learning-beta-learner',
  token: 'legacy-fixture-token',
  accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
};

/** The valid learning-beta build variables: the profile, its flag and mode, every other flag exactly off, two distinct roots. */
const VALID_ENV: SupabaseEnv = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: PROFILE,
  EXPO_PUBLIC_LEARNING_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_PRIVATE_BETA: 'off',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'off',
  EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
  EXPO_PUBLIC_PASSWORD_RECOVERY: 'off',
  EXPO_PUBLIC_API_BASE_URL: API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH,
};

/** The same roots under the other profiles that accept them, for the old contracts and the cross-profile cases. */
const PRODUCTION: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', environment: 'production', productionAccounts: true, apiBaseUrl: API, authUrl: AUTH };
const STAGING: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', environment: 'staging', apiBaseUrl: API, authUrl: AUTH };

/** The API client's options with the future learning-beta capability, which may be any value here. */
type ApiOptions = Parameters<typeof createApiClient>[0] & { learningBeta?: unknown };

/** A labelled change to a configuration or an option set: what a refusal case applies to the exact, valid one. */
type Variant = readonly [label: string, over: Record<string, unknown>];

/** The configuration a valid learning-beta build loads. Asserted, so a B1 regression fails here by assertion, not by a setup error. */
function learningConfig(): EnabledSupabaseConfig {
  const config = loadSupabaseConfig(VALID_ENV);
  expect(config).toMatchObject({ enabled: true, environment: PROFILE, learningBeta: true, apiBaseUrl: API, authUrl: AUTH });
  return config as EnabledSupabaseConfig;
}

const variant = (over: Record<string, unknown>): EnabledSupabaseConfig => ({ ...learningConfig(), ...over }) as unknown as EnabledSupabaseConfig;

/** Whether building did not throw. */
function constructs(make: () => unknown): boolean {
  try {
    make();
    return true;
  } catch {
    return false;
  }
}

/** The labels of the variants `build` accepted: an empty list means every one was refused, and a failure names the rest. */
const acceptedBy = (variants: readonly Variant[], build: (over: Record<string, unknown>) => unknown): string[] =>
  variants.filter(([, over]) => constructs(() => build(over))).map(([label]) => label);

/** Builds the Auth adapter, asserting that it builds: a capability the adapter does not forward fails here, before anything is used. */
function adapter(options: SupabaseAuthOptions): SupabaseAuth {
  let built: SupabaseAuth | undefined;
  expect(() => {
    built = createSupabaseAuth(options);
  }).not.toThrow();
  return built as unknown as SupabaseAuth;
}

/** Builds the API client, asserting that it builds. */
function boundApi(options: ApiOptions): ApiClient {
  let built: ApiClient | undefined;
  expect(() => {
    built = createApiClient(options);
  }).not.toThrow();
  return built as unknown as ApiClient;
}

/** A fetch and an SDK builder that fail a count if anything reaches them. */
function probes() {
  const fetchProbe = jest.fn(() => {
    throw new Error('nothing may be sent');
  });
  const sdkProbe = jest.fn(() => {
    throw new Error('no SDK client may be built');
  });
  return { fetch: fetchProbe as unknown as typeof fetch, sdk: sdkProbe as unknown as CreateSdkClient, fetchProbe, sdkProbe };
}

/**
 * The learning-beta roots as the app would reach them: the frozen fakes answer exactly these two origins, each reply
 * marked as coming from the address asked for, and anything else does not answer. Every request is noted by method and
 * full URL only, never a body or a token.
 */
function learningNetwork() {
  const fake = fakeAccountApi([LEARNER]);
  const requests: string[] = [];
  const remapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    const local = url.startsWith(`${API}/`) ? FAKE_API + url.slice(API.length) : url.startsWith(`${AUTH}/`) ? FAKE_GOTRUE + url.slice(AUTH.length) : null;
    if (local === null) throw new TypeError('Network request failed');
    const reply = (await fake.fetch(local, init)) as unknown as Record<string, unknown>;
    return { ...reply, url } as unknown as Response;
  };
  return { fetch: remapped as typeof fetch, requests, fake };
}

/** An in-memory secure vault: one record, read and written synchronously. */
function memoryVault(initial: string | null = null): SessionVault {
  let text = initial;
  return {
    installation: () => INSTALLATION,
    read: () => text,
    write(value) {
      text = value;
    },
    clear() {
      text = null;
    },
  };
}

/** A whole, valid learning-beta record as a save would write it, with `over` changed. Its refresh token is a fixture that is never sent. */
const wholeRecord = (over: Record<string, string> = {}): string =>
  JSON.stringify({
    v: 1,
    kind: 'password',
    installation: INSTALLATION,
    auth: AUTH,
    api: API,
    profile: PROFILE,
    uid: '8c2e9f13-6a4d-4c79-8b52-4df391a0b625',
    email: LEARNER.email,
    accountId: LEARNER.accountId,
    refreshToken: 'fixture-never-sent',
    savedAt: new Date(Date.now()).toISOString(),
    ...over,
  });

const PASSWORD_GRANT = `POST ${AUTH}/token?grant_type=password`;
const REFRESH_GRANT = `POST ${AUTH}/token?grant_type=refresh_token`;
const LOGOUT = `POST ${AUTH}/logout?scope=local`;

describe('learning-beta password sign-in and reauthentication', () => {
  it('signs a conventional address in through its exact Auth root only, and signing out revokes there', async () => {
    const net = learningNetwork();
    const auth = adapter({ config: learningConfig(), fetch: net.fetch });
    try {
      await expect(auth.signIn(LEARNER.email, LEARNER.password)).resolves.toMatchObject({ uid: providerUserId(LEARNER), email: LEARNER.email });
      await expect(auth.signOut()).resolves.toEqual({ revoked: true });
      expect(net.requests).toEqual([PASSWORD_GRANT, LOGOUT]);
    } finally {
      if (auth.status().state !== 'signed-out') await auth.signOut();
    }
  });

  it.each([
    ['no @', 'learner.example.org'],
    ['a final line feed', `${LEARNER.email}\n`],
  ])('refuses an address with %s as invalid_email, stays signed out and sends nothing', async (_case, email) => {
    const probe = probes();
    const auth = adapter({ config: learningConfig(), fetch: probe.fetch });

    await expect(auth.signIn(email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_email' });
    expect(auth.status()).toEqual({ state: 'signed-out' });
    // Counted, not listed: a failure never prints a request, so never the address or the password.
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
  });

  it('reauthenticates the signed-in account with its password through the Auth root only, and verifies it at the bound API', async () => {
    const net = learningNetwork();
    const auth = adapter({ config: learningConfig(), fetch: net.fetch });
    const api = boundApi({ baseUrl: API, environment: PROFILE, learningBeta: true, fetch: net.fetch });
    const session = createAccountSession({ auth, api });
    try {
      await auth.signIn(LEARNER.email, LEARNER.password);
      const account = await session.verify();
      const fresh = await reauthenticateOwnAccount({
        auth,
        session,
        expected: { accountId: account.accountId, uid: account.uid },
        password: LEARNER.password,
        isCurrent: () => true,
      });
      expect(fresh).toMatchObject({ accountId: LEARNER.accountId, uid: providerUserId(LEARNER) });
      expect(auth.status()).toMatchObject({ state: 'signed-in', session: 2 });
      await auth.signOut();

      // Two password grants and two logouts at the Auth root, two account verifications at the API root, and nothing else.
      const expected = [PASSWORD_GRANT, PASSWORD_GRANT, LOGOUT, LOGOUT, `GET ${API}/v1/me`, `GET ${API}/v1/me`];
      expect([...net.requests].sort()).toEqual(expected.sort());
    } finally {
      if (auth.status().state !== 'signed-out') await auth.signOut();
    }
  });
});

describe('a remembered learning-beta session', () => {
  it('is recorded under the learning-beta profile, its two roots and this installation, and logging out clears it', async () => {
    const net = learningNetwork();
    const vault = memoryVault();
    const auth = adapter({ config: learningConfig(), fetch: net.fetch, remember: { vault } });
    try {
      await auth.signIn(LEARNER.email, LEARNER.password);
      await expect(auth.remembered?.save(LEARNER.accountId)).resolves.toBe(true);
      // The token is taken out first, so a failure never prints it.
      const { refreshToken, ...bound } = JSON.parse(vault.read() ?? '{}') as Record<string, unknown>;
      expect(bound).toEqual({
        v: 1,
        kind: 'password',
        installation: INSTALLATION,
        auth: AUTH,
        api: API,
        profile: PROFILE,
        uid: providerUserId(LEARNER),
        email: LEARNER.email,
        accountId: LEARNER.accountId,
        savedAt: expect.any(String),
      });
      expect(typeof refreshToken).toBe('string');

      await expect(auth.signOut()).resolves.toEqual({ revoked: true });
      expect(vault.read()).toBeNull();
    } finally {
      if (auth.status().state !== 'signed-out') await auth.signOut();
    }
  });

  it('is restored in a later run through one refresh grant at the Auth root, keeping its profile, roots and save time', async () => {
    const net = learningNetwork();
    const vault = memoryVault();
    const config = learningConfig();
    let auth = adapter({ config, fetch: net.fetch, remember: { vault } });
    try {
      await auth.signIn(LEARNER.email, LEARNER.password);
      await expect(auth.remembered?.save(LEARNER.accountId)).resolves.toBe(true);
      const before = JSON.parse(vault.read() ?? '{}') as Record<string, unknown>;
      await auth.remembered?.release();

      // A later run: a new adapter over the same vault and network.
      auth = adapter({ config, fetch: net.fetch, remember: { vault } });
      await expect(auth.remembered?.restore()).resolves.toMatchObject({
        identity: { uid: providerUserId(LEARNER), email: LEARNER.email },
        accountId: LEARNER.accountId,
      });
      const after = JSON.parse(vault.read() ?? '{}') as Record<string, unknown>;
      expect([after.profile, after.auth, after.api, after.installation]).toEqual([PROFILE, AUTH, API, INSTALLATION]);
      expect(after.savedAt).toBe(before.savedAt);
      // Compared as a boolean, so a failure never prints a refresh token.
      expect(after.refreshToken !== before.refreshToken).toBe(true);
      // The password grant, then the one refresh grant: release sent nothing, and no account API request was made.
      expect(net.requests).toEqual([PASSWORD_GRANT, REFRESH_GRANT]);

      await expect(auth.signOut()).resolves.toEqual({ revoked: true });
      expect(vault.read()).toBeNull();
    } finally {
      if (auth.status().state !== 'signed-out') await auth.signOut();
    }
  });

  it.each([
    ['the local profile', { profile: 'local' }],
    ['the staging profile', { profile: 'staging' }],
    ['the production profile', { profile: 'production' }],
    ['another Auth root', { auth: OTHER_AUTH }],
    ['another account API root', { api: OTHER_API }],
    ['another installation', { installation: 'another-installation' }],
  ])('is refused, cleared and unsent when its record names %s', async (_case, over: Record<string, string>) => {
    const probe = probes();
    const vault = memoryVault(wholeRecord(over));
    const auth = adapter({ config: learningConfig(), fetch: probe.fetch, createClient: probe.sdk, remember: { vault } });

    await expect(auth.remembered?.restore()).resolves.toBeNull();
    // Compared as a boolean and counted, so a failure never prints the record or its refresh token.
    expect(vault.read() === null).toBe(true);
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
    expect(probe.sdkProbe).toHaveBeenCalledTimes(0);
  });

  it.each([
    ['production', PRODUCTION],
    ['staging', STAGING],
  ])('is not restorable by a %s adapter at the same two roots: refused, cleared and unsent', async (_case, other: EnabledSupabaseConfig) => {
    const net = learningNetwork();
    const vault = memoryVault();
    const first = adapter({ config: learningConfig(), fetch: net.fetch, remember: { vault } });
    try {
      await first.signIn(LEARNER.email, LEARNER.password);
      await expect(first.remembered?.save(LEARNER.accountId)).resolves.toBe(true);
    } finally {
      await first.remembered?.release();
    }
    expect(vault.read() === null).toBe(false);

    const second = createSupabaseAuth({ config: other, fetch: net.fetch, remember: { vault } });
    await expect(second.remembered?.restore()).resolves.toBeNull();
    expect(vault.read() === null).toBe(true);
    expect(net.requests).toEqual([PASSWORD_GRANT]);
  });
});

/** The adapter's options for a configuration, with a fetch and an SDK builder that must never be reached. */
const guarded = (config: EnabledSupabaseConfig, probe: ReturnType<typeof probes>, extra: Record<string, unknown> = {}): SupabaseAuthOptions =>
  ({ config, fetch: probe.fetch, createClient: probe.sdk, ...extra }) as unknown as SupabaseAuthOptions;

describe('building the learning-beta Auth adapter', () => {
  it('builds only with the capability exactly true: missing, false or not true builds nothing and sends nothing', () => {
    const probe = probes();
    adapter(guarded(learningConfig(), probe));
    const variants: Variant[] = [
      ['capability missing', { learningBeta: undefined }],
      ['capability false', { learningBeta: false }],
      ['capability the text "true"', { learningBeta: 'true' }],
      ['capability the number 1', { learningBeta: 1 }],
    ];

    expect(acceptedBy(variants, (over) => createSupabaseAuth(guarded(variant(over), probe)))).toEqual([]);
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
    expect(probe.sdkProbe).toHaveBeenCalledTimes(0);
  });

  it('builds nothing when the capability sits beside another capability or another profile, which it never widens', () => {
    const probe = probes();
    adapter(guarded(learningConfig(), probe));
    const variants: Variant[] = [
      ['the production capability true', { productionAccounts: true }],
      ['the production capability false', { productionAccounts: false }],
      ['the private QA capability', { privateQa: true }],
      ['the staging profile', { environment: 'staging' }],
      ['the production profile with its capability', { environment: 'production', productionAccounts: true }],
      ['the local default', { environment: undefined, apiBaseUrl: FAKE_API, authUrl: FAKE_GOTRUE }],
      ['a profile spelled in another case', { environment: 'Learning-Beta' }],
    ];

    expect(acceptedBy(variants, (over) => createSupabaseAuth(guarded(variant(over), probe)))).toEqual([]);
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
    expect(probe.sdkProbe).toHaveBeenCalledTimes(0);
  });

  it('builds nothing when the two roots are equal, a local address or a private QA root', () => {
    const probe = probes();
    adapter(guarded(learningConfig(), probe));
    const variants: Variant[] = [
      ['the Auth root equal to the API root', { authUrl: API }],
      ['the API root equal to the Auth root', { apiBaseUrl: AUTH }],
      ['a local Auth root', { authUrl: FAKE_GOTRUE }],
      ['a private QA style API root', { apiBaseUrl: 'https://localhost:58444' }],
    ];

    expect(acceptedBy(variants, (over) => createSupabaseAuth(guarded(variant(over), probe)))).toEqual([]);
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
    expect(probe.sdkProbe).toHaveBeenCalledTimes(0);
  });

  it('builds nothing with a native or web recovery option, and leaves the recovery store alone', () => {
    const probe = probes();
    const store: RecoveryAttemptStore = { save: jest.fn(), take: jest.fn(() => null), clear: jest.fn() };
    const native: RecoveryConfig = { enabled: true, platform: 'native', callbackUrl: 'arabictrial://recover' };
    const web: RecoveryConfig = { enabled: true, platform: 'web', callbackUrl: `${APP}/recover` };
    // The same configuration builds without the option, so the option is what is refused.
    adapter(guarded(learningConfig(), probe));
    const variants: Variant[] = [
      ['the native callback', { recovery: { config: native, store } }],
      ['a web callback on the beta page', { recovery: { config: web, store } }],
    ];

    expect(acceptedBy(variants, (over) => createSupabaseAuth(guarded(learningConfig(), probe, over)))).toEqual([]);
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
    expect(probe.sdkProbe).toHaveBeenCalledTimes(0);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.take).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('keeps Google sign-in off: nothing loads, no configuration is safe, and the adapter refuses the option', () => {
    const native: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'native', callbackUrl: 'arabictrial://account' };
    const web: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'web', callbackUrl: `${APP}/account` };
    const env: GoogleEnv = {
      EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on',
      EXPO_PUBLIC_ACCOUNT_ENV: PROFILE,
      EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: `${APP}/account`,
      EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: 'arabictrial://account',
    };
    // Unchanged: the same native inputs under the local default are taken, so the profile is what turns them off.
    expect(loadGoogleConfig({ kind: 'native', unavailable: null }, { ...env, EXPO_PUBLIC_ACCOUNT_ENV: undefined }).enabled).toBe(true);
    expect(isSafeGoogleConfig(native, undefined)).toBe(true);

    expect(loadGoogleConfig({ kind: 'native', unavailable: null }, env).enabled).toBe(false);
    expect(loadGoogleConfig({ kind: 'web', origin: APP }, env).enabled).toBe(false);
    expect(isSafeGoogleConfig(native, PROFILE)).toBe(false);
    expect(isSafeGoogleConfig(web, PROFILE)).toBe(false);

    const probe = probes();
    const store: PendingGoogleStore = { save: jest.fn(), take: jest.fn(() => null), clear: jest.fn() };
    adapter(guarded(learningConfig(), probe));
    const variants: Variant[] = [
      ['the native callback', { google: { config: native, store } }],
      ['a web callback on the beta page', { google: { config: web, store } }],
    ];
    expect(acceptedBy(variants, (over) => createSupabaseAuth(guarded(learningConfig(), probe, over)))).toEqual([]);
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
    expect(probe.sdkProbe).toHaveBeenCalledTimes(0);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });
});

describe('the learning-beta API client', () => {
  it('takes the explicit capability and sends its requests to the bound API root', async () => {
    const net = learningNetwork();
    const api = boundApi({ baseUrl: API, environment: PROFILE, learningBeta: true, fetch: net.fetch });

    await expect(api.me(LEARNER.token)).resolves.toEqual({ accountId: LEARNER.accountId, profiles: [] });
    await expect(api.request({ method: 'GET', path: '/v1/me', token: LEARNER.token })).resolves.toMatchObject({ status: 200 });
    expect(net.requests).toEqual([`GET ${API}/v1/me`, `GET ${API}/v1/me`]);
    expect(net.fake.wire.map((entry) => entry.server)).toEqual(['api', 'api']);
  });

  it('refuses an omitted or mixed capability, or the capability beside another profile, before any request', () => {
    const probe = probes();
    // Unchanged: the staging client needs no capability, and the exact learning-beta one builds.
    expect(constructs(() => createApiClient({ baseUrl: API, environment: 'staging', fetch: probe.fetch }))).toBe(true);
    boundApi({ baseUrl: API, environment: PROFILE, learningBeta: true, fetch: probe.fetch });
    const variants: Variant[] = [
      ['no capability', { environment: PROFILE }],
      ['capability false', { environment: PROFILE, learningBeta: false }],
      ['capability the text "true"', { environment: PROFILE, learningBeta: 'true' }],
      ['beside the production capability', { environment: PROFILE, learningBeta: true, productionAccounts: true }],
      ['beside the private QA capability', { environment: PROFILE, learningBeta: true, privateQa: true }],
      ['beside the staging profile', { environment: 'staging', learningBeta: true }],
      ['beside the production profile', { environment: 'production', productionAccounts: true, learningBeta: true }],
      ['beside the local default', { baseUrl: FAKE_API, learningBeta: true }],
    ];

    const accepted = acceptedBy(variants, (over) => createApiClient({ baseUrl: API, fetch: probe.fetch, ...over } as unknown as ApiOptions));
    expect(accepted).toEqual([]);
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
  });
});

describe('registration and password recovery stay off for learning-beta', () => {
  const savedRecovery = process.env.EXPO_PUBLIC_PASSWORD_RECOVERY;
  // The build-global recovery flag is on: only the profile may keep recovery off.
  beforeEach(() => {
    process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = 'on';
  });
  afterEach(() => {
    if (savedRecovery === undefined) delete process.env.EXPO_PUBLIC_PASSWORD_RECOVERY;
    else process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = savedRecovery;
  });

  const NATIVE: RecoveryConfig = { enabled: true, platform: 'native', callbackUrl: 'arabictrial://recover' };
  const WEB: RecoveryConfig = { enabled: true, platform: 'web', callbackUrl: `${APP}/recover` };
  /** A native runtime that is available, a web runtime on the beta page, and a store that must stay untouched. */
  const nativeRuntime = (): RecoveryRuntime => ({ platform: { kind: 'native', unavailable: null }, takeLaunchUrl: () => null, subscribe: () => () => undefined });
  const webRuntime = (): RecoveryRuntime => ({ platform: { kind: 'web', origin: APP }, takeLaunchUrl: () => null, subscribe: () => () => undefined });
  const untouchedStore = (): RecoveryAttemptStore => ({ save: jest.fn(), take: jest.fn(() => null), clear: jest.fn() });
  /** The recovery check with capability arguments after the profile, typed here so a future one can be passed. */
  const isSafe: (config: unknown, environment: unknown, ...capabilities: unknown[]) => boolean = isSafeRecoveryConfig;

  it('offers no registration policy for any registration flag', () => {
    const config = learningConfig();
    const offered = ['on', 'confirmed-email', PRIVATE_QA_REGISTRATION_POLICY].filter((flag) => registrationPolicy(config, flag) !== null);

    expect(offered).toEqual([]);
    // Unchanged: the same flag and the same roots under the staging profile do offer the synthetic policy.
    expect(registrationPolicy(STAGING, 'on')).toBe('synthetic');
  });

  it('refuses every registration policy when registration is built directly, before any SDK or fetch', () => {
    const probe = probes();
    const direct = (emailPolicy: unknown, config: EnabledSupabaseConfig) =>
      createRegistration({ config, emailPolicy, fetch: probe.fetch, createClient: probe.sdk } as unknown as RegistrationOptions);
    // Unchanged: the staging profile builds the synthetic registration.
    expect(constructs(() => direct('synthetic', STAGING))).toBe(true);

    const policies: Variant[] = [
      ['the default policy', { emailPolicy: undefined }],
      ['the synthetic policy', { emailPolicy: 'synthetic' }],
      ['the confirmed-email policy', { emailPolicy: 'confirmed-email' }],
      ['the private QA policy', { emailPolicy: PRIVATE_QA_REGISTRATION_POLICY }],
    ];
    expect(acceptedBy(policies, (over) => direct(over.emailPolicy, learningConfig()))).toEqual([]);
    expect(probe.fetchProbe).toHaveBeenCalledTimes(0);
    expect(probe.sdkProbe).toHaveBeenCalledTimes(0);
  });

  it('refuses its recovery configuration, the native callback included, whatever capability argument follows the profile', () => {
    // Unchanged: the staging profile takes the native callback.
    expect(isSafe(NATIVE, 'staging')).toBe(true);

    const capabilities: unknown[][] = [[], [true], [undefined, undefined, true]];
    const accepted = capabilities.flatMap((arguments_) =>
      [NATIVE, WEB].filter((config) => isSafe(config, PROFILE, ...arguments_)).map((config) => `${config.platform} callback, capability arguments ${JSON.stringify(arguments_)}`)
    );
    expect(accepted).toEqual([]);
  });

  it('prepares no recovery with the global flag on and a native or web runtime and store supplied', () => {
    const config = learningConfig();
    const store = untouchedStore();
    // Unchanged: the same runtimes and store prepare recovery for the staging profile, so the profile is what turns it off.
    expect(prepareRecovery(STAGING, nativeRuntime(), store)).not.toBeNull();
    expect(prepareRecovery(STAGING, webRuntime(), store)).not.toBeNull();

    expect(prepareRecovery(config, nativeRuntime(), store)).toBeNull();
    expect(prepareRecovery(config, webRuntime(), store)).toBeNull();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.take).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });
});
