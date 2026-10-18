// Local account sign-in for the developer pilot, written before its implementation (frontend only): the pilot
// configuration, and the Firebase Auth emulator's public REST password flow with an in-memory session. The
// network is the injected fetch. Web storage, SQLite and the learner store are watched: no token, password or
// address may be stored, and guest data is never touched.
import { loadAccountConfig, type AccountEnv, type EnabledAccountConfig } from '@/account/config';
import { AuthError, createEmulatorAuth, EMULATOR_API_KEY, type AuthErrorCode } from '@/auth/emulatorAuth';

// Persistence boundaries that signing in must never open.
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

/** Replaces a global for one test; returns the undo. */
function replaceGlobal(name: 'fetch' | 'localStorage' | 'sessionStorage', value: unknown): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(globalThis, name, before);
    else Reflect.deleteProperty(globalThis, name);
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
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

/** A typed AuthError with a stable code, whose text shows none of `secrets`. */
function expectAuthError(error: unknown, code: AuthErrorCode, secrets: string[] = []) {
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).code).toBe(code);
  const shown = `${String(error)} ${JSON.stringify(error)}`;
  for (const secret of secrets) expect(shown).not.toContain(secret);
}

describe('local pilot account configuration', () => {
  const LOCAL: AccountEnv = {
    EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092',
    EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-ayailmu',
  };
  const ENV_KEYS = ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_AUTH_EMULATOR_URL', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'] as const;
  /** Sets (or, for undefined, removes) the build variables in process.env; returns their previous values. */
  function setProcessEnv(values: AccountEnv): AccountEnv {
    const previous: AccountEnv = {};
    for (const key of ENV_KEYS) {
      previous[key] = process.env[key];
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return previous;
  }

  let networkProbe = jest.fn();
  let restoreFetch: () => void = () => undefined;
  beforeEach(() => {
    networkProbe = jest.fn();
    restoreFetch = replaceGlobal('fetch', networkProbe);
  });
  afterEach(() => {
    restoreFetch();
    // Reading the configuration never contacts anything, whatever it holds.
    expect(networkProbe).not.toHaveBeenCalled();
  });

  it.each([
    { where: '127.0.0.1, with a trailing root slash', api: 'http://127.0.0.1:8092/', auth: 'http://127.0.0.1:9099/', host: '127.0.0.1' },
    { where: 'localhost', api: 'http://localhost:8092', auth: 'http://localhost:9099', host: 'localhost' },
  ])('accepts the pilot API and Auth emulator on $where, with a demo project', ({ api, auth, host }) => {
    expect(
      loadAccountConfig({ EXPO_PUBLIC_API_BASE_URL: api, EXPO_PUBLIC_AUTH_EMULATOR_URL: auth, EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-ayailmu' })
    ).toEqual({ enabled: true, apiBaseUrl: `http://${host}:8092`, authEmulatorUrl: `http://${host}:9099`, projectId: 'demo-ayailmu' });
  });

  const UNSAFE: { case: string; env: AccountEnv; setting: keyof AccountEnv; notShown?: string }[] = [
    { case: 'a missing API address', env: { EXPO_PUBLIC_API_BASE_URL: undefined }, setting: 'EXPO_PUBLIC_API_BASE_URL' },
    { case: 'an empty Auth emulator address', env: { EXPO_PUBLIC_AUTH_EMULATOR_URL: '' }, setting: 'EXPO_PUBLIC_AUTH_EMULATOR_URL' },
    { case: 'a missing project', env: { EXPO_PUBLIC_FIREBASE_PROJECT_ID: undefined }, setting: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID' },
    { case: 'an external API host', env: { EXPO_PUBLIC_API_BASE_URL: 'http://api.example.com:8092' }, setting: 'EXPO_PUBLIC_API_BASE_URL', notShown: 'example.com' },
    { case: 'a look-alike loopback host', env: { EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1.evil.test:8092' }, setting: 'EXPO_PUBLIC_API_BASE_URL', notShown: 'evil.test' },
    { case: 'a look-alike localhost', env: { EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://localhost.evil.test:9099' }, setting: 'EXPO_PUBLIC_AUTH_EMULATOR_URL', notShown: 'evil.test' },
    { case: 'user info hiding another host', env: { EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092@evil.test:8092' }, setting: 'EXPO_PUBLIC_API_BASE_URL', notShown: 'evil.test' },
    { case: 'credentials in the address', env: { EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://pilot:hunter2@127.0.0.1:9099' }, setting: 'EXPO_PUBLIC_AUTH_EMULATOR_URL', notShown: 'hunter2' },
    { case: 'a query', env: { EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092/?debug=1' }, setting: 'EXPO_PUBLIC_API_BASE_URL', notShown: 'debug=1' },
    { case: 'a fragment', env: { EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099/#emulator' }, setting: 'EXPO_PUBLIC_AUTH_EMULATOR_URL', notShown: '#emulator' },
    { case: 'a path', env: { EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092/v1' }, setting: 'EXPO_PUBLIC_API_BASE_URL', notShown: '/v1' },
    { case: 'another local port (the original preview)', env: { EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8085' }, setting: 'EXPO_PUBLIC_API_BASE_URL', notShown: ':8085' },
    { case: 'a scheme other than http', env: { EXPO_PUBLIC_AUTH_EMULATOR_URL: 'https://127.0.0.1:9099' }, setting: 'EXPO_PUBLIC_AUTH_EMULATOR_URL', notShown: 'https://127.0.0.1:9099' },
    { case: 'a production project', env: { EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'ayailmu-prod' }, setting: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', notShown: 'ayailmu-prod' },
    { case: 'a project that only looks like a demo', env: { EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'ayailmu-demo' }, setting: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', notShown: 'ayailmu-demo' },
  ];
  it.each(UNSAFE)('$case turns account sync off instead of failing; the reason names $setting, not its value', ({ env, setting, notShown }) => {
    const config = loadAccountConfig({ ...LOCAL, ...env });
    // Off, with no address left to call; guest learning does not depend on it.
    expect(config).toEqual({ enabled: false, reason: expect.any(String) });
    const reason = config.enabled ? '' : config.reason;
    expect(reason).toContain(setting);
    if (notShown) expect(reason).not.toContain(notShown);
  });

  it('reads the static EXPO_PUBLIC_* build variables by default', () => {
    const previous = setProcessEnv({ ...LOCAL, EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092/' });
    try {
      expect(loadAccountConfig()).toEqual({
        enabled: true,
        apiBaseUrl: 'http://127.0.0.1:8092',
        authEmulatorUrl: 'http://127.0.0.1:9099',
        projectId: 'demo-ayailmu',
      });
      setProcessEnv({ ...LOCAL, EXPO_PUBLIC_FIREBASE_PROJECT_ID: undefined });
      expect(loadAccountConfig()).toEqual({ enabled: false, reason: expect.stringContaining('EXPO_PUBLIC_FIREBASE_PROJECT_ID') });
    } finally {
      setProcessEnv(previous);
    }
  });
});

type Reply = { status: number; body: unknown } | 'offline';
interface FetchInit {
  method?: string;
  body?: unknown;
  credentials?: string;
  redirect?: string;
  signal?: { aborted: boolean; addEventListener(type: 'abort', listener: () => void): void } | null;
}
interface Sent {
  url: string;
  method?: string;
  credentials?: string;
  redirect?: string;
  body: Record<string, unknown>;
}

function httpResponse({ status, body }: { status: number; body: unknown }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const type = typeof body === 'string' ? 'text/html' : 'application/json; charset=UTF-8';
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}

/**
 * The Auth emulator behind the injected fetch: answers by endpoint and address («signUp ani@…»), records what
 * was actually sent, and rejects like fetch when the request is aborted.
 */
function emulator(routes: Record<string, Reply | Promise<Reply>>) {
  const sent: Sent[] = [];
  const calls = jest.fn((input: unknown, init: FetchInit = {}) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
    } catch {
      body = { unreadable: String(init.body) };
    }
    sent.push({ url, method: init.method, credentials: init.credentials, redirect: init.redirect, body });
    const route: Reply | Promise<Reply> | undefined = routes[`${/accounts:(\w+)/.exec(url)?.[1]} ${String(body.email)}`];
    return new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
      if (init.signal?.aborted) {
        abort();
        return;
      }
      init.signal?.addEventListener('abort', abort);
      Promise.resolve(route).then((reply) => {
        if (reply === undefined) reject(new Error('no such emulator route'));
        else if (reply === 'offline') reject(new TypeError('Network request failed'));
        else resolve(httpResponse(reply));
      });
    });
  });
  return { fetch: calls as unknown as typeof fetch, calls, sent };
}

/** A call that reports its token and signal when it starts, and settles when told. */
function heldCall() {
  const started = deferred<{ token: string; signal: AbortSignal }>();
  const result = deferred<string>();
  return {
    call: (token: string, signal: AbortSignal) => {
      started.resolve({ token, signal });
      return result.promise;
    },
    started: started.promise,
    finish: result.resolve,
  };
}

describe('local Auth emulator sign-in', () => {
  const T = Date.UTC(2026, 9, 18, 1, 0, 0);
  const HOUR = 3_600_000;
  const CONFIG: EnabledAccountConfig = {
    enabled: true,
    apiBaseUrl: 'http://127.0.0.1:8092',
    authEmulatorUrl: 'http://127.0.0.1:9099',
    projectId: 'demo-ayailmu',
  };
  const endpoint = (method: 'signInWithPassword' | 'signUp') =>
    `${CONFIG.authEmulatorUrl}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=${EMULATOR_API_KEY}`;
  const route = (method: 'signInWithPassword' | 'signUp', email: string) => `${method} ${email}`;

  const ANI = { uid: 'uid-ani', email: 'ani@ayailmu.test', password: 'pw-ani-local-1', token: 'id-token-ani', refresh: 'refresh-token-ani' };
  const BUDI = { uid: 'uid-budi', email: 'budi@ayailmu.test', password: 'pw-budi-local-2', token: 'id-token-budi', refresh: 'refresh-token-budi' };
  const CITRA = { uid: 'uid-citra', email: 'citra@ayailmu.test', password: 'pw-citra-local-3', token: 'id-token-citra', refresh: 'refresh-token-citra' };
  type User = typeof ANI;
  const signedIn = (u: User): Reply => ({
    status: 200,
    body: { kind: 'identitytoolkit#VerifyPasswordResponse', localId: u.uid, email: u.email, idToken: u.token, refreshToken: u.refresh, expiresIn: '3600', registered: true },
  });
  const signedUp = (u: User): Reply => ({
    status: 200,
    body: { kind: 'identitytoolkit#SignupNewUserResponse', localId: u.uid, email: u.email, idToken: `${u.token}-from-sign-up`, refreshToken: u.refresh, expiresIn: '3600' },
  });
  const refused = (message: string): Reply => ({
    status: 400,
    body: { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'invalid' }] } },
  });

  const fakeWebStorage = () => ({ length: 0, key: jest.fn(() => null), getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn() });
  let web = { local: fakeWebStorage(), session: fakeWebStorage() };
  let undo: (() => void)[] = [];
  beforeEach(() => {
    mockSqliteOpened.mockClear();
    mockLearnerStoreOpened.mockClear();
    web = { local: fakeWebStorage(), session: fakeWebStorage() };
    undo = [replaceGlobal('localStorage', web.local), replaceGlobal('sessionStorage', web.session)];
  });
  afterEach(() => undo.forEach((restore) => restore()));
  /** No token, password or address was stored, no local database or learner store was opened, nothing was erased. */
  function expectNothingStored() {
    for (const storage of [web.local, web.session]) {
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(storage.clear).not.toHaveBeenCalled();
    }
    expect(mockSqliteOpened).not.toHaveBeenCalled();
    expect(mockLearnerStoreOpened).not.toHaveBeenCalled();
  }

  it('signIn posts to the emulator REST password path without cookies or redirects; the token stays in memory', async () => {
    const net = emulator({ [route('signInWithPassword', ANI.email)]: signedIn(ANI) });
    const auth = createEmulatorAuth({ config: CONFIG, fetch: net.fetch, now: () => T });
    expect(auth.status()).toEqual({ state: 'signed-out' });

    const identity = await auth.signIn(ANI.email, ANI.password);

    expect(identity).toEqual({ uid: ANI.uid, email: ANI.email, expiresAt: T + HOUR });
    expect(auth.status()).toEqual({ state: 'signed-in', identity, session: expect.any(Number) });
    expect(net.sent).toEqual([
      {
        url: endpoint('signInWithPassword'),
        method: 'POST',
        credentials: 'omit',
        redirect: expect.stringMatching(/^(error|manual)$/),
        body: { email: ANI.email, password: ANI.password, returnSecureToken: true },
      },
    ]);
    // The token reaches authorized calls only: never the identity, the status, a URL or any storage.
    await expect(auth.authorized(async (token) => token)).resolves.toBe(ANI.token);
    const visible = JSON.stringify([identity, auth.status(), net.sent.map((s) => s.url)]);
    for (const secret of [ANI.token, ANI.refresh, ANI.password]) expect(visible).not.toContain(secret);
    expectNothingStored();
  });

  it('createSyntheticAccount registers a .test address with the emulator signUp, then signs in with the password', async () => {
    const net = emulator({ [route('signUp', BUDI.email)]: signedUp(BUDI), [route('signInWithPassword', BUDI.email)]: signedIn(BUDI) });
    const auth = createEmulatorAuth({ config: CONFIG, fetch: net.fetch, now: () => T });

    await expect(auth.createSyntheticAccount(BUDI.email, BUDI.password)).resolves.toEqual({ uid: BUDI.uid, email: BUDI.email, expiresAt: T + HOUR });

    // Only the emulator's public sign-up and password sign-in: no verification e-mail or other delivery.
    expect(net.sent.map((s) => s.url)).toEqual([endpoint('signUp'), endpoint('signInWithPassword')]);
    expect(net.sent[0].body).toMatchObject({ email: BUDI.email, password: BUDI.password });
    expect(net.sent[1].body).toEqual({ email: BUDI.email, password: BUDI.password, returnSecureToken: true });
    for (const request of net.sent) expect(request).toMatchObject({ method: 'POST', credentials: 'omit' });
    // The session runs on the password sign-in's token.
    await expect(auth.authorized(async (token) => token)).resolves.toBe(BUDI.token);
    expect(JSON.stringify(auth.status())).not.toContain(BUDI.token);
    expectNothingStored();
  });

  const SECRET = 'pw-never-shown-9';
  const FAILURES: {
    case: string;
    call: 'signIn' | 'createSyntheticAccount';
    email: string;
    reply?: Reply;
    code: AuthErrorCode;
    serverText?: string;
  }[] = [
    { case: 'a real-world address', call: 'signIn', email: 'ani@gmail.com', code: 'not_synthetic' },
    { case: 'a look-alike of a .test address', call: 'signIn', email: 'ani@ayailmu.test.example.com', code: 'not_synthetic' },
    { case: 'registering a real-world address', call: 'createSyntheticAccount', email: 'new.learner@gmail.com', code: 'not_synthetic' },
    { case: 'a wrong password', call: 'signIn', email: ANI.email, reply: refused('INVALID_LOGIN_CREDENTIALS'), code: 'invalid_credentials', serverText: 'INVALID_LOGIN_CREDENTIALS' },
    { case: 'an unknown address (older emulator wording)', call: 'signIn', email: ANI.email, reply: refused('EMAIL_NOT_FOUND'), code: 'invalid_credentials', serverText: 'EMAIL_NOT_FOUND' },
    { case: 'a reply without a token', call: 'signIn', email: ANI.email, reply: { status: 200, body: { localId: ANI.uid, email: ANI.email } }, code: 'bad_response' },
    { case: 'a reply that is not JSON', call: 'signIn', email: ANI.email, reply: { status: 200, body: '<html>proxy error page</html>' }, code: 'bad_response', serverText: 'proxy error' },
    { case: 'an unreachable emulator', call: 'signIn', email: ANI.email, reply: 'offline', code: 'network', serverText: 'Network request failed' },
    { case: 'an address that already exists', call: 'createSyntheticAccount', email: BUDI.email, reply: refused('EMAIL_EXISTS'), code: 'email_exists', serverText: 'EMAIL_EXISTS' },
    {
      case: 'a weak password',
      call: 'createSyntheticAccount',
      email: BUDI.email,
      reply: refused('WEAK_PASSWORD : Password should be at least 6 characters'),
      code: 'weak_password',
      serverText: 'at least 6 characters',
    },
  ];
  it.each(FAILURES)('$case gives the stable AuthError $code, never server text, the password or a token', async ({ call, email, reply, code, serverText }) => {
    const net = emulator(reply === undefined ? {} : { [route(call === 'signIn' ? 'signInWithPassword' : 'signUp', email)]: reply });
    const auth = createEmulatorAuth({ config: CONFIG, fetch: net.fetch, now: () => T });

    expectAuthError(await failure(() => auth[call](email, SECRET)), code, [SECRET, ...(serverText ? [serverText] : [])]);

    expect(auth.status()).toEqual({ state: 'signed-out' });
    // No production sign-in or registration: a non-.test address sends nothing; a refused sign-up is not followed by a sign-in.
    if (reply === undefined) expect(net.calls).not.toHaveBeenCalled();
    if (call === 'createSyntheticAccount') expect(net.sent.map((s) => s.url)).toEqual(reply === undefined ? [] : [endpoint('signUp')]);
    expectNothingStored();
  });

  it('an expired token needs a new sign-in: no refresh, calls refused without running, nothing stored, and the next app start is signed out', async () => {
    const clock = { now: T };
    const net = emulator({ [route('signInWithPassword', ANI.email)]: signedIn(ANI) });
    const auth = createEmulatorAuth({ config: CONFIG, fetch: net.fetch, now: () => clock.now });
    const identity = await auth.signIn(ANI.email, ANI.password);
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity });

    clock.now = T + HOUR + 1_000;
    expect(auth.status()).toEqual({ state: 'expired', identity });
    const learnerDataCall = jest.fn(async () => 'learner data');
    expectAuthError(await failure(() => auth.authorized(learnerDataCall)), 'expired', [ANI.token]);
    expect(learnerDataCall).not.toHaveBeenCalled();
    // No silent refresh through a token endpoint: the only request is still the one sign-in.
    expect(net.sent.map((s) => s.url)).toEqual([endpoint('signInWithPassword')]);

    // Signing in again starts a fresh session with a fresh expiry.
    await expect(auth.signIn(ANI.email, ANI.password)).resolves.toEqual({ ...identity, expiresAt: clock.now + HOUR });
    await expect(auth.authorized(async (token) => token)).resolves.toBe(ANI.token);

    // Nothing persisted: no storage writes, and a new instance (the next app start) is signed out without asking the network.
    expectNothingStored();
    const requests = net.sent.length;
    const nextStart = createEmulatorAuth({ config: CONFIG, fetch: net.fetch, now: () => clock.now });
    expect(nextStart.status()).toEqual({ state: 'signed-out' });
    expectAuthError(await failure(() => nextStart.authorized(learnerDataCall)), 'signed_out');
    expect(learnerDataCall).not.toHaveBeenCalled();
    expect(net.sent).toHaveLength(requests);
  });

  it('the latest session wins: a sign-in that settles after sign-out, or after a newer sign-in, is dropped', async () => {
    const lateCitra = deferred<Reply>();
    const lateAni = deferred<Reply>();
    const lateBudi = deferred<Reply>();
    const net = emulator({
      [route('signInWithPassword', CITRA.email)]: lateCitra.promise,
      [route('signInWithPassword', ANI.email)]: lateAni.promise,
      [route('signInWithPassword', BUDI.email)]: lateBudi.promise,
    });
    const auth = createEmulatorAuth({ config: CONFIG, fetch: net.fetch, now: () => T });

    // Signed out while the sign-in was on its way: its reply signs no one in.
    const abandoned = failure(() => auth.signIn(CITRA.email, CITRA.password));
    auth.signOut();
    lateCitra.resolve(signedIn(CITRA));
    expectAuthError(await abandoned, 'signed_out', [CITRA.token]);
    expect(auth.status()).toEqual({ state: 'signed-out' });

    // An older sign-in that settles after a newer one: the newer identity stays, with its own token.
    const older = failure(() => auth.signIn(ANI.email, ANI.password));
    const newer = auth.signIn(BUDI.email, BUDI.password);
    lateBudi.resolve(signedIn(BUDI));
    await expect(newer).resolves.toEqual({ uid: BUDI.uid, email: BUDI.email, expiresAt: T + HOUR });
    lateAni.resolve(signedIn(ANI));
    expectAuthError(await older, 'superseded', [ANI.token]);
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity: { uid: BUDI.uid, email: BUDI.email } });
    await expect(auth.authorized(async (token) => token)).resolves.toBe(BUDI.token);
    expectNothingStored();
  });

  it('signOut aborts running calls and drops their late results; a replaced session never returns results; an API 401 means expired', async () => {
    const net = emulator({ [route('signInWithPassword', ANI.email)]: signedIn(ANI), [route('signInWithPassword', BUDI.email)]: signedIn(BUDI) });
    const auth = createEmulatorAuth({ config: CONFIG, fetch: net.fetch, now: () => T });

    // Signed out while a call runs: the call is aborted, and its late result is never returned.
    await auth.signIn(ANI.email, ANI.password);
    const running = heldCall();
    const dropped = failure(() => auth.authorized(running.call));
    const started = await running.started;
    expect(started.token).toBe(ANI.token);
    auth.signOut();
    expect(started.signal.aborted).toBe(true);
    expect(auth.status()).toEqual({ state: 'signed-out' });
    running.finish('ani-saved-progress');
    expectAuthError(await dropped, 'signed_out', ['ani-saved-progress']);

    // A newer sign-in while an older session's call runs: that call's late result is not returned under the new identity.
    await auth.signIn(ANI.email, ANI.password);
    const stale = heldCall();
    const staleOutcome = failure(() => auth.authorized(stale.call));
    await stale.started;
    await auth.signIn(BUDI.email, BUDI.password);
    stale.finish('ani-saved-progress');
    expectAuthError(await staleOutcome, 'superseded', ['ani-saved-progress']);
    await expect(auth.authorized(async (token) => token)).resolves.toBe(BUDI.token);

    // The API answers 401: a typed «expired» (sign in again), not the raw failure.
    const unauthorized = Object.assign(new Error('HTTP 401: token rejected by the API'), { status: 401 });
    expectAuthError(
      await failure(() =>
        auth.authorized(async () => {
          throw unauthorized;
        })
      ),
      'expired',
      ['token rejected']
    );
    expect(auth.status()).toMatchObject({ state: 'expired', identity: { uid: BUDI.uid } });
    expectNothingStored();
  });
});
