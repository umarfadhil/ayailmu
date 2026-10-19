// The staging profile in the API transport and the Auth adapter, Phase 18 RED. Both revalidate it themselves, whatever
// the configuration loader said: the API client takes the staging API origin only with its explicit staging profile
// (environment: 'staging'), and the adapter a staging configuration only with exactly the two staging root origins. Each
// refuses a local or plain-http address under the staging profile, any staging address without it, an unknown profile,
// and anything but a strict canonical HTTPS root origin, before anything is built or sent. Through the adapter the
// maintained SDK reaches the standalone GoTrue at its root (POST /token, POST /logout, the /authorize URL), never a
// guessed hosted /auth/v1 prefix; the password sign-in still takes prepared synthetic .test identities only; and a
// Google web attempt returns exactly to the staging page's /account. Replies from anywhere else, or redirected, are
// refused. The staging hosts are documented placeholders (example.com), never resolved or contacted: requests to them
// are answered by the frozen fake account API and fake GoTrue of test/fakeAccountApi.ts.
import type { EnabledGoogleConfig } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { ApiError, createApiClient } from '@/api/client';
import { memoryGoogleStore, type GoogleSignIn } from '@/auth/google';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError } from '@/auth/types';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';

const STAGING_API = 'https://api-staging.example.com';
const STAGING_AUTH = 'https://auth-staging.example.com';
const STAGING_APP = 'https://app-staging.example.com';
const LOCAL_API = 'http://127.0.0.1:8092';
const LOCAL_AUTH = 'http://127.0.0.1:59838';

/** A prepared synthetic password account (.test). */
const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-staging-1', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };

/** A staging configuration, as the loader returns one, with some members changed. */
function stagingConfig(over: { environment?: string; apiBaseUrl?: string; authUrl?: string } = {}): EnabledSupabaseConfig {
  return { enabled: true, provider: 'local-supabase', environment: 'staging', apiBaseUrl: STAGING_API, authUrl: STAGING_AUTH, ...over } as EnabledSupabaseConfig;
}

const STAGING_GOOGLE: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'web', callbackUrl: `${STAGING_APP}/account` };

/**
 * The staging network as the app reaches it: the staging API and Auth origins, answered by the frozen fakes; every request
 * noted by method and full URL. Anything else does not answer.
 */
function stagingNetwork(fake: FakeAccountApi) {
  const requests: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    const local = url.startsWith(`${STAGING_API}/`)
      ? FAKE_API + url.slice(STAGING_API.length)
      : url.startsWith(`${STAGING_AUTH}/`)
        ? FAKE_GOTRUE + url.slice(STAGING_AUTH.length)
        : null;
    if (local === null) throw new TypeError('Network request failed');
    const reply = (await fake.fetch(local, init)) as unknown as Record<string, unknown>;
    return { ...reply, url } as unknown as Response;
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

/** The Google sign-in of an adapter given a Google configuration. */
function googleOf(auth: SupabaseAuth): GoogleSignIn {
  expect(auth.google).toBeDefined();
  if (!auth.google) throw new Error('no Google sign-in was built');
  return auth.google;
}

/** A reply as fetch would give it, from `url`. */
function replyFrom(url: string, redirected = false): Response {
  const text = JSON.stringify({ account_id: ANI.accountId, profiles: [] });
  return { ok: true, status: 200, url, redirected, headers: { get: () => null }, text: async () => text } as unknown as Response;
}

describe('the API transport', () => {
  it('without the staging profile it still takes only the local pilot API', () => {
    expect(() => createApiClient({ baseUrl: STAGING_API })).toThrow();
  });

  it('with the staging profile it sends the token only to the staging API origin, without cookies or redirects', async () => {
    const net = stagingNetwork(fakeAccountApi([ANI]));
    const sent = jest.fn(net.fetch);
    const options = { baseUrl: STAGING_API, environment: 'staging', fetch: sent as unknown as typeof fetch };
    const api = createApiClient(options);
    await expect(api.me(ANI.token)).resolves.toEqual({ accountId: ANI.accountId, profiles: [] });
    expect(sent).toHaveBeenCalledTimes(1);
    const [url, init] = sent.mock.calls[0];
    expect(url).toBe(`${STAGING_API}/v1/me`);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${ANI.token}`);
  });

  it('with the staging profile it refuses a reply from anywhere else, or a redirected one', async () => {
    for (const reply of [replyFrom('https://evil.example.com/v1/me'), replyFrom(`${STAGING_API}/v1/me`, true)]) {
      const options = { baseUrl: STAGING_API, environment: 'staging', fetch: (async () => reply) as unknown as typeof fetch };
      const api = createApiClient(options);
      const error = await api.me(ANI.token).then(
        () => null,
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('bad_response');
    }
  });

  it.each([
    ['the local pilot API', 'staging', LOCAL_API],
    ['the local pilot API by name', 'staging', 'http://localhost:8092'],
    ['a trailing slash', 'staging', `${STAGING_API}/`],
    ['a path', 'staging', `${STAGING_API}/v1`],
    ['plain http', 'staging', 'http://api-staging.example.com'],
    ['loopback', 'staging', 'https://127.0.0.1'],
    ['credentials', 'staging', 'https://user:pw@api-staging.example.com'],
    ['another port', 'staging', `${STAGING_API}:8443`],
    ['an unknown profile', 'production', STAGING_API],
    ['an unknown profile at the local API', 'production', LOCAL_API],
    ['a profile in another case at the local API', 'Staging', LOCAL_API],
  ])('%s under the %s profile is refused before anything is sent', (_case, environment, baseUrl) => {
    const probe = jest.fn();
    const options = { baseUrl, environment, fetch: probe as unknown as typeof fetch };
    expect(() => createApiClient(options)).toThrow();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('the Auth adapter', () => {
  it("a staging configuration signs a prepared synthetic identity in at the standalone GoTrue's root, and out there too", async () => {
    const fake = fakeAccountApi([ANI]);
    const net = stagingNetwork(fake);
    const auth = createSupabaseAuth({ config: stagingConfig(), fetch: net.fetch });

    // The password sign-in still takes synthetic .test identities only: nothing is sent for another address.
    const refused = await auth.signIn('ani@example.com', ANI.password).then(
      () => null,
      (e: unknown) => e
    );
    expect(refused).toBeInstanceOf(AuthError);
    expect((refused as AuthError).code).toBe('not_synthetic');
    expect(net.requests).toEqual([]);

    await expect(auth.signIn(ANI.email, ANI.password)).resolves.toMatchObject({ uid: providerUserId(ANI), email: ANI.email });
    const api = createApiClient({ baseUrl: STAGING_API, environment: 'staging', fetch: net.fetch } as Parameters<typeof createApiClient>[0]);
    await expect(auth.authorized((token, signal) => api.me(token, signal))).resolves.toMatchObject({ accountId: ANI.accountId });
    await expect(auth.signOut()).resolves.toEqual({ revoked: true });

    expect(net.requests).toEqual([`POST ${STAGING_AUTH}/token?grant_type=password`, `GET ${STAGING_API}/v1/me`, `POST ${STAGING_AUTH}/logout?scope=local`]);
    expect(net.requests.some((request) => request.includes('/auth/v1'))).toBe(false);
  });

  it.each([
    ['local addresses under the staging profile', stagingConfig({ apiBaseUrl: LOCAL_API, authUrl: LOCAL_AUTH })],
    ['Auth under the hosted /auth/v1 prefix', stagingConfig({ authUrl: `${STAGING_AUTH}/auth/v1` })],
    ['Auth with a trailing slash', stagingConfig({ authUrl: `${STAGING_AUTH}/` })],
    ['Auth over plain http', stagingConfig({ authUrl: 'http://auth-staging.example.com' })],
    ['Auth on a private address', stagingConfig({ authUrl: 'https://10.0.0.5' })],
    ['the API on loopback', stagingConfig({ apiBaseUrl: 'https://127.0.0.1' })],
    ['the API over plain http', stagingConfig({ apiBaseUrl: 'http://api-staging.example.com' })],
    ['an unknown profile', stagingConfig({ environment: 'production' })],
    ['an unknown profile at the local addresses', stagingConfig({ environment: 'production', apiBaseUrl: LOCAL_API, authUrl: LOCAL_AUTH })],
    ['a profile in another case at the local addresses', stagingConfig({ environment: 'Staging', apiBaseUrl: LOCAL_API, authUrl: LOCAL_AUTH })],
    [
      'staging addresses without the staging profile',
      { enabled: true, provider: 'local-supabase', apiBaseUrl: STAGING_API, authUrl: STAGING_AUTH } as EnabledSupabaseConfig,
    ],
  ])('%s is refused at once, before anything is built or sent', (_case, config) => {
    const createClient = jest.fn();
    const probe = jest.fn();
    expect(() => createSupabaseAuth({ config, fetch: probe as unknown as typeof fetch, createClient })).toThrow();
    expect(createClient).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it("a staging Google web attempt starts at the standalone GoTrue's root and returns exactly to the staging page's /account, sending nothing", async () => {
    const net = stagingNetwork(fakeAccountApi([ANI]));
    const auth = createSupabaseAuth({ config: stagingConfig(), fetch: net.fetch, google: { config: STAGING_GOOGLE, store: memoryGoogleStore() } });
    const attempt = await googleOf(auth).start();
    expect(attempt.url.startsWith(`${STAGING_AUTH}/authorize?`)).toBe(true);
    expect(new URL(attempt.url).searchParams.get('redirect_to')).toBe(`${STAGING_APP}/account`);
    expect(attempt.callbackUrl).toBe(`${STAGING_APP}/account`);
    expect(net.requests).toEqual([]);
  });

  it.each([
    ['a local web callback under a staging configuration', stagingConfig(), { ...STAGING_GOOGLE, callbackUrl: 'http://localhost:8081/account' }],
    ['a staging web callback under the local configuration', { enabled: true, provider: 'local-supabase', apiBaseUrl: LOCAL_API, authUrl: LOCAL_AUTH } as EnabledSupabaseConfig, STAGING_GOOGLE],
    ['a staging web callback on another route', stagingConfig(), { ...STAGING_GOOGLE, callbackUrl: `${STAGING_APP}/accounts` }],
    ['a staging web callback over plain http', stagingConfig(), { ...STAGING_GOOGLE, callbackUrl: 'http://app-staging.example.com/account' }],
  ])('%s is refused at once', (_case, config, google) => {
    const createClient = jest.fn();
    expect(() => createSupabaseAuth({ config, fetch: jest.fn() as unknown as typeof fetch, google: { config: google, store: memoryGoogleStore(), createClient } })).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
});
