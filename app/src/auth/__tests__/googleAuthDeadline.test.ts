// The Auth transport's per-request deadline also bounds the Google PKCE exchange's reply body, written before the Google
// slice (phase 10). As for a password sign-in (supabaseAuthBodyDeadline.test.ts, unchanged), the maintained SDK reads
// the exchange's JSON body only after the transport has handed it the reply, so the deadline must cover the body too:
// an exchange whose body stalls must settle by AUTH_REQUEST_TIMEOUT_MS as a lost connection, its body aborted, with no
// session, no late session and no second use of its callback. Here the real @supabase/auth-js AuthClient runs over an
// injected fetch whose replies come with their headers at once while their bodies wait, failing as fetch does once the
// request's signal aborts; time is Jest's fake clock. Each Google SDK client sits behind a transparent proxy that notes
// every member reached for, so only its public methods may be used.
import { AuthClient, type GoTrueClientOptions } from '@supabase/auth-js';

import type { EnabledGoogleConfig } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { GoogleAttemptRecord, GoogleSdkClient, GoogleSignIn } from '@/auth/google';
import { AUTH_REQUEST_TIMEOUT_MS, createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError } from '@/auth/types';

const T = Date.UTC(2026, 9, 19, 6, 0, 0);
const HOUR = 3_600_000;
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' };
const NATIVE: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'native', callbackUrl: 'arabictrial://account' };
const G_ANI = { id: '8d3f3b60-4e5c-4f70-8b82-93c4d5e6f708', email: 'ani.learner@example.com' };
const CALLBACK = 'arabictrial://account?code=2b7e1516-28ae-4d2a-8f15-88093cf4f3c1';
const PKCE = 'POST /token?grant_type=pkce';
/** The Google SDK client's public methods the adapter may use, as its GoogleSdkClient type names them. */
const GOOGLE_PUBLIC_METHODS = ['signInWithOAuth', 'exchangeCodeForSession', 'refreshSession', 'signOut', 'stopAutoRefresh', 'dispose'];

interface Plan {
  status: number;
  body: () => unknown;
  /** The body waits after the headers until released, or until the request is aborted. */
  stall?: boolean;
}

interface Exchange {
  key: string;
  startedAt: number;
  abortedAt: number | null;
  bodyAborted: boolean;
  delivered: boolean;
}

const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

/** The local Auth server behind the injected fetch: each request is answered by its plan; nothing else is reached. */
function stallingAuthServer() {
  const exchanges: Exchange[] = [];
  const plans = new Map<string, Plan>();
  const held: { release: () => void; fail: () => void }[] = [];
  let closed = false;
  let unplanned = 0;

  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (closed) return Promise.reject(new TypeError('Network request failed'));
    const url = String(input);
    const key = `${init?.method ?? 'GET'} ${url.slice(CONFIG.authUrl.length)}`;
    const plan = plans.get(key);
    if (!plan) {
      unplanned += 1;
      return Promise.reject(new TypeError('Network request failed'));
    }
    plans.delete(key);
    const signal = init?.signal ?? null;
    if (signal?.aborted) return Promise.reject(abortError());
    const value = plan.body();
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const exchange: Exchange = { key, startedAt: Date.now(), abortedAt: null, bodyAborted: false, delivered: plan.stall !== true };
    exchanges.push(exchange);
    let waiting: { resolve: (body: string) => void; reject: (error: unknown) => void } | null = null;
    signal?.addEventListener('abort', () => {
      exchange.abortedAt = Date.now();
      if (exchange.delivered) return;
      exchange.bodyAborted = true;
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
    return Promise.resolve({
      ok: plan.status >= 200 && plan.status < 300,
      status: plan.status,
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
    get unplanned() {
      return unplanned;
    },
    answer(key: string, plan: Plan) {
      plans.set(key, plan);
    },
    /** Delivers every body still held, late: after its request settled one way or another. */
    releaseAll() {
      for (const h of held) h.release();
    },
    close() {
      closed = true;
      for (const h of held) h.fail();
    },
  };
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** GoTrue's reply to a completed PKCE exchange for a Google account, made at the request's time on Jest's clock. */
function googleTokenReply() {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + HOUR / 1000;
  const claims = { sub: G_ANI.id, email: G_ANI.email, aud: 'authenticated', role: 'authenticated', exp, iat, amr: [{ method: 'oauth', timestamp: iat }] };
  return {
    access_token: `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url(claims)}.signature-google`,
    token_type: 'bearer',
    expires_in: HOUR / 1000,
    expires_at: exp,
    refresh_token: 'refresh-google-ani-1',
    provider_token: 'ya29.fake-google-provider-token',
    user: {
      id: G_ANI.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: G_ANI.email,
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Ani Pelajar', email_verified: true },
      created_at: '2026-10-18T00:00:00Z',
      is_anonymous: false,
    },
  };
}
const refusal = (status: number, errorCode: string, msg: string) => () => ({ code: status, error_code: errorCode, msg });

/** Follows a promise without awaiting it: whether it settled, and how. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error })
  );
  return state;
}

/** Lets queued promise callbacks run (a fresh SDK client initializes before it exchanges); Jest's clock stays where it is. */
async function flush() {
  for (let i = 0; i < 20; i += 1) await jest.advanceTimersByTimeAsync(0);
}

function failure(run: () => Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve) => resolve(run())).then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );
}

function expectCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).code).toBe(code);
}

function googleOf(auth: SupabaseAuth): GoogleSignIn {
  expect(auth.google).toBeDefined();
  if (!auth.google) throw new Error('no Google sign-in was built');
  return auth.google;
}

let server = stallingAuthServer();
let touched: string[] = [];

function watched(client: InstanceType<typeof AuthClient>): GoogleSdkClient {
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

function setup() {
  let held: GoogleAttemptRecord | null = null;
  const store = {
    save: (record: GoogleAttemptRecord) => {
      held = { ...record };
    },
    take: () => {
      const record = held;
      held = null;
      return record;
    },
    clear: () => {
      held = null;
    },
  };
  return createSupabaseAuth({
    config: CONFIG,
    fetch: server.fetch,
    google: { config: NATIVE, store, createClient: (options: GoTrueClientOptions) => watched(new AuthClient(options)) },
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'queueMicrotask'] });
  touched = [];
  server = stallingAuthServer();
});

afterEach(async () => {
  try {
    expect(touched.filter((key) => !GOOGLE_PUBLIC_METHODS.includes(key))).toEqual([]);
    expect(server.unplanned).toBe(0);
  } finally {
    server.close();
    await jest.runAllTimersAsync();
    jest.useRealTimers();
  }
});

describe('the Auth transport deadline covers the Google exchange reply body', () => {
  it('control: a healthy exchange reply is read in full, nothing is aborted and no timer is left', async () => {
    const auth = setup();
    const attempt = await googleOf(auth).start();
    server.answer(PKCE, { status: 200, body: googleTokenReply });

    await expect(attempt.complete(CALLBACK)).resolves.toEqual({ uid: G_ANI.id, email: G_ANI.email, expiresAt: T + HOUR });

    expect(server.exchanges.map((e) => [e.key, e.delivered, e.bodyAborted])).toEqual([[PKCE, true, false]]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('an exchange whose success body stalls settles at the deadline as a lost connection: body aborted, no late session, and its callback cannot be used again', async () => {
    const auth = setup();
    const attempt = await googleOf(auth).start();
    server.answer(PKCE, { status: 200, body: googleTokenReply, stall: true });
    const completing = track(attempt.complete(CALLBACK));
    await flush();
    expect(server.exchanges.map((e) => e.key)).toEqual([PKCE]);

    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS - 1);
    expect(completing.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await flush();

    expect(completing.settled).toBe(true);
    expectCode(completing.error, 'network');
    expect(server.exchanges[0]).toMatchObject({ abortedAt: T + AUTH_REQUEST_TIMEOUT_MS, bodyAborted: true });
    expect(auth.status()).toEqual({ state: 'signed-out' });
    // The body arriving late signs no one in, and the used callback is not exchanged again.
    server.releaseAll();
    await flush();
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expectCode(await failure(() => attempt.complete(CALLBACK)), 'bad_callback');
    expect(server.exchanges).toHaveLength(1);
  });

  it('an exchange whose refusal body stalls settles at the deadline as a lost connection: nothing is guessed from the unread refusal', async () => {
    const auth = setup();
    const attempt = await googleOf(auth).start();
    server.answer(PKCE, { status: 400, body: refusal(400, 'bad_code_verifier', 'code challenge does not match previously saved code verifier'), stall: true });
    const completing = track(attempt.complete(CALLBACK));
    await flush();

    await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS - 1);
    expect(completing.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await flush();

    expect(completing.settled).toBe(true);
    expectCode(completing.error, 'network');
    expect(server.exchanges[0]).toMatchObject({ abortedAt: T + AUTH_REQUEST_TIMEOUT_MS, bodyAborted: true });
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });
});
