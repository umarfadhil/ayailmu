// The recovery request's lifecycle, pinned after review (R1 in app/docs/plans/2026-10-20-session-recovery.md). A pending
// attempt ends with the sign-in state it was made in: a sign-out, or a newer password sign-in (before its grant is sent,
// refused or not), leaves no attempt behind. A newer request that is sent replaces the old attempt before it goes, so a
// refused one leaves none, with a fixed code that shows none of the provider's text. The 60-second cooldown starts when
// a request is sent, not when its reply arrives. Without usable secure entropy (getRandomValues present but throwing)
// nothing is built or sent. The real SDK runs over a local fake that serves only POST /recover (which can be held, or
// refused once) and a password grant that is always refused; every other route fails locally and global fetch is egress.
import { AuthClient, type GoTrueClientOptions } from '@supabase/auth-js';
import { webcrypto } from 'crypto';

import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { PasswordRecovery, RecoveryAttemptRecord, RecoveryConfig, RecoverySdkClient } from '@/auth/recovery';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError } from '@/auth/types';

const AUTH = 'http://127.0.0.1:54321';
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: AUTH };
const CALLBACK = 'arabictrial://recover';
const NATIVE: RecoveryConfig = { enabled: true, platform: 'native', callbackUrl: CALLBACK };
const ANI = 'ani@ayailmu.test';
const UNKNOWN = 'nobody@ayailmu.test';
const CODE = '5d3c1b2a-8f7e-4d6c-9b5a-4e3d2c1b0a9f';
const T = Date.UTC(2026, 9, 21, 6, 0, 0);
/** Test-only text in the provider's refusal: it must never show in an error. */
const MARKER = 'MARKER-provider-text-4c1d';
const RECOVER = 'POST /recover';
const GRANT = 'POST /token?grant_type=password';

type Step = { kind: 'hold'; arrive: () => void; gate: Promise<void> } | { kind: 'refuse' };
/** The Auth server, in memory: POST /recover (held or refused on demand) and a password grant it always refuses. */
function authServer() {
  const steps: Step[] = [];
  const server = {
    sent: [] as string[],
    /** Whether a recovery attempt was pending as each password grant arrived. */
    pendingAtGrant: [] as boolean[],
    pending: () => false,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const { origin, pathname, search } = new URL(url);
      const route = `${init?.method ?? 'GET'} ${pathname}${search}`;
      if (origin !== AUTH || (route !== GRANT && `${init?.method} ${pathname}` !== RECOVER)) throw new Error('local fake: route not served');
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' };
      const reply = (status: number, body: unknown) =>
        ({ ok: status < 300, status, statusText: '', url, redirected: false, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, text: async () => JSON.stringify(body), json: async () => body }) as unknown as Response;
      if (route === GRANT) {
        server.sent.push(GRANT);
        server.pendingAtGrant.push(server.pending());
        return reply(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      server.sent.push(RECOVER);
      const step = steps.shift();
      if (step?.kind === 'refuse') return reply(429, { code: 429, error_code: 'over_email_send_rate_limit', msg: `${MARKER} email rate limit exceeded` });
      if (step?.kind === 'hold') {
        step.arrive();
        await step.gate;
      }
      return reply(200, {});
    }) as typeof globalThis.fetch,
    /** The next /recover is received, then its reply waits until released. */
    holdNextRecover() {
      let arrive = () => undefined as void;
      let release = () => undefined as void;
      const arrived = new Promise<void>((resolve) => (arrive = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      steps.push({ kind: 'hold', arrive: () => arrive(), gate });
      return { arrived, release: () => release() };
    },
    refuseNextRecover: () => void steps.push({ kind: 'refuse' }),
  };
  return server;
}

const undo: (() => void)[] = [];
const egress: string[] = [];
function replaceGlobal(name: 'fetch' | 'crypto', value: unknown) {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  undo.push(() => (before ? Object.defineProperty(globalThis, name, before) : Reflect.deleteProperty(globalThis, name)));
}
beforeEach(() => {
  egress.length = 0;
  replaceGlobal('crypto', webcrypto);
  replaceGlobal('fetch', async (input: unknown) => {
    egress.push(String(input));
    throw new Error('local test: no global fetch');
  });
});
afterEach(() => {
  while (undo.length > 0) undo.pop()?.();
  expect(egress).toEqual([]);
});

/** An adapter with recovery over `server`, its own in-memory attempt store, and the recovery clients it asked for. */
function app(server: ReturnType<typeof authServer>, now: () => number) {
  const state = { held: null as RecoveryAttemptRecord | null, saves: 0 };
  const built: GoTrueClientOptions[] = [];
  const store = {
    save: (record: RecoveryAttemptRecord) => {
      state.saves += 1;
      state.held = { ...record };
    },
    take: () => {
      const record = state.held;
      state.held = null;
      return record;
    },
    clear: () => {
      state.held = null;
    },
  };
  const createClient = (options: GoTrueClientOptions): RecoverySdkClient => {
    built.push(options);
    return new AuthClient(options);
  };
  const auth = createSupabaseAuth({ config: CONFIG, fetch: server.fetch, now, recovery: { config: NATIVE, store, createClient } });
  server.pending = () => state.held !== null;
  return { auth, state, built, recovery: recoveryOf(auth) };
}

function recoveryOf(auth: SupabaseAuth): PasswordRecovery {
  if (!auth.recovery) throw new Error('This adapter has no password-recovery surface (auth.recovery).');
  return auth.recovery;
}

/** A promise's value or rejection, as a value. */
const outcome = (promise: Promise<unknown>) => promise.then((value) => value, (error: unknown) => error);

function expectCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AuthError);
  expect(error).toMatchObject({ code, message: `Account sign-in problem: ${code}` });
  expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(MARKER);
}

/** A first request that succeeded, as each case's setup: one send, one saved attempt. */
async function requested(recovery: PasswordRecovery, server: ReturnType<typeof authServer>, state: { held: unknown; saves: number }) {
  expect(await recovery.request(ANI)).toEqual({ requested: true });
  expect(server.sent).toEqual([RECOVER]);
  expect(state.saves).toBe(1);
  expect(state.held).not.toBeNull();
}

describe('password recovery request lifecycle', () => {
  it('a sign-out clears the pending attempt left by a finished request', async () => {
    const server = authServer();
    const { auth, state, recovery } = app(server, () => T);
    await requested(recovery, server, state);
    await auth.signOut();
    expect(state.held).toBeNull();
    expectCode(await outcome(recovery.resume(`${CALLBACK}?code=${CODE}`)), 'bad_callback');
  });

  it('a newer password sign-in clears the pending attempt before its grant is sent, even when refused', async () => {
    const server = authServer();
    const { auth, state, recovery } = app(server, () => T);
    await requested(recovery, server, state);
    expectCode(await outcome(auth.signIn(ANI, 'pw-wrong-hardening-1')), 'invalid_credentials');
    expect(server.sent).toEqual([RECOVER, GRANT]);
    expect(server.pendingAtGrant).toEqual([false]);
    expect(state.held).toBeNull();
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it('a second request while the first is still on its way sends nothing and gets the same result', async () => {
    let at = T;
    const server = authServer();
    const { auth, state, built, recovery } = app(server, () => at);
    const gate = server.holdNextRecover();
    const first = outcome(recovery.request(ANI));
    let second: unknown = null;
    let sentMeanwhile: string[] = [];
    let firstResult: unknown = null;
    try {
      await gate.arrived;
      at = T + 10_000;
      second = await outcome(recovery.request(UNKNOWN));
      sentMeanwhile = [...server.sent];
    } finally {
      gate.release();
      firstResult = await first;
    }
    expect(second).toEqual({ requested: true });
    expect(sentMeanwhile).toEqual([RECOVER]);
    expect(firstResult).toEqual({ requested: true });
    expect({ sent: server.sent, built: built.length, saves: state.saves }).toEqual({ sent: [RECOVER], built: 1, saves: 1 });
    expect(state.held).not.toBeNull();
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it('a newer request the provider refuses leaves no older attempt behind, with a fixed code', async () => {
    let at = T;
    const server = authServer();
    const { state, built, recovery } = app(server, () => at);
    await requested(recovery, server, state);
    at = T + 61_000;
    server.refuseNextRecover();
    expectCode(await outcome(recovery.request(ANI)), 'provider_refused');
    expect(server.sent).toEqual([RECOVER, RECOVER]);
    expect(state.held).toBeNull();
    const clients = built.length;
    expectCode(await outcome(recovery.resume(`${CALLBACK}?code=${CODE}`)), 'bad_callback');
    expect({ built: built.length, sent: server.sent.length }).toEqual({ built: clients, sent: 2 });
  });

  it('refuses with unavailable, before any client or request, when getRandomValues throws', async () => {
    replaceGlobal('crypto', {
      getRandomValues: () => {
        throw new Error('local test: entropy refused');
      },
      subtle: webcrypto.subtle,
    });
    const server = authServer();
    const { state, built, recovery } = app(server, () => T);
    expectCode(await outcome(recovery.request(ANI)), 'unavailable');
    expect({ built: built.length, sent: server.sent, saves: state.saves }).toEqual({ built: 0, sent: [], saves: 0 });
  });
});
