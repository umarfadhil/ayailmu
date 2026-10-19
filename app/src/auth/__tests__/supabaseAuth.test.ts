// Local Supabase Auth sign-in through the maintained SDK, written before its implementation (frontend only). The SDK is
// a faithful in-memory fake behind the injected client factory: each fake client keeps the SDK's own stored session and
// changes it only as the SDK's public methods do (a password sign-in saves its session before it returns; a refused
// refresh removes it and an unreachable one keeps it; a refresh is discarded when the session was removed meanwhile;
// getSession refreshes an expiring session; a sign-out removes it after its request, even when that request fails).
// Behind the clients, a fake Auth server issues opaque tokens. No protocol or JWT is rebuilt here and nothing reaches a
// network. Web storage, SQLite, the learner store and the console are watched: no token or password is stored or logged.
import {
  AuthApiError,
  AuthInvalidTokenResponseError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type AuthError as SdkError,
  type AuthResponse,
  type GoTrueClientOptions,
  type Session,
} from '@supabase/auth-js';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { ApiError } from '@/api/client';
import { AUTH_REQUEST_TIMEOUT_MS, createSupabaseAuth, type SdkClient } from '@/auth/supabaseAuth';
import { AuthError, type AuthErrorCode } from '@/auth/types';

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

/** Lets every pending reply and its follow-ups (a retired client's sign-out, say) run to the end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Lets queued promise callbacks run, also under fake timers. */
async function microtasks() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
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

/** A fetch reply as the platform gives it: from `url`, after a redirect it followed when `redirected`. */
const fetchReply = (url: string, redirected = false) =>
  ({ ok: true, status: 200, url, redirected, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' }) as unknown as Response;

const T = Date.UTC(2026, 9, 19, 1, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' };
/** The only SDK constructor options the adapter may set: no storage, no headers (so no API or admin key), no lock or flow. */
const SDK_OPTIONS = ['url', 'persistSession', 'detectSessionInUrl', 'autoRefreshToken', 'debug', 'fetch', 'storageKey'];

interface Account {
  id: string;
  email: string;
  password: string;
}
const ANI: Account = { id: '0b5c2f2e-6a1d-4c39-9f0e-2f6c1a9d7e01', email: 'ani@ayailmu.test', password: 'pw-ani-local-1' };
const BUDI: Account = { id: '1c6d3a3f-7b2e-4d4a-8a1f-3a7d2b0e8f12', email: 'budi@ayailmu.test', password: 'pw-budi-local-2' };
const CITRA: Account = { id: '2d7e4b40-8c3f-4e5b-9b20-4b8e3c1f9a23', email: 'citra@ayailmu.test', password: 'pw-citra-local-3' };

/** The session as if issued to another user: a reply the adapter must not adopt. */
const withUser = (session: Session, user: { id: string; email: string }): Session => ({ ...session, user: { ...session.user, id: user.id, email: user.email } });

type Grant = 'password' | 'refresh' | 'logout';
/** A server answer as a fake client receives it; unreachable when the request or its reply was lost. */
type Answer = 'unreachable' | { session: Session | null } | { refused: SdkError } | { done: true };
/** How the test changes the next request of one grant for one address. */
type Step = { kind: 'offline' } | { kind: 'hold'; reply: Promise<'delivered' | 'lost'> } | { kind: 'alter'; change: (session: Session) => Session | null };
interface ServerSession {
  account: Account;
  refreshToken: string;
  accessTokens: string[];
  live: boolean;
}

/**
 * The local Auth server behind the fake SDK: password and refresh grants (a refresh rotates the refresh token) and
 * logout by access token. A request is applied when it arrives; the test can take it offline (it never arrives), hold
 * its reply (applied now, answered when released, or lost), or alter the session in its reply.
 */
function fakeAuthServer(clock: { now: number }) {
  const accounts = new Map<string, Account>([ANI, BUDI, CITRA].map((account) => [account.email, account]));
  const sessions: ServerSession[] = [];
  const steps = new Map<string, Step[]>();
  const grants: string[] = [];
  const secrets = new Set([ANI.password, BUDI.password, CITRA.password]);
  let issued = 0;

  const issue = (session: ServerSession): Session => {
    issued += 1;
    const name = session.account.email.split('@')[0];
    const reply: Session = {
      access_token: `access-${name}-${issued}`,
      refresh_token: `refresh-${name}-${issued}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(clock.now / 1000) + 3600,
      user: {
        id: session.account.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: session.account.email,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: '2026-10-18T00:00:00Z',
        is_anonymous: false,
      },
    };
    session.refreshToken = reply.refresh_token;
    session.accessTokens.push(reply.access_token);
    secrets.add(reply.access_token).add(reply.refresh_token);
    return reply;
  };
  const queue = (grant: Grant, email: string, step: Step) => steps.set(`${grant} ${email}`, [...(steps.get(`${grant} ${email}`) ?? []), step]);

  async function answer(grant: Grant, email: string, label: string, apply: () => Answer): Promise<Answer> {
    grants.push(`${label} ${email}`);
    const step = steps.get(`${grant} ${email}`)?.shift();
    if (step?.kind === 'offline') return 'unreachable';
    let reply = apply();
    if (step?.kind === 'alter' && typeof reply === 'object' && 'session' in reply && reply.session) reply = { session: step.change(reply.session) };
    if (step?.kind === 'hold' && (await step.reply) === 'lost') return 'unreachable';
    return reply;
  }

  return {
    /** Each request as it reached the server, in order: «password ani@…», «refresh ani@…», «logout:local ani@…». */
    grants,
    /** Every password and every token issued so far. */
    get secrets(): string[] {
      return [...secrets];
    },
    password: (email: string, password: string) =>
      answer('password', email, 'password', () => {
        const account = accounts.get(email.toLowerCase());
        if (!account || account.password !== password) return { refused: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') };
        const session: ServerSession = { account, refreshToken: '', accessTokens: [], live: true };
        sessions.push(session);
        return { session: issue(session) };
      }),
    refresh: (email: string, refreshToken: string) =>
      answer('refresh', email, 'refresh', () => {
        const session = sessions.find((s) => s.live && s.refreshToken === refreshToken);
        return session ? { session: issue(session) } : { refused: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found') };
      }),
    logout: (email: string, accessToken: string, scope: string) =>
      answer('logout', email, `logout:${scope}`, () => {
        const session = sessions.find((s) => s.accessTokens.includes(accessToken));
        for (const s of sessions) if (session && (s === session || (scope === 'global' && s.account === session.account))) s.live = false;
        return { done: true };
      }),
    /** The next such request never reaches the server. */
    offline: (grant: Grant, email: string) => queue(grant, email, { kind: 'offline' }),
    /** The next such request is applied when it arrives; its reply waits until released, delivered or lost. */
    hold(grant: Grant, email: string) {
      const reply = deferred<'delivered' | 'lost'>();
      queue(grant, email, { kind: 'hold', reply: reply.promise });
      return { release: (how: 'delivered' | 'lost' = 'delivered') => reply.resolve(how) };
    },
    /** The next such reply carries a changed session (none, for null). */
    alter: (grant: Grant, email: string, change: (session: Session) => Session | null) => queue(grant, email, { kind: 'alter', change }),
    /** The account's sessions end at the server, as when it signs out elsewhere. */
    revokeAll(email: string) {
      for (const s of sessions) if (s.account.email === email) s.live = false;
    },
    /** The addresses whose sessions the server still accepts. */
    liveSessions: () => sessions.filter((s) => s.live).map((s) => s.account.email),
  };
}
type FakeServer = ReturnType<typeof fakeAuthServer>;

/** The SDK's expiry margin (EXPIRY_MARGIN_MS): getSession() refreshes a session that has expired or is about to. */
const SDK_EXPIRY_MARGIN_MS = 90_000;

/** A fake SDK client: the public methods the adapter may use, over the SDK's own stored session. */
interface FakeClient extends SdkClient {
  readonly options: GoTrueClientOptions;
  /** The SDK's own in-memory session (persistSession: false), as its public methods save and remove it. */
  stored: Session | null;
  /** The address its password sign-in was for. */
  email: string | null;
  /** Each sign-in, refresh and sign-out asked of it, in order; «signOut:local» names the scope. */
  readonly calls: string[];
}

const failed = (error: SdkError) => ({ data: { user: null, session: null }, error });
const unreachable = () => new AuthRetryableFetchError('Failed to fetch', 0);

function fakeSdk(clock: { now: number }) {
  const server = fakeAuthServer(clock);
  const clients: FakeClient[] = [];
  const createClient = jest.fn((options: GoTrueClientOptions): FakeClient => {
    /** Counts removals of the stored session: a refresh that began before one is discarded, as the SDK's commit guard does. */
    let removals = 0;
    const remove = () => {
      client.stored = null;
      removals += 1;
    };
    const refresh = async (): Promise<AuthResponse> => {
      const current = client.stored;
      if (!current) return failed(new AuthSessionMissingError());
      const began = removals;
      const reply = await server.refresh(current.user.email ?? '', current.refresh_token);
      if (reply === 'unreachable') return failed(unreachable()); // retryable: the session stays
      if ('refused' in reply) {
        remove(); // a refused refresh token ends the session
        return failed(reply.refused);
      }
      if (!('session' in reply) || !reply.session) return failed(new AuthInvalidTokenResponseError());
      if (removals !== began) return failed(new AuthRefreshDiscardedError()); // removed meanwhile: the rotated tokens are not saved
      client.stored = reply.session;
      return { data: { user: reply.session.user, session: reply.session }, error: null };
    };
    const client: FakeClient = {
      options,
      stored: null,
      email: null,
      calls: [],
      async signInWithPassword(credentials) {
        client.calls.push('signInWithPassword');
        client.email = 'email' in credentials ? credentials.email : null;
        const reply = await server.password(client.email ?? '', credentials.password);
        if (reply === 'unreachable') return failed(unreachable());
        if ('refused' in reply) return failed(reply.refused);
        if (!('session' in reply) || !reply.session) return failed(new AuthInvalidTokenResponseError());
        client.stored = reply.session; // saved before the SDK returns it
        return { data: { user: reply.session.user, session: reply.session }, error: null };
      },
      refreshSession() {
        client.calls.push('refreshSession');
        return refresh();
      },
      async getSession() {
        const current = client.stored;
        if (current && (current.expires_at ?? 0) * 1000 - clock.now < SDK_EXPIRY_MARGIN_MS) {
          const { data, error } = await refresh();
          if (error) return { data: { session: null }, error };
          return data.session ? { data: { session: data.session }, error: null } : { data: { session: null }, error: null };
        }
        return current ? { data: { session: current }, error: null } : { data: { session: null }, error: null };
      },
      async signOut(options) {
        const scope = options?.scope ?? 'global';
        client.calls.push(`signOut:${scope}`);
        const current = client.stored;
        const reply = current ? await server.logout(current.user.email ?? '', current.access_token, scope) : null;
        if (scope !== 'others') remove(); // after its request, even when that failed
        return { error: reply === 'unreachable' ? unreachable() : null };
      },
      async stopAutoRefresh() {
        // autoRefreshToken is off, so no background refresh ever started.
      },
    };
    clients.push(client);
    return client;
  });
  return { server, clients, createClient };
}
type FakeSdk = ReturnType<typeof fakeSdk>;

/** The SDK client of the nth password sign-in for `email`. */
function clientOf(sdk: FakeSdk, email: string, nth = 0): FakeClient {
  const client = sdk.clients.filter((c) => c.email === email)[nth];
  if (!client) throw new Error(`no SDK client signed in as ${email}`);
  return client;
}

/** Retired: its SDK session was removed through the SDK's own local sign-out, and nothing else was asked of it since `from`. */
function expectRetired(client: FakeClient, from = 1) {
  expect(client.stored).toBeNull();
  const since = client.calls.slice(from);
  expect(since).toContain('signOut:local');
  expect(since.filter((call) => call !== 'signOut:local')).toEqual([]);
}

describe('local Supabase Auth sign-in through the SDK', () => {
  const fakeWebStorage = () => ({ length: 0, key: jest.fn(() => null), getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn() });
  let web = { local: fakeWebStorage(), session: fakeWebStorage() };
  let networkProbe = jest.fn();
  let logs: jest.SpyInstance[] = [];
  let servers: FakeServer[] = [];
  let undo: (() => void)[] = [];
  beforeEach(() => {
    mockSqliteOpened.mockClear();
    mockLearnerStoreOpened.mockClear();
    web = { local: fakeWebStorage(), session: fakeWebStorage() };
    networkProbe = jest.fn();
    servers = [];
    undo = [replaceGlobal('fetch', networkProbe), replaceGlobal('localStorage', web.local), replaceGlobal('sessionStorage', web.session)];
    logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'info'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error'), jest.spyOn(console, 'debug')];
  });
  afterEach(() => {
    try {
      // No token or password was logged or stored, nothing left except through the SDK, and no database or learner store was opened.
      const logged = logs.flatMap((spy) => spy.mock.calls.flat().map(printed)).join('\n');
      for (const secret of servers.flatMap((server) => server.secrets)) expect(logged).not.toContain(secret);
      for (const storage of [web.local, web.session]) {
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.removeItem).not.toHaveBeenCalled();
        expect(storage.clear).not.toHaveBeenCalled();
      }
      expect(networkProbe).not.toHaveBeenCalled();
      expect(mockSqliteOpened).not.toHaveBeenCalled();
      expect(mockLearnerStoreOpened).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      logs.forEach((spy) => spy.mockRestore());
      undo.forEach((restore) => restore());
    }
  });

  function setup(options: { fetch?: typeof fetch } = {}) {
    const clock = { now: T };
    const sdk = fakeSdk(clock);
    servers.push(sdk.server);
    const auth = createSupabaseAuth({ config: CONFIG, createClient: sdk.createClient, fetch: options.fetch, now: () => clock.now });
    return { auth, sdk, clock };
  }

  it('builds one SDK client per password sign-in, in memory only: no URL detection, debug output, background refresh or API key', async () => {
    const { auth, sdk } = setup();
    expect(sdk.createClient).not.toHaveBeenCalled();
    await auth.signIn(ANI.email, ANI.password);
    await auth.signIn(BUDI.email, BUDI.password);

    expect(sdk.createClient).toHaveBeenCalledTimes(2);
    expect(clientOf(sdk, ANI.email)).not.toBe(clientOf(sdk, BUDI.email));
    for (const { options } of sdk.clients) {
      // The Auth root itself (no /auth/v1 prefix), and the SDK's own memory storage with nothing running in the background.
      expect(options).toMatchObject({ url: CONFIG.authUrl, persistSession: false, detectSessionInUrl: false, autoRefreshToken: false, debug: false });
      expect(Object.keys(options).filter((key) => !SDK_OPTIONS.includes(key))).toEqual([]);
    }
  });

  it('gives the SDK a transport bound to the Auth root: no cookies or redirects, other addresses and foreign replies refused, every request timed', async () => {
    const base = jest.fn((input: unknown, init?: RequestInit) => Promise.resolve(fetchReply(String(input))));
    const { auth, sdk } = setup({ fetch: base as unknown as typeof fetch });
    await auth.signIn(ANI.email, ANI.password);
    const transport = clientOf(sdk, ANI.email).options.fetch;
    if (!transport) throw new Error('the SDK client was given no transport');

    // A request for the Auth server goes out as it came, with no cookies, no redirects and an abort signal.
    const tokenUrl = `${CONFIG.authUrl}/token?grant_type=password`;
    const body = JSON.stringify({ email: ANI.email, password: ANI.password });
    await expect(transport(tokenUrl, { method: 'POST', body })).resolves.toMatchObject({ ok: true, url: tokenUrl });
    expect(base).toHaveBeenCalledTimes(1);
    const [sentUrl, sentInit] = base.mock.calls[0];
    expect(sentUrl).toBe(tokenUrl);
    expect(sentInit).toMatchObject({ method: 'POST', body, credentials: 'omit', redirect: 'error' });
    expect(sentInit?.signal).toBeInstanceOf(AbortSignal);

    // Any other address is refused before anything is sent: another host, a look-alike, the tokens' logical issuer, the API.
    for (const elsewhere of [
      'http://auth.evil.test:59838/token?grant_type=password',
      'http://127.0.0.1:59838.evil.test/token?grant_type=password',
      'https://auth.ayailmu-local.test/auth/v1/token?grant_type=password',
      `${CONFIG.apiBaseUrl}/v1/me`,
    ]) {
      await expect(transport(elsewhere, { method: 'POST', body })).rejects.toThrow();
    }
    expect(base).toHaveBeenCalledTimes(1);

    // A reply from elsewhere (a redirect the platform followed anyway) is refused.
    base.mockResolvedValueOnce(fetchReply('http://auth.evil.test/user', true));
    await expect(transport(`${CONFIG.authUrl}/user`, { method: 'GET' })).rejects.toThrow();
    base.mockResolvedValueOnce(fetchReply('http://auth.evil.test/user'));
    await expect(transport(`${CONFIG.authUrl}/user`, { method: 'GET' })).rejects.toThrow();

    // A request that never settles is aborted at the bound, and fails as a lost connection would.
    jest.useFakeTimers();
    const seen: { signal?: AbortSignal } = {};
    base.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          seen.signal = init?.signal ?? undefined;
          seen.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })));
        })
    );
    const hung = failure(() => transport(`${CONFIG.authUrl}/logout?scope=local`, { method: 'POST' }));
    await microtasks();
    jest.advanceTimersByTime(AUTH_REQUEST_TIMEOUT_MS - 1);
    expect(seen.signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(seen.signal?.aborted).toBe(true);
    expect(await hung).toBeInstanceOf(Error);
  });

  const SECRET = 'pw-never-shown-9';
  const REFUSALS: { case: string; email: string; password: string; script?: (server: FakeServer) => void; code: AuthErrorCode; serverText?: string }[] = [
    { case: 'a real-world address', email: 'ani@gmail.com', password: SECRET, code: 'not_synthetic' },
    { case: 'a look-alike of a .test address', email: 'ani@ayailmu.test.example.com', password: SECRET, code: 'not_synthetic' },
    { case: 'a wrong password', email: ANI.email, password: SECRET, code: 'invalid_credentials', serverText: 'Invalid login credentials' },
    {
      case: 'an unreachable Auth server',
      email: ANI.email,
      password: ANI.password,
      script: (server) => server.offline('password', ANI.email),
      code: 'network',
      serverText: 'Failed to fetch',
    },
    { case: 'a token reply without a session', email: ANI.email, password: ANI.password, script: (server) => server.alter('password', ANI.email, () => null), code: 'bad_response' },
    {
      case: 'a user ID that is not a canonical UUID',
      email: ANI.email,
      password: ANI.password,
      script: (server) => server.alter('password', ANI.email, (session) => withUser(session, { id: ANI.id.toUpperCase(), email: ANI.email })),
      code: 'bad_response',
    },
    {
      case: 'a reply for another account',
      email: ANI.email,
      password: ANI.password,
      script: (server) => server.alter('password', ANI.email, (session) => withUser(session, BUDI)),
      code: 'bad_response',
    },
  ];
  it.each(REFUSALS)('$case gives the stable AuthError $code, never server text, the password or a token, and leaves no SDK session', async ({ email, password, script, code, serverText }) => {
    const { auth, sdk } = setup();
    script?.(sdk.server);

    const error = await failure(() => auth.signIn(email, password));

    expectAuthError(error, code, [password, ...sdk.server.secrets, ...(serverText ? [serverText] : [])]);
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expectAuthError(await failure(() => auth.authorized(async (token) => token)), 'signed_out');
    await settle();
    if (code === 'not_synthetic') {
      // Not a synthetic address: no SDK client was built and nothing was sent.
      expect(sdk.createClient).not.toHaveBeenCalled();
      expect(sdk.server.grants).toEqual([]);
    } else {
      // One password grant was asked for; whatever came back, no SDK session is left behind.
      expect(sdk.server.grants.filter((grant) => grant.startsWith('password'))).toEqual([`password ${email}`]);
      for (const client of sdk.clients) expect(client.stored).toBeNull();
    }
  });

  it('a password sign-in gives the canonical identity and a session number; its access token reaches authorized calls only', async () => {
    const { auth, sdk } = setup();
    expect(auth.status()).toEqual({ state: 'signed-out' });

    const identity = await auth.signIn(ANI.email, ANI.password);

    expect(identity).toEqual({ uid: ANI.id, email: ANI.email, expiresAt: T + HOUR });
    expect(auth.status()).toEqual({ state: 'signed-in', identity, session: expect.any(Number) });
    // One password grant through one SDK client, whose own stored session is the one in use.
    const client = clientOf(sdk, ANI.email);
    expect(client.calls).toEqual(['signInWithPassword']);
    expect(sdk.server.grants).toEqual([`password ${ANI.email}`]);
    expect(client.stored?.user.id).toBe(ANI.id);
    await expect(auth.authorized(async (token, signal) => ({ token, aborted: signal.aborted }))).resolves.toEqual({
      token: client.stored?.access_token,
      aborted: false,
    });
    // Neither token nor the password shows in the identity or the status.
    const visible = JSON.stringify([identity, auth.status()]);
    for (const secret of sdk.server.secrets) expect(visible).not.toContain(secret);
  });

  it('an explicit refresh renews the token through the same SDK client, keeping the account and session number; an expired session recovers so', async () => {
    const { auth, sdk, clock } = setup();
    const identity = await auth.signIn(ANI.email, ANI.password);
    const signedIn = auth.status();
    const client = clientOf(sdk, ANI.email);
    const first = await auth.authorized(async (token) => token);
    // A call already running belongs to the same session before and after the refresh.
    const running = heldCall();
    const kept = auth.authorized(running.call);
    const { signal } = await running.started;

    clock.now = T + 10 * MINUTE;
    const renewed = await auth.refresh();

    expect(renewed).toEqual({ ...identity, expiresAt: clock.now + HOUR });
    expect(auth.status()).toEqual({ ...signedIn, identity: renewed });
    const second = await auth.authorized(async (token) => token);
    expect(second).toBe(client.stored?.access_token);
    expect(second).not.toBe(first);
    expect(signal.aborted).toBe(false);
    running.finish('ani-saved-progress');
    await expect(kept).resolves.toBe('ani-saved-progress');

    // Past its expiry: calls are refused without running; a refresh then recovers the same session.
    clock.now = T + 10 * MINUTE + HOUR + SECOND;
    expect(auth.status()).toEqual({ state: 'expired', identity: renewed });
    const learnerData = jest.fn(async () => 'learner data');
    expectAuthError(await failure(() => auth.authorized(learnerData)), 'expired', sdk.server.secrets);
    expect(learnerData).not.toHaveBeenCalled();
    const recovered = await auth.refresh();
    expect(recovered).toEqual({ ...identity, expiresAt: clock.now + HOUR });
    expect(auth.status()).toEqual({ ...signedIn, identity: recovered });
    await expect(auth.authorized(async (token) => token)).resolves.toBe(client.stored?.access_token);

    // Only the explicit refreshes, on the same client: no new client, and no new password grant (so no new password freshness).
    expect(client.calls).toEqual(['signInWithPassword', 'refreshSession', 'refreshSession']);
    expect(sdk.server.grants).toEqual([`password ${ANI.email}`, `refresh ${ANI.email}`, `refresh ${ANI.email}`]);
    expect(sdk.createClient).toHaveBeenCalledTimes(1);
  });

  it('a refresh that cannot reach the Auth server keeps a retryable session; a refused or mismatched refresh ends it', async () => {
    const { auth, sdk, clock } = setup();
    const identity = await auth.signIn(ANI.email, ANI.password);
    const signedIn = auth.status();
    const aniClient = clientOf(sdk, ANI.email);
    const token = await auth.authorized(async (t) => t);

    // Unreachable: a typed network error; the session, its number, its token and the SDK's session all stay.
    sdk.server.offline('refresh', ANI.email);
    expectAuthError(await failure(() => auth.refresh()), 'network', ['Failed to fetch', ...sdk.server.secrets]);
    expect(auth.status()).toEqual(signedIn);
    await expect(auth.authorized(async (t) => t)).resolves.toBe(token);
    // Expired and still unreachable: still retryable later.
    clock.now = T + HOUR + SECOND;
    sdk.server.offline('refresh', ANI.email);
    expectAuthError(await failure(() => auth.refresh()), 'network');
    expect(auth.status()).toEqual({ state: 'expired', identity });
    expect(aniClient.stored).not.toBeNull();

    // Revoked at the server (signed out elsewhere): the refresh is refused, and the session ends here too, closed.
    sdk.server.revokeAll(ANI.email);
    expectAuthError(await failure(() => auth.refresh()), 'expired', ['Refresh Token Not Found', ...sdk.server.secrets]);
    expect(auth.status()).toEqual({ state: 'signed-out' });
    const learnerData = jest.fn(async () => 'learner data');
    expectAuthError(await failure(() => auth.authorized(learnerData)), 'signed_out');
    expect(learnerData).not.toHaveBeenCalled();
    expectAuthError(await failure(() => auth.refresh()), 'signed_out');
    expect(aniClient.stored).toBeNull();

    // A refresh reply for another account is not adopted: the session ends, and its client keeps no SDK session.
    clock.now = T + 2 * HOUR;
    await auth.signIn(BUDI.email, BUDI.password);
    const budiClient = clientOf(sdk, BUDI.email);
    sdk.server.alter('refresh', BUDI.email, (session) => withUser(session, ANI));
    expectAuthError(await failure(() => auth.refresh()), 'bad_response', sdk.server.secrets);
    expect(auth.status()).toEqual({ state: 'signed-out' });
    await settle();
    expectRetired(budiClient, 2);

    // Recovery was never a hidden password sign-in: only the two the test made.
    expect(sdk.server.grants.filter((grant) => grant.startsWith('password'))).toEqual([`password ${ANI.email}`, `password ${BUDI.email}`]);
  });

  it('overlapping sign-ins: an older reply changes neither the identity nor the SDK session in use, and its client is retired', async () => {
    const { auth, sdk } = setup();
    // The older sign-in answers after the newer one has won.
    const lateAni = sdk.server.hold('password', ANI.email);
    const older = failure(() => auth.signIn(ANI.email, ANI.password));
    const budi = await auth.signIn(BUDI.email, BUDI.password);
    expect(budi).toEqual({ uid: BUDI.id, email: BUDI.email, expiresAt: T + HOUR });
    const budiClient = clientOf(sdk, BUDI.email);
    const budiSession = budiClient.stored;
    lateAni.release();
    expectAuthError(await older, 'superseded', sdk.server.secrets);
    await settle();
    expect(auth.status()).toEqual({ state: 'signed-in', identity: budi, session: expect.any(Number) });
    // The SDK session in use is still BUDI's own, untouched; ANI's late session went only to ANI's client, now retired.
    expect(budiClient.stored).toBe(budiSession);
    expect(budiSession?.user.id).toBe(BUDI.id);
    await expect(auth.authorized(async (token) => token)).resolves.toBe(budiSession?.access_token);
    expectRetired(clientOf(sdk, ANI.email));

    // The older sign-in answers first, while the newer one is still on its way: BUDI stays until the newer one succeeds.
    const lateAgain = sdk.server.hold('password', ANI.email);
    const lateCitra = sdk.server.hold('password', CITRA.email);
    const olderAgain = failure(() => auth.signIn(ANI.email, ANI.password));
    const newer = auth.signIn(CITRA.email, CITRA.password);
    lateAgain.release();
    expectAuthError(await olderAgain, 'superseded', sdk.server.secrets);
    expect(auth.status()).toEqual({ state: 'signed-in', identity: budi, session: expect.any(Number) });
    await expect(auth.authorized(async (token) => token)).resolves.toBe(budiSession?.access_token);
    lateCitra.release();
    await expect(newer).resolves.toEqual({ uid: CITRA.id, email: CITRA.email, expiresAt: T + HOUR });
    await settle();
    const citraClient = clientOf(sdk, CITRA.email);
    await expect(auth.authorized(async (token) => token)).resolves.toBe(citraClient.stored?.access_token);

    // Every client that lost or was replaced is retired; a refresh reaches the current client only.
    for (const client of [clientOf(sdk, ANI.email), clientOf(sdk, ANI.email, 1), budiClient]) expectRetired(client);
    await auth.refresh();
    expect(citraClient.calls).toEqual(['signInWithPassword', 'refreshSession']);
    expect(sdk.server.liveSessions()).toEqual([CITRA.email]);
  });

  it('a late refresh or sign-out reply of an earlier session can neither revive it nor overwrite the newer account', async () => {
    const { auth, sdk } = setup();
    await auth.signIn(ANI.email, ANI.password);
    const aniClient = clientOf(sdk, ANI.email);
    // ANI's refresh has been applied by the server, but its reply arrives only after BUDI has signed in.
    const lateRefresh = sdk.server.hold('refresh', ANI.email);
    const refreshing = failure(() => auth.refresh());
    const budi = await auth.signIn(BUDI.email, BUDI.password);
    const budiClient = clientOf(sdk, BUDI.email);
    const budiSession = budiClient.stored;
    lateRefresh.release();
    expectAuthError(await refreshing, 'superseded', sdk.server.secrets);
    await settle();
    expect(auth.status()).toEqual({ state: 'signed-in', identity: budi, session: expect.any(Number) });
    expect(budiClient.stored).toBe(budiSession);
    await expect(auth.authorized(async (token) => token)).resolves.toBe(budiSession?.access_token);
    // ANI's rotated tokens were never saved or used: its client is retired.
    expectRetired(aniClient, 2);

    // BUDI signs out; CITRA signs in while that revocation is on its way; then the revocation answers.
    const lateLogout = sdk.server.hold('logout', BUDI.email);
    const signingOut = auth.signOut();
    const citra = await auth.signIn(CITRA.email, CITRA.password);
    const citraClient = clientOf(sdk, CITRA.email);
    const citraSession = citraClient.stored;
    lateLogout.release();
    await expect(signingOut).resolves.toEqual({ revoked: true });
    await settle();
    expect(auth.status()).toEqual({ state: 'signed-in', identity: citra, session: expect.any(Number) });
    expect(citraClient.stored).toBe(citraSession);
    expect(citraClient.calls).toEqual(['signInWithPassword']);
    await expect(auth.authorized(async (token) => token)).resolves.toBe(citraSession?.access_token);
    expectRetired(budiClient);
  });

  it('signing out cuts off authorization at once, asks the SDK for a local sign-out, and reports an unconfirmed revocation honestly', async () => {
    const { auth, sdk } = setup();
    await auth.signIn(ANI.email, ANI.password);
    const aniClient = clientOf(sdk, ANI.email);
    const running = heldCall();
    const dropped = failure(() => auth.authorized(running.call));
    const started = await running.started;
    const revocation = sdk.server.hold('logout', ANI.email);

    const signingOut = auth.signOut();

    // At once, before the server answers: signed out, the running call aborted, and no token for anything new.
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(started.signal.aborted).toBe(true);
    const learnerData = jest.fn(async () => 'learner data');
    expectAuthError(await failure(() => auth.authorized(learnerData)), 'signed_out');
    expect(learnerData).not.toHaveBeenCalled();
    expectAuthError(await failure(() => auth.refresh()), 'signed_out');
    running.finish('ani-saved-progress');
    expectAuthError(await dropped, 'signed_out', ['ani-saved-progress']);
    // The SDK was asked to sign out this device only (its own default would be every device).
    expect(aniClient.calls).toEqual(['signInWithPassword', 'signOut:local']);
    expect(sdk.server.grants).toEqual([`password ${ANI.email}`, `logout:local ${ANI.email}`]);
    revocation.release();
    await expect(signingOut).resolves.toEqual({ revoked: true });
    expect(aniClient.stored).toBeNull();

    // The revocation cannot reach the server: reported as not revoked (the server still accepts that session), while
    // the session still ended here and the SDK still dropped its in-memory session.
    await auth.signIn(BUDI.email, BUDI.password);
    const budiClient = clientOf(sdk, BUDI.email);
    sdk.server.offline('logout', BUDI.email);
    await expect(auth.signOut()).resolves.toEqual({ revoked: false });
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expectRetired(budiClient);
    expect(sdk.server.liveSessions()).toEqual([BUDI.email]);

    // Signed out while a sign-in was on its way: its late reply signs no one in, and its client keeps no session.
    const lateCitra = sdk.server.hold('password', CITRA.email);
    const abandoned = failure(() => auth.signIn(CITRA.email, CITRA.password));
    const quiet = auth.signOut();
    lateCitra.release();
    expectAuthError(await abandoned, 'signed_out', sdk.server.secrets);
    await quiet;
    await settle();
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expectRetired(clientOf(sdk, CITRA.email));
  });

  it('an API step-up 401 keeps the session; a plain 401 ends its authorization; a replaced session drops its late results', async () => {
    const { auth, sdk } = setup();
    await auth.signIn(ANI.email, ANI.password);
    const signedIn = auth.status();
    const aniToken = clientOf(sdk, ANI.email).stored?.access_token;

    // Step-up: the API wants a recent password sign-in for this request. Nothing else changes, and nothing is retried
    // behind the learner's back (no refresh, and no password sign-in, which only the learner can give).
    const stepUp = jest.fn(async () => {
      throw new ApiError(401, 'reauthentication_required');
    });
    expectAuthError(await failure(() => auth.authorized(stepUp)), 'reauthentication_required', sdk.server.secrets);
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(auth.status()).toEqual(signedIn);
    await expect(auth.authorized(async (token) => token)).resolves.toBe(aniToken);
    expect(sdk.server.grants).toEqual([`password ${ANI.email}`]);

    // A newer sign-in replaces the session while one of its calls runs: aborted, and its late result dropped.
    const stale = heldCall();
    const staleOutcome = failure(() => auth.authorized(stale.call));
    const staleStarted = await stale.started;
    expect(staleStarted.token).toBe(aniToken);
    const budi = await auth.signIn(BUDI.email, BUDI.password);
    expect(staleStarted.signal.aborted).toBe(true);
    stale.finish('ani-saved-progress');
    expectAuthError(await staleOutcome, 'superseded', ['ani-saved-progress']);

    // A plain 401 (the API's uniform unauthenticated): this session's authorization ends; its identity shows as expired.
    expectAuthError(
      await failure(() =>
        auth.authorized(async () => {
          throw new ApiError(401, 'unauthenticated');
        })
      ),
      'expired',
      sdk.server.secrets
    );
    expect(auth.status()).toEqual({ state: 'expired', identity: budi });
    const learnerData = jest.fn(async () => 'learner data');
    expectAuthError(await failure(() => auth.authorized(learnerData)), 'expired');
    expect(learnerData).not.toHaveBeenCalled();
  });
});
