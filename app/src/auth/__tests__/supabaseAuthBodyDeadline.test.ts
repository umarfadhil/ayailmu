// The Auth transport's per-request deadline must also cover the reply body, written before the fix. The maintained SDK
// reads a reply's JSON body (a success or an error) only after the transport has handed it the reply, so a deadline that
// ends with the headers leaves a stalled body unbounded: a sign-in, a refresh or a logout outcome could stay pending for
// good. Here the real @supabase/auth-js AuthClient runs over an injected fetch whose replies come with their headers at
// once while their bodies wait (as a browser's or Node's fetch may), failing as fetch does once the request's signal
// aborts. Like React Native's replies, they offer their body through text() and json() only. Each request must settle by
// AUTH_REQUEST_TIMEOUT_MS as a lost connection would, its body aborted, and a late body installs nothing; healthy fast
// replies are the control. Time is Jest's fake clock. The SDK client sits behind a transparent proxy that notes every
// member reached for, so only its public methods may be used.
import { AuthClient, type GoTrueClientOptions } from '@supabase/auth-js';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { AUTH_REQUEST_TIMEOUT_MS, createSupabaseAuth, type SdkClient } from '@/auth/supabaseAuth';
import { AuthError, type AuthErrorCode } from '@/auth/types';

const T = Date.UTC(2026, 9, 19, 2, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' };
const ANI = { id: '0b5c2f2e-6a1d-4c39-9f0e-2f6c1a9d7e01', email: 'ani@ayailmu.test', password: 'pw-ani-local-1' };
const PASSWORD_GRANT = 'POST /token?grant_type=password';
const REFRESH_GRANT = 'POST /token?grant_type=refresh_token';
const LOCAL_LOGOUT = 'POST /logout?scope=local';
/** The SDK client's public methods the adapter may use, as its SdkClient type names them. */
const PUBLIC_METHODS = ['signInWithPassword', 'getSession', 'refreshSession', 'signOut', 'stopAutoRefresh'];

interface Plan {
  status: number;
  /** The body (JSON, or text as it is), made when the request arrives. */
  body: () => unknown;
  /** The body waits after the headers until released, or until the request is aborted. */
  stall?: boolean;
}

/** One request as the fake Auth server saw it. */
interface Exchange {
  key: string;
  /** When it arrived (Jest's clock). */
  startedAt: number;
  /** When its signal aborted, or null. */
  abortedAt: number | null;
  /** Its body was still outstanding when the request was aborted, so it was never delivered. */
  bodyAborted: boolean;
  /** Its body was available to read in full. */
  delivered: boolean;
}

const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/** The local Auth server behind the injected fetch: each request is answered by its plan; nothing else is reached. */
function stallingAuthServer() {
  const exchanges: Exchange[] = [];
  const plans = new Map<string, { plan: Plan; repeat: boolean }>();
  const secrets = new Set<string>([ANI.password]);
  const held: { release: () => void; fail: () => void }[] = [];
  let closed = false;
  let unplanned = 0;

  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (closed) return Promise.reject(new TypeError('Network request failed'));
    const url = String(input);
    const key = `${init?.method ?? 'GET'} ${url.slice(CONFIG.authUrl.length)}`;
    const entry = plans.get(key);
    if (!entry) {
      unplanned += 1;
      return Promise.reject(new TypeError('Network request failed'));
    }
    if (!entry.repeat) plans.delete(key);
    const signal = init?.signal ?? null;
    if (signal?.aborted) return Promise.reject(abortError());
    const value = entry.plan.body();
    if (value !== null && typeof value === 'object') {
      for (const field of ['access_token', 'refresh_token', 'msg']) {
        const secret = (value as Record<string, unknown>)[field];
        if (typeof secret === 'string' && secret !== '') secrets.add(secret);
      }
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const exchange: Exchange = { key, startedAt: Date.now(), abortedAt: null, bodyAborted: false, delivered: entry.plan.stall !== true };
    exchanges.push(exchange);
    let waiting: { resolve: (body: string) => void; reject: (error: unknown) => void } | null = null;
    signal?.addEventListener('abort', () => {
      exchange.abortedAt = Date.now();
      if (exchange.delivered) return;
      exchange.bodyAborted = true; // fetch fails a body read once its request is aborted
      waiting?.reject(abortError());
      waiting = null;
    });
    held.push({
      release: () => {
        if (exchange.abortedAt !== null || exchange.delivered) return;
        exchange.delivered = true;
        waiting?.resolve(text);
        waiting = null;
      },
      fail: () => {
        waiting?.reject(abortError());
        waiting = null;
      },
    });
    let used = false;
    const read = (): Promise<string> => {
      if (used) return Promise.reject(new TypeError('Body is unusable: it has already been read'));
      used = true;
      if (exchange.delivered) return Promise.resolve(text);
      if (exchange.abortedAt !== null || closed) return Promise.reject(abortError());
      return new Promise<string>((resolve, reject) => {
        waiting = { resolve, reject };
      });
    };
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' };
    // The headers arrive at once; the body only when read.
    return Promise.resolve({
      ok: entry.plan.status >= 200 && entry.plan.status < 300,
      status: entry.plan.status,
      statusText: '',
      url,
      redirected: false,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: read,
      json: () => read().then((body) => JSON.parse(body) as unknown),
    } as unknown as Response);
  };

  return {
    fetch,
    exchanges,
    /** The password, every token issued and every server message: none may show in an error. */
    get secrets(): string[] {
      return [...secrets];
    },
    get unplanned() {
      return unplanned;
    },
    /** Answers the next request for `key` (every one, with `repeat`) by `plan`, in place of any earlier plan. */
    answer(key: string, plan: Plan, { repeat = false }: { repeat?: boolean } = {}) {
      plans.set(key, { plan, repeat });
    },
    /** Delivers every body still held, late: after its request settled one way or another. */
    releaseAll() {
      for (const h of held) h.release();
    },
    /** The end of a test: every held body fails, and nothing more is answered. */
    close() {
      closed = true;
      for (const h of held) h.fail();
    },
  };
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
let grants = 0;
/** A GoTrue token reply for ANI, made at the request's time on Jest's clock. */
function tokenReply() {
  grants += 1;
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + HOUR / 1000;
  const claims = { sub: ANI.id, email: ANI.email, aud: 'authenticated', role: 'authenticated', exp, iat, session_id: 'f3a1c2d4-5b6e-4f70-8a91-b2c3d4e5f607' };
  return {
    access_token: `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url(claims)}.signature-${grants}`,
    token_type: 'bearer',
    expires_in: HOUR / 1000,
    expires_at: exp,
    refresh_token: `refresh-ani-${grants}`,
    user: {
      id: ANI.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: ANI.email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-10-18T00:00:00Z',
      is_anonymous: false,
    },
  };
}
const refusal = (status: number, errorCode: string, msg: string) => () => ({ code: status, error_code: errorCode, msg });

let server = stallingAuthServer();
/** Every member of an SDK client the adapter reached for. */
let touched: string[] = [];

/** The real SDK client behind a transparent proxy: its own methods run on the client itself, unobserved. */
function watched(client: InstanceType<typeof AuthClient>): SdkClient {
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
    deleteProperty(target, key) {
      touched.push(`delete ${String(key)}`);
      return Reflect.deleteProperty(target, key);
    },
  });
}

function setup() {
  return createSupabaseAuth({ config: CONFIG, fetch: server.fetch, createClient: (options: GoTrueClientOptions) => watched(new AuthClient(options)) });
}

/** Follows a promise without awaiting it: whether it settled, and how. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error })
  );
  return state;
}

/** Lets queued promise callbacks run; Jest's clock stays where it is. */
async function flush() {
  for (let i = 0; i < 10; i += 1) await jest.advanceTimersByTimeAsync(0);
}

/** Starts `run` now and gives its rejection; the test fails if it resolves. */
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

beforeEach(() => {
  jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'queueMicrotask'] });
  grants = 0;
  touched = [];
  server = stallingAuthServer();
});

afterEach(async () => {
  try {
    // Only the SDK's public methods were reached for, and no request went unplanned.
    expect(touched.filter((key) => !PUBLIC_METHODS.includes(key))).toEqual([]);
    expect(server.unplanned).toBe(0);
  } finally {
    // Held bodies fail and every pending timer runs out, so nothing outlives the test.
    server.close();
    await jest.runAllTimersAsync();
    jest.useRealTimers();
  }
});

describe('the Auth transport deadline covers the reply body', () => {
  it('control: healthy fast replies are read in full, nothing is aborted and no timer is left', async () => {
    const auth = setup();
    server.answer(PASSWORD_GRANT, { status: 200, body: tokenReply });
    await expect(auth.signIn(ANI.email, ANI.password)).resolves.toEqual({ uid: ANI.id, email: ANI.email, expiresAt: T + HOUR });

    jest.setSystemTime(T + 10 * MINUTE);
    server.answer(REFRESH_GRANT, { status: 200, body: tokenReply });
    await expect(auth.refresh()).resolves.toEqual({ uid: ANI.id, email: ANI.email, expiresAt: T + 10 * MINUTE + HOUR });

    server.answer(LOCAL_LOGOUT, { status: 204, body: () => '' });
    await expect(auth.signOut()).resolves.toEqual({ revoked: true });

    expect(server.exchanges.map((e) => [e.key, e.delivered, e.bodyAborted])).toEqual([
      [PASSWORD_GRANT, true, false],
      [REFRESH_GRANT, true, false],
      [LOCAL_LOGOUT, true, false],
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a sign-in whose success body stalls after the headers settles at the deadline as a lost connection: body aborted, no late session', async () => {
    const auth = setup();
    server.answer(PASSWORD_GRANT, { status: 200, body: tokenReply, stall: true });
    const signingIn = track(auth.signIn(ANI.email, ANI.password));
    await flush();
    expect(server.exchanges.map((e) => e.key)).toEqual([PASSWORD_GRANT]);

    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS - 1);
    expect(signingIn.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await flush();

    expect(signingIn.settled).toBe(true);
    expectAuthError(signingIn.error, 'network', server.secrets);
    expect(server.exchanges[0]).toMatchObject({ abortedAt: T + AUTH_REQUEST_TIMEOUT_MS, bodyAborted: true });
    expect(auth.status()).toEqual({ state: 'signed-out' });
    // The body arriving late signs no one in.
    server.releaseAll();
    await flush();
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expectAuthError(await failure(() => auth.authorized(async (token) => token)), 'signed_out');
  });

  it('a sign-in whose error body stalls after the headers settles at the deadline as a lost connection: nothing is guessed from the unread refusal', async () => {
    const auth = setup();
    const wrong = 'pw-wrong-never-read-7';
    server.answer(PASSWORD_GRANT, { status: 400, body: refusal(400, 'invalid_credentials', 'Invalid login credentials'), stall: true });
    const signingIn = track(auth.signIn(ANI.email, wrong));
    await flush();
    expect(server.exchanges.map((e) => e.key)).toEqual([PASSWORD_GRANT]);

    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS - 1);
    expect(signingIn.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await flush();

    expect(signingIn.settled).toBe(true);
    expectAuthError(signingIn.error, 'network', [wrong, ...server.secrets]);
    expect(server.exchanges[0]).toMatchObject({ abortedAt: T + AUTH_REQUEST_TIMEOUT_MS, bodyAborted: true });
    expect(auth.status()).toEqual({ state: 'signed-out' });
    server.releaseAll();
    await flush();
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it("a refresh whose success body stalls is aborted at each attempt's deadline and ends as a lost connection that keeps the session", async () => {
    const auth = setup();
    server.answer(PASSWORD_GRANT, { status: 200, body: tokenReply });
    await auth.signIn(ANI.email, ANI.password);
    const signedIn = auth.status();
    const token = await auth.authorized(async (t) => t);

    server.answer(REFRESH_GRANT, { status: 200, body: tokenReply, stall: true }, { repeat: true });
    const renewing = track(auth.refresh());
    // The SDK retries a lost connection within its own retry window; each attempt has its own deadline.
    for (let step = 0; step < 4 && !renewing.settled; step += 1) {
      await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS + 1_000);
      await flush();
    }

    expect(renewing.settled).toBe(true);
    expectAuthError(renewing.error, 'network', server.secrets);
    const attempts = server.exchanges.filter((e) => e.key === REFRESH_GRANT);
    expect(attempts.length).toBeGreaterThan(0);
    for (const attempt of attempts) {
      expect(attempt.bodyAborted).toBe(true);
      expect((attempt.abortedAt ?? Number.POSITIVE_INFINITY) - attempt.startedAt).toBe(AUTH_REQUEST_TIMEOUT_MS);
    }
    // A lost connection, not a refusal: the session, its number and its token stay, and late bodies change nothing.
    expect(auth.status()).toEqual(signedIn);
    server.releaseAll();
    await flush();
    expect(auth.status()).toEqual(signedIn);
    await expect(auth.authorized(async (t) => t)).resolves.toBe(token);
    // And it may retry later, once the SDK's own refresh-failure cooldown (one minute) is over: a healthy refresh renews
    // the same session.
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    server.answer(REFRESH_GRANT, { status: 200, body: tokenReply });
    await expect(auth.refresh()).resolves.toMatchObject({ uid: ANI.id, email: ANI.email });
    await expect(auth.authorized(async (t) => t)).resolves.not.toBe(token);
  });

  it('a logout whose error body stalls still cuts off at once, and reports an unconfirmed revocation by the deadline with the body aborted', async () => {
    const auth = setup();
    server.answer(PASSWORD_GRANT, { status: 200, body: tokenReply });
    await auth.signIn(ANI.email, ANI.password);

    server.answer(LOCAL_LOGOUT, { status: 403, body: refusal(403, 'forbidden', 'Refused by the provider'), stall: true });
    const leaving = track(auth.signOut());
    // At once, before any reply: signed out here, and no token for anything.
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expectAuthError(await failure(() => auth.authorized(async (token) => token)), 'signed_out');
    await flush();
    expect(server.exchanges.map((e) => e.key)).toEqual([PASSWORD_GRANT, LOCAL_LOGOUT]);
    const logout = server.exchanges[1];

    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS - 1);
    expect(leaving.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await flush();

    expect(leaving.settled).toBe(true);
    expect(leaving.value).toEqual({ revoked: false });
    expect(logout).toMatchObject({ abortedAt: logout.startedAt + AUTH_REQUEST_TIMEOUT_MS, bodyAborted: true });
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });
});
