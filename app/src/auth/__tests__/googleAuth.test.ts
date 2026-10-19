// Continue with Google through the local GoTrue with the maintained SDK's authorization code + PKCE flow, written before
// its implementation (phase 10). The real @supabase/auth-js AuthClient runs over the adapter's bounded transport; behind
// it, test/fakeGoogleAuth.ts plays the browser's trip through GoTrue and Google (consent() checks the authorize URL as
// GoTrue would and returns the app's callback with a code) and GoTrue's PKCE exchange (each code once, for the verifier
// whose S256 hash is its challenge), in front of the fake GoTrue and account API of test/fakeAccountApi.ts (prepared
// users, refresh rotation, local logout, revocation). The attempt's short-lived record sits in a test store the test can
// read. Web storage, SQLite, the learner store and the console are watched: no token, code, verifier or password is
// stored anywhere else or logged. Local mocked protocol evidence only, never a real Google sign-in.
import { AuthClient, type GoTrueClientOptions } from '@supabase/auth-js';
import { webcrypto } from 'crypto';

import type { EnabledGoogleConfig } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { GOOGLE_ATTEMPT_TTL_MS, type GoogleAttemptRecord, type GoogleAuthOptions, type GoogleSdkClient, type GoogleSignIn } from '@/auth/google';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError, type AuthIdentity } from '@/auth/types';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
import { fakeGoogleGoTrue, s256, type FakeGoogleGoTrue, type GoogleAccount } from '../../../test/fakeGoogleAuth';

// Persistence boundaries that a Google sign-in must never open.
const mockSqliteOpened = jest.fn();
const mockLearnerStoreOpened = jest.fn();
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (...args: unknown[]) => mockSqliteOpened(...args),
  openDatabaseAsync: async (...args: unknown[]) => mockSqliteOpened(...args),
}));
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async (...args: unknown[]) => mockLearnerStoreOpened(...args),
}));

const T = Date.UTC(2026, 9, 19, 5, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: FAKE_API, authUrl: FAKE_GOTRUE };
const NATIVE: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'native', callbackUrl: 'arabictrial://account' };
const WEB: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'web', callbackUrl: 'http://localhost:8081/account' };
const PKCE_EXCHANGE = 'POST /token?grant_type=pkce';
const isExchange = (request: string) => request === PKCE_EXCHANGE;
/** The constructor options a Google SDK client may get: PKCE over a storage of the adapter's own; no headers (so no API key), no lock. */
const GOOGLE_SDK_OPTIONS = ['url', 'storageKey', 'flowType', 'persistSession', 'storage', 'detectSessionInUrl', 'autoRefreshToken', 'debug', 'fetch'];
/** The Google SDK client's public methods the adapter may use, as its GoogleSdkClient type names them. */
const GOOGLE_PUBLIC_METHODS = ['signInWithOAuth', 'exchangeCodeForSession', 'refreshSession', 'signOut', 'stopAutoRefresh', 'dispose'];

/** Prepared synthetic password accounts (.test). */
const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-local-1', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };
const BUDI: FakeUser = { email: 'budi@ayailmu.test', password: 'pw-budi-local-2', uid: 'uid-budi', token: 'legacy-id-token-budi', accountId: '7c2e2a5f-3d4b-4e6f-9a71-82b3c4d5e6f7' };
/** Google accounts with ordinary (non-.test) addresses, known to the local GoTrue. */
const G_ANI: GoogleAccount = {
  email: 'ani.learner@example.com',
  password: 'mint-only-google-ani-4',
  uid: 'uid-google-ani',
  token: 'unused-legacy-token-google-ani',
  accountId: '8d3f3b60-4e5c-4f70-8b82-93c4d5e6f708',
  googleSub: '109876543210987654321',
  name: 'Ani Pelajar',
};
const G_BUDI: GoogleAccount = {
  email: 'budi.learner@example.com',
  password: 'mint-only-google-budi-5',
  uid: 'uid-google-budi',
  token: 'unused-legacy-token-google-budi',
  accountId: '9e404c71-5f6d-4081-9c93-a4d5e6f70819',
  googleSub: '108765432109876543210',
  name: 'Budi Pelajar',
};

/** Replaces a global for one test; returns the undo. */
function replaceGlobal(name: 'fetch' | 'localStorage' | 'sessionStorage' | 'crypto', value: unknown): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(globalThis, name, before);
    else Reflect.deleteProperty(globalThis, name);
  };
}

/** Starts `run` now and gives its rejection (a synchronous throw counts); the test fails if it resolves. */
function failure(run: () => Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve) => resolve(run())).then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );
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

/** A typed AuthError with a stable code, whose text shows none of `secrets`. */
function expectCode(error: unknown, code: string, secrets: string[] = []) {
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).code).toBe(code);
  const shown = `${String(error)} ${JSON.stringify(error)}`;
  for (const secret of secrets) expect(shown).not.toContain(secret);
}

/** Lets every pending reply and its follow-ups (a retired client's sign-out, say) run to the end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Waits until `check` holds, as the follow-ups of a dropped result settle. */
async function eventually(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i += 1) await settle();
  expect(check()).toBe(true);
}

/** A logged value as text, errors included. */
function printed(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message} ${value.stack ?? ''}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const codeOf = (callback: string) => new URL(callback).searchParams.get('code') ?? '';

/** The tab's short-lived store as the adapter sees it, with what it holds visible to the test. */
function testStore() {
  let held: GoogleAttemptRecord | null = null;
  return {
    save(record: GoogleAttemptRecord) {
      held = { ...record };
    },
    take() {
      const record = held;
      held = null;
      return record;
    },
    clear() {
      held = null;
    },
    /** What it holds now, without taking it. */
    peek: (): GoogleAttemptRecord | null => held,
    /** Puts a record there, as an earlier page (or someone tampering with the tab's storage) would. */
    put(record: GoogleAttemptRecord) {
      held = { ...record };
    },
  };
}
type TestStore = ReturnType<typeof testStore>;

/** The real SDK client behind a transparent proxy that notes every member the adapter reaches for. */
function watched(client: InstanceType<typeof AuthClient>, touched: string[]): GoogleSdkClient {
  return new Proxy(client, {
    get(target, key) {
      if (typeof key === 'string' && key !== 'then') touched.push(key);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    set(target, key, value) {
      touched.push(`set ${String(key)}`);
      return Reflect.set(target, key, value, target);
    },
  });
}

/** The Google sign-in of an adapter given a Google configuration. */
function googleOf(auth: SupabaseAuth): GoogleSignIn {
  expect(auth.google).toBeDefined();
  if (!auth.google) throw new Error('no Google sign-in was built');
  return auth.google;
}

describe('Continue with Google through the SDK (authorization code + PKCE)', () => {
  const fakeWebStorage = () => ({ length: 0, key: jest.fn(() => null), getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn() });
  let web = { local: fakeWebStorage(), session: fakeWebStorage() };
  let networkProbe = jest.fn();
  let logs: jest.SpyInstance[] = [];
  let undo: (() => void)[] = [];
  let clock = { now: T };
  let fake: FakeAccountApi = fakeAccountApi([]);
  let gotrue: FakeGoogleGoTrue = fakeGoogleGoTrue(fake, { redirects: [], known: [] });

  beforeEach(() => {
    mockSqliteOpened.mockClear();
    mockLearnerStoreOpened.mockClear();
    clock = { now: T };
    fake = fakeAccountApi([ANI, BUDI, G_ANI, G_BUDI]);
    gotrue = fakeGoogleGoTrue(fake, { redirects: [NATIVE.callbackUrl, WEB.callbackUrl], known: [G_ANI, G_BUDI] });
    web = { local: fakeWebStorage(), session: fakeWebStorage() };
    networkProbe = jest.fn();
    undo = [replaceGlobal('fetch', networkProbe), replaceGlobal('localStorage', web.local), replaceGlobal('sessionStorage', web.session)];
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => clock.now);
    undo.push(() => dateNow.mockRestore());
    logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'info'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error'), jest.spyOn(console, 'debug')];
  });
  afterEach(() => {
    try {
      // No token, code, verifier or password was logged; nothing reached web storage, the global fetch, SQLite or the learner store.
      const logged = logs.flatMap((spy) => spy.mock.calls.flat().map(printed)).join('\n');
      for (const secret of gotrue.secrets) expect(logged).not.toContain(secret);
      for (const storage of [web.local, web.session]) {
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.removeItem).not.toHaveBeenCalled();
        expect(storage.clear).not.toHaveBeenCalled();
      }
      expect(networkProbe).not.toHaveBeenCalled();
      expect(mockSqliteOpened).not.toHaveBeenCalled();
      expect(mockLearnerStoreOpened).not.toHaveBeenCalled();
    } finally {
      logs.forEach((spy) => spy.mockRestore());
      undo.reverse().forEach((restore) => restore());
    }
  });

  function setup(options: { google?: EnabledGoogleConfig; store?: TestStore; createClient?: GoogleAuthOptions['createClient'] } = {}) {
    const store = options.store ?? testStore();
    const auth = createSupabaseAuth({ config: CONFIG, fetch: gotrue.fetch, google: { config: options.google ?? NATIVE, store, createClient: options.createClient } });
    return { auth, store };
  }

  it('no Google sign-in exists without its configuration; an unsafe one is refused before anything is built or sent', () => {
    const createClient = jest.fn();
    expect(createSupabaseAuth({ config: CONFIG, fetch: gotrue.fetch }).google).toBeUndefined();
    expect(createSupabaseAuth({ config: CONFIG, fetch: gotrue.fetch, google: { config: NATIVE, store: testStore(), createClient } }).google).toBeDefined();
    expect(createSupabaseAuth({ config: CONFIG, fetch: gotrue.fetch, google: { config: WEB, store: testStore(), createClient } }).google).toBeDefined();

    const UNSAFE: unknown[] = [
      { ...NATIVE, enabled: false },
      { ...NATIVE, provider: 'github' },
      { ...NATIVE, callbackUrl: 'arabictrial://lesson-review' },
      { ...NATIVE, callbackUrl: 'https://evil.example/account' },
      { ...WEB, callbackUrl: 'http://localhost:8081/' },
      { ...WEB, callbackUrl: 'https://evil.example/account' },
      { ...WEB, callbackUrl: 'arabictrial://account' },
    ];
    for (const config of UNSAFE) {
      // Revalidated by the adapter itself: refused at once, naming no value.
      const error = thrown(() => createSupabaseAuth({ config: CONFIG, fetch: gotrue.fetch, google: { config: config as EnabledGoogleConfig, store: testStore(), createClient } }));
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('nothing was sent');
      expect(String(error)).not.toMatch(/evil|lesson-review|github/);
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(gotrue.requests).toEqual([]);
  });

  it('starting sends nothing: an S256 authorize URL for Google at the Auth root, with the exact callback and identity scopes only, and one short-lived record without any token', async () => {
    const { auth, store } = setup();
    const attempt = await googleOf(auth).start();

    expect(gotrue.requests).toEqual([]);
    expect(fake.wire).toEqual([]);
    const url = new URL(attempt.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${FAKE_GOTRUE}/authorize`);
    const query = url.searchParams;
    expect(query.get('provider')).toBe('google');
    expect(query.getAll('redirect_to')).toEqual([NATIVE.callbackUrl]);
    expect(attempt.callbackUrl).toBe(NATIVE.callbackUrl);
    expect(query.get('scopes')).toBe('openid email profile');
    expect(query.get('code_challenge_method')).toBe('s256');
    expect(query.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The learner picks the Google account each time; nothing else is asked for (no offline access, no key).
    expect(query.get('prompt')).toBe('select_account');
    expect([...new Set(query.keys())].sort()).toEqual(['code_challenge', 'code_challenge_method', 'prompt', 'provider', 'redirect_to', 'scopes']);

    // The record is exactly the attempt, bound to this URL by its verifier; the URL never carries the verifier.
    const record = store.peek();
    expect(record === null ? null : Object.keys(record).sort()).toEqual(['callbackUrl', 'createdAt', 'flowId', 'v', 'verifier']);
    expect(record).toMatchObject({ v: 1, callbackUrl: NATIVE.callbackUrl, createdAt: T });
    expect(s256(record?.verifier ?? '')).toBe(query.get('code_challenge'));
    expect(attempt.url).not.toContain(record?.verifier ?? 'no verifier');
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it("the pending attempt's callback is exchanged once through the SDK (GoTrue checks the S256 verifier), signing in the Google account; its session then works as any other", async () => {
    const { auth, store } = setup();
    const attempt = await googleOf(auth).start();
    const callback = gotrue.consent(attempt.url, G_ANI);

    const identity = await attempt.complete(callback);

    // The Google account's own address: the synthetic .test rule is the password sign-in's only. No profile metadata.
    expect(identity).toEqual({ uid: providerUserId(G_ANI), email: G_ANI.email, expiresAt: T + HOUR });
    expect(gotrue.requests).toEqual([PKCE_EXCHANGE]);
    expect(gotrue.exchanges).toEqual(['issued']);
    expect(store.peek()).toBeNull();
    const signedIn = auth.status();
    expect(signedIn).toEqual({ state: 'signed-in', identity, session: expect.any(Number) });
    const token = await auth.authorized(async (t) => t);
    expect(fake.auth.issued()).toContain(token);

    // A refresh renews the same session: no new exchange and no password grant.
    clock.now = T + 10 * MINUTE;
    const renewed = await auth.refresh();
    expect(renewed).toEqual({ ...identity, expiresAt: clock.now + HOUR });
    expect(auth.status()).toEqual({ ...signedIn, identity: renewed });
    await expect(auth.authorized(async (t) => t)).resolves.not.toBe(token);

    // Signing out revokes it for this device only.
    await expect(auth.signOut()).resolves.toEqual({ revoked: true });
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(gotrue.requests).toEqual([PKCE_EXCHANGE, 'POST /token?grant_type=refresh_token', 'POST /logout?scope=local']);
    expect(fake.auth.liveSessions(G_ANI.email)).toBe(0);

    // The password sign-in still takes synthetic .test addresses only, whatever Google accepts.
    expectCode(await failure(() => auth.signIn(G_ANI.email, G_ANI.password)), 'not_synthetic', [G_ANI.password]);
    expect(gotrue.requests).toHaveLength(3);
  });

  it("the web's full-page redirect: a fresh run resumes the recorded attempt with the URL it loaded; a stale or foreign record, or none, is refused; no URL only ends the attempt", async () => {
    const store = testStore();
    // The page that started the attempt: then the browser left for Google, and its memory was gone.
    const before = setup({ google: WEB, store });
    const attempt = await googleOf(before.auth).start();
    const callback = gotrue.consent(attempt.url, G_ANI);
    expect(callback.startsWith(`${WEB.callbackUrl}?code=`)).toBe(true);
    clock.now = T + 2 * MINUTE; // the learner took a while at Google

    const after = setup({ google: WEB, store });
    await expect(googleOf(after.auth).resume(callback)).resolves.toEqual({ uid: providerUserId(G_ANI), email: G_ANI.email, expiresAt: clock.now + HOUR });
    expect(after.auth.status()).toMatchObject({ state: 'signed-in', identity: { email: G_ANI.email } });
    expect(before.auth.status()).toEqual({ state: 'signed-out' });
    expect(store.peek()).toBeNull();
    expect(gotrue.requests).toEqual([PKCE_EXCHANGE]);

    // A run loaded without a callback (the learner came back another way): the recorded attempt just ends.
    const left = await googleOf(setup({ google: WEB, store }).auth).start();
    expect(store.peek()).not.toBeNull();
    await expect(googleOf(setup({ google: WEB, store }).auth).resume(null)).resolves.toBeNull();
    expect(store.peek()).toBeNull();
    expect(left.url).toContain('/authorize?');

    // A record past its lifetime is refused, and removed.
    const stale = await googleOf(setup({ google: WEB, store }).auth).start();
    const staleCallback = gotrue.consent(stale.url, G_ANI);
    clock.now += GOOGLE_ATTEMPT_TTL_MS + SECOND;
    expectCode(await failure(() => googleOf(setup({ google: WEB, store }).auth).resume(staleCallback)), 'bad_callback', gotrue.secrets);
    expect(store.peek()).toBeNull();

    // A record for another callback than this build's (tampered with, or left by another build) is refused too.
    const foreign = await googleOf(setup({ google: WEB, store }).auth).start();
    const foreignCallback = gotrue.consent(foreign.url, G_ANI);
    const recorded = store.peek();
    if (!recorded) throw new Error('no record');
    store.put({ ...recorded, callbackUrl: 'http://localhost:8082/account' });
    expectCode(await failure(() => googleOf(setup({ google: WEB, store }).auth).resume(foreignCallback)), 'bad_callback', gotrue.secrets);
    expect(store.peek()).toBeNull();
    expect(gotrue.requests).toEqual([PKCE_EXCHANGE]);
  });

  const OTHER_CODE = '5d0c6a4e-3f2b-4c1d-9e8f-7a6b5c4d3e2f';
  const REFUSED: { case: string; url: (callback: string, code: string) => string; code: string; hides?: string[] }[] = [
    { case: 'another route of the app', url: (_c, code) => `arabictrial://lesson-review?code=${code}`, code: 'bad_callback' },
    { case: 'a longer path', url: (_c, code) => `arabictrial://account/google?code=${code}`, code: 'bad_callback' },
    { case: 'a look-alike route', url: (_c, code) => `arabictrial://accounts?code=${code}`, code: 'bad_callback' },
    { case: 'a look-alike host', url: (_c, code) => `arabictrial://account.evil.test?code=${code}`, code: 'bad_callback' },
    { case: 'an Expo Go address', url: (_c, code) => `exp://127.0.0.1:8081/--/account?code=${code}`, code: 'bad_callback' },
    { case: 'a web page elsewhere', url: (_c, code) => `https://evil.example/account?code=${code}`, code: 'bad_callback' },
    { case: 'a second code', url: (callback) => `${callback}&code=${OTHER_CODE}`, code: 'bad_callback' },
    { case: 'an empty code', url: () => 'arabictrial://account?code=', code: 'bad_callback' },
    { case: 'a code with markup', url: (_c, code) => `arabictrial://account?code=${code}%22%3E%3Cscript%3E`, code: 'bad_callback' },
    { case: 'an overlong code', url: () => `arabictrial://account?code=${'a'.repeat(600)}`, code: 'bad_callback' },
    {
      case: 'tokens beside the code (an implicit-flow reply)',
      url: (callback) => `${callback}#access_token=leaked-access-1&refresh_token=leaked-refresh-1&token_type=bearer`,
      code: 'bad_callback',
      hides: ['leaked-access-1', 'leaked-refresh-1'],
    },
    {
      case: 'tokens instead of a code',
      url: () => 'arabictrial://account#access_token=leaked-access-2&expires_in=3600&refresh_token=leaked-refresh-2&token_type=bearer',
      code: 'bad_callback',
      hides: ['leaked-access-2', 'leaked-refresh-2'],
    },
    { case: 'a code and an error', url: (callback) => `${callback}&error=server_error&error_description=Something+broke`, code: 'bad_callback', hides: ['Something broke'] },
    { case: 'neither a code nor an error', url: () => 'arabictrial://account', code: 'bad_callback' },
    {
      case: 'the learner declining at Google',
      url: () => 'arabictrial://account?error=access_denied&error_description=The+user+denied+the+request',
      code: 'cancelled',
      hides: ['denied the request'],
    },
    {
      case: 'the same refusal in the fragment',
      url: () => 'arabictrial://account#error=access_denied&error_description=The+user+denied+the+request',
      code: 'cancelled',
      hides: ['denied the request'],
    },
    {
      case: 'the same refusal in both the query and the fragment',
      url: () => 'arabictrial://account?error=access_denied&error_description=Denied+here#error=access_denied&error_description=Denied+here',
      code: 'cancelled',
      hides: ['Denied here'],
    },
    {
      case: 'a Google account the local GoTrue does not know (sign-up is off)',
      url: () => 'arabictrial://account?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance',
      code: 'not_registered',
      hides: ['Signups not allowed'],
    },
    {
      case: 'another provider error',
      url: () => 'arabictrial://account?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code',
      code: 'provider_refused',
      hides: ['Unable to exchange'],
    },
    {
      case: "GoTrue's OAuth state refused",
      url: () => 'arabictrial://account?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+parameter+missing',
      code: 'provider_refused',
      hides: ['OAuth state parameter'],
    },
  ];
  it.each(REFUSED)('$case is refused as $code without a request, and ends the attempt', async ({ url, code, hides = [] }) => {
    const { auth, store } = setup();
    const attempt = await googleOf(auth).start();
    const callback = gotrue.consent(attempt.url, G_ANI);

    const error = await failure(() => attempt.complete(url(callback, codeOf(callback))));

    expectCode(error, code, [...hides, ...gotrue.secrets]);
    expect(gotrue.requests).toEqual([]);
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(store.peek()).toBeNull();
    // The attempt is over: even its own callback is refused now, still without a request.
    expectCode(await failure(() => attempt.complete(callback)), 'bad_callback', gotrue.secrets);
    expect(gotrue.requests).toEqual([]);
  });

  it('a replayed, duplicated or unsolicited callback, or one after cancelling, is refused without adopting anything; the session in use stays as it was', async () => {
    const { auth, store } = setup();
    const google = googleOf(auth);
    const a = await google.start();
    const callbackA = gotrue.consent(a.url, G_ANI);
    await expect(a.complete(callbackA)).resolves.toMatchObject({ email: G_ANI.email });
    const signedIn = auth.status();
    const token = await auth.authorized(async (t) => t);

    // Replayed in this run, or by reloading the callback page: refused without a request; the session untouched.
    expectCode(await failure(() => a.complete(callbackA)), 'bad_callback', gotrue.secrets);
    expectCode(await failure(() => googleOf(setup({ store }).auth).resume(callbackA)), 'bad_callback', gotrue.secrets);
    expect(gotrue.requests.filter(isExchange)).toHaveLength(1);
    expect(auth.status()).toEqual(signedIn);
    await expect(auth.authorized(async (t) => t)).resolves.toBe(token);

    // Unsolicited: a callback of an attempt started on another device, where this run recorded nothing.
    const elsewhere = await googleOf(setup().auth).start();
    const theirCallback = gotrue.consent(elsewhere.url, G_BUDI);
    expectCode(await failure(() => googleOf(setup().auth).resume(theirCallback)), 'bad_callback', gotrue.secrets);
    expect(gotrue.requests.filter(isExchange)).toHaveLength(1);
    // Delivered to an attempt of this run instead: its code is not bound to this attempt's verifier, so GoTrue refuses it.
    const mine = await google.start();
    expectCode(await failure(() => mine.complete(theirCallback)), 'bad_callback', gotrue.secrets);
    expect(gotrue.exchanges).toEqual(['issued', 'bad_verifier']);
    expect(auth.status()).toEqual(signedIn);

    // Duplicated: the same callback twice at once is exchanged once.
    const b = await google.start();
    const callbackB = gotrue.consent(b.url, G_BUDI);
    const outcomes = await Promise.allSettled([b.complete(callbackB), b.complete(callbackB)]);
    const signedInAs = outcomes.flatMap((o) => (o.status === 'fulfilled' ? [(o.value as AuthIdentity).email] : []));
    const refused = outcomes.flatMap((o) => (o.status === 'rejected' ? [o.reason as unknown] : []));
    expect(signedInAs).toEqual([G_BUDI.email]);
    expect(refused).toHaveLength(1);
    expectCode(refused[0], 'bad_callback', gotrue.secrets);
    expect(gotrue.exchanges).toEqual(['issued', 'bad_verifier', 'issued']);
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity: { email: G_BUDI.email } });

    // Cancelled: the browser closed without a callback, and its record is gone; a late callback changes nothing.
    const c = await google.start();
    const callbackC = gotrue.consent(c.url, G_ANI);
    c.cancel();
    expect(store.peek()).toBeNull();
    expectCode(await failure(() => c.complete(callbackC)), 'cancelled', gotrue.secrets);
    expect(gotrue.exchanges).toHaveLength(3);
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity: { email: G_BUDI.email } });
  });

  it('the latest sign-in wins: a superseded attempt is refused without a request, and an exchange settling after a sign-out or another sign-in installs nothing and its session is revoked', async () => {
    const { auth, store } = setup();
    const google = googleOf(auth);

    // A newer Google attempt: the older one is refused locally, and the newer one still completes.
    const older = await google.start();
    const olderCallback = gotrue.consent(older.url, G_ANI);
    const newer = await google.start();
    const newerCallback = gotrue.consent(newer.url, G_BUDI);
    expectCode(await failure(() => older.complete(olderCallback)), 'superseded', gotrue.secrets);
    expect(gotrue.requests).toEqual([]);
    await expect(newer.complete(newerCallback)).resolves.toMatchObject({ email: G_BUDI.email });

    // A password sign-in supersedes a pending attempt too, and removes its record.
    const pending = await google.start();
    const pendingCallback = gotrue.consent(pending.url, G_ANI);
    const ani = await auth.signIn(ANI.email, ANI.password);
    expect(store.peek()).toBeNull();
    expectCode(await failure(() => pending.complete(pendingCallback)), 'superseded', gotrue.secrets);
    expect(gotrue.requests.filter(isExchange)).toHaveLength(1);
    expect(auth.status()).toEqual({ state: 'signed-in', identity: ani, session: expect.any(Number) });

    // Signed out while an exchange is on its way: GoTrue made a session, which is never adopted and is revoked.
    const leaving = await google.start();
    const leavingCallback = gotrue.consent(leaving.url, G_ANI);
    const heldOut = gotrue.holdNextExchange();
    const lateOut = failure(() => leaving.complete(leavingCallback));
    await heldOut.arrived;
    expect(fake.auth.liveSessions(G_ANI.email)).toBe(1);
    const signingOut = auth.signOut();
    expect(auth.status()).toEqual({ state: 'signed-out' });
    heldOut.release();
    expectCode(await lateOut, 'signed_out', gotrue.secrets);
    await signingOut;
    expect(auth.status()).toEqual({ state: 'signed-out' });
    await eventually(() => fake.auth.liveSessions(G_ANI.email) === 0);

    // Another account signs in while an exchange is on its way: that account stays, and the late session is revoked.
    const switching = await google.start();
    const switchingCallback = gotrue.consent(switching.url, G_ANI);
    const heldSwitch = gotrue.holdNextExchange();
    const lateSwitch = failure(() => switching.complete(switchingCallback));
    await heldSwitch.arrived;
    const budi = await auth.signIn(BUDI.email, BUDI.password);
    heldSwitch.release();
    expectCode(await lateSwitch, 'superseded', gotrue.secrets);
    await eventually(() => fake.auth.liveSessions(G_ANI.email) === 0);
    expect(auth.status()).toEqual({ state: 'signed-in', identity: budi, session: expect.any(Number) });
    await expect(auth.authorized(async (t) => t)).resolves.toEqual(expect.any(String));
    expect(fake.auth.liveSessions(BUDI.email)).toBe(1);
  });

  it('a platform without WebCrypto (whose SDK would fall back to a plain challenge), or a store that refuses the record, cannot start: nothing is opened, recorded or sent', async () => {
    const restore = replaceGlobal('crypto', { getRandomValues: <T extends Parameters<typeof webcrypto.getRandomValues>[0]>(array: T): T => webcrypto.getRandomValues(array) });
    try {
      const { auth, store } = setup();
      expectCode(await failure(() => googleOf(auth).start()), 'unavailable', gotrue.secrets);
      expect(store.peek()).toBeNull();
    } finally {
      restore();
    }

    const refusing = testStore();
    refusing.save = () => {
      throw new Error('QuotaExceededError');
    };
    const { auth } = setup({ store: refusing });
    expectCode(await failure(() => googleOf(auth).start()), 'unavailable', gotrue.secrets);
    expect(gotrue.requests).toEqual([]);
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it('each Google SDK client is PKCE over a RAM storage of its own (no API key, lock, URL detection, background refresh or debug output), only its public methods are used, and nothing of the attempt or the session is left in it', async () => {
    const built: GoTrueClientOptions[] = [];
    const touched: string[] = [];
    const { auth, store } = setup({
      createClient: (options) => {
        built.push(options);
        return watched(new AuthClient(options), touched);
      },
    });
    const attempt = await googleOf(auth).start();
    const flowId = store.peek()?.flowId ?? 'no-flow';
    await attempt.complete(gotrue.consent(attempt.url, G_ANI));
    await auth.refresh();
    await auth.signOut();
    await settle();

    expect(built.length).toBeGreaterThan(0);
    for (const options of built) {
      expect(options).toMatchObject({ url: FAKE_GOTRUE, flowType: 'pkce', detectSessionInUrl: false, autoRefreshToken: false, debug: false });
      expect(Object.keys(options).filter((key) => !GOOGLE_SDK_OPTIONS.includes(key))).toEqual([]);
      expect(typeof options.fetch).toBe('function');
      expect(options.storage).toBeDefined();
      expect([globalThis.localStorage, globalThis.sessionStorage]).not.toContain(options.storage);
      expect(options.storageKey).toEqual(expect.any(String));
      expect(options.storageKey).not.toBe('supabase.auth.token');
    }
    expect(new Set(built.map((options) => options.storageKey)).size).toBe(built.length);
    // Signed out: no client's storage keeps the session, its user, or any code verifier of the attempt.
    for (const { storage, storageKey = '' } of built) {
      for (const key of [storageKey, `${storageKey}-user`, `${storageKey}-code-verifier`, `${storageKey}-flows-code-verifier`, `${storageKey}-flow-${flowId}-code-verifier`]) {
        expect(await storage?.getItem(key)).toBeNull();
      }
    }
    expect(touched.filter((key) => !GOOGLE_PUBLIC_METHODS.includes(key))).toEqual([]);
  });
});
