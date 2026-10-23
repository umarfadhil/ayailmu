// Requesting a password recovery link (R1 in app/docs/plans/2026-10-20-session-recovery.md), written before the change:
// the request step only. auth.recovery.request(email) asks the Auth server, through the maintained SDK's
// resetPasswordForEmail on a dedicated recovery client (recovery.createClient), over the bounded transport, for a PKCE
// recovery link to the exact configured callback, with an S256 challenge. Its result is always the generic
// { requested: true }: it confirms the request was handled, never that mail was sent or that the address is registered.
// The recovery store then holds one fresh attempt of exactly seven keys (at most 2048 UTF-8 bytes), bound to this Auth
// origin, profile and time, holding that request's verifier and never an email, a password or a session token. For 60
// seconds after a request is sent, another request, for any address, sends nothing and gets the same result. A non-.test
// address is refused (not_synthetic), and a runtime without secure WebCrypto is refused (unavailable), before any client
// or request. The normal session is never touched. The only route served is POST /recover, in memory: every other
// request fails locally, global fetch counts as egress, and nothing is delivered anywhere.
import { AuthClient, type GoTrueClientOptions, type SupportedStorage } from '@supabase/auth-js';
import { createHash, webcrypto } from 'crypto';

import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { RecoveryAttemptRecord, RecoveryConfig, RecoverySdkClient } from '@/auth/recovery';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError } from '@/auth/types';

const AUTH = 'http://127.0.0.1:54321';
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: AUTH };
const CALLBACK = 'arabictrial://recover';
const NATIVE: RecoveryConfig = { enabled: true, platform: 'native', callbackUrl: CALLBACK };
const ANI = 'ani@ayailmu.test';
const UNKNOWN = 'nobody@ayailmu.test';
const T = Date.UTC(2026, 9, 21, 5, 0, 0);
const RECORD_KEYS = ['auth', 'callbackUrl', 'createdAt', 'flowId', 'profile', 'v', 'verifier'];
const SDK_OPTIONS = ['url', 'storageKey', 'flowType', 'persistSession', 'storage', 'detectSessionInUrl', 'autoRefreshToken', 'debug', 'fetch'];
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** auth.recovery.request, declared here only: the step this file is written before. */
interface RecoveryRequest {
  request(email: string): Promise<{ requested: true }>;
}

interface Sent { url: string; credentials?: RequestCredentials; redirect?: RequestRedirect; body: Record<string, unknown> }
/** The Auth server's POST /recover, in memory: every request it got, and the addresses a link would go to (never sent). */
function recoverServer(known: string[]) {
  const sent: Sent[] = [];
  const mailbox: string[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const { origin, pathname } = new URL(url);
    if (origin !== AUTH || pathname !== '/recover' || init?.method !== 'POST') throw new Error('local fake: only POST /recover is served');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ url, credentials: init.credentials, redirect: init.redirect, body });
    if (typeof body.email === 'string' && known.includes(body.email)) mailbox.push(body.email);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' };
    return { ok: true, status: 200, statusText: '', url, redirected: false, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, text: async () => '{}', json: async () => ({}) } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, sent, mailbox };
}
/** The request's redirect_to, when it is the only query parameter. */
const redirectOf = (url: string) => {
  const query = new URL(url).searchParams;
  return [...query.keys()].length === 1 ? query.get('redirect_to') : null;
};

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

function app(server: ReturnType<typeof recoverServer>, now: () => number) {
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
  return { auth, state, built };
}

/** auth.recovery.request, or a plain failure naming what is missing. */
function requestOf(auth: SupabaseAuth): RecoveryRequest {
  const recovery = auth.recovery as (NonNullable<SupabaseAuth['recovery']> & Partial<RecoveryRequest>) | undefined;
  if (!recovery) throw new Error('This adapter has no password-recovery surface (auth.recovery).');
  const request = recovery.request;
  if (typeof request !== 'function') throw new Error('This adapter has no password-recovery request (auth.recovery.request).');
  return { request: (email) => request.call(recovery, email) };
}

async function refusal(run: () => Promise<unknown>, code: string) {
  const error = await Promise.resolve().then(run).then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(AuthError);
  expect(error).toMatchObject({ code, message: `Account sign-in problem: ${code}` });
}

describe('password recovery request', () => {
  it('control: real SDK recovery request', async () => {
    const server = recoverServer([ANI]);
    const memory = new Map<string, string>();
    const storage: SupportedStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => void memory.set(key, value), removeItem: (key) => void memory.delete(key) };
    const storageKey = 'recovery-request-control';
    const client = new AuthClient({ url: AUTH, storageKey, flowType: 'pkce', persistSession: true, storage, detectSessionInUrl: false, autoRefreshToken: false, debug: false, fetch: server.fetch });
    try {
      expect(await client.resetPasswordForEmail(ANI, { redirectTo: CALLBACK })).toEqual({ data: {}, error: null });
      expect(server.sent).toHaveLength(1);
      const [{ url, body }] = server.sent;
      expect(redirectOf(url)).toBe(CALLBACK);
      expect(body).toMatchObject({ email: ANI, code_challenge_method: 's256' });
      const slots = [...memory.keys()].filter((key) => key.startsWith(`${storageKey}-flow-`) && key.endsWith('-code-verifier'));
      expect(slots).toHaveLength(1);
      expect(slots[0].slice(`${storageKey}-flow-`.length, -'-code-verifier'.length)).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
      const [verifier, kind, ...rest] = String(JSON.parse(memory.get(slots[0]) ?? '""')).split('/');
      expect({ kind, rest }).toEqual({ kind: 'recovery', rest: [] });
      expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
      expect(body.code_challenge).toBe(s256(verifier));
      expect(server.mailbox).toEqual([ANI]);
    } finally {
      await client.dispose();
    }
  });

  it('sends one S256 request through the bounded transport and keeps one bound, token-free attempt', async () => {
    const server = recoverServer([ANI]);
    const { auth, state, built } = app(server, () => T);
    expect(await requestOf(auth).request(ANI)).toEqual({ requested: true });
    expect(built).toHaveLength(1);
    expect(Object.keys(built[0]).every((key) => SDK_OPTIONS.includes(key))).toBe(true);
    expect(built[0]).toMatchObject({ url: AUTH, flowType: 'pkce', detectSessionInUrl: false, autoRefreshToken: false, debug: false });
    expect(server.sent).toHaveLength(1);
    const [{ url, credentials, redirect, body }] = server.sent;
    expect({ redirect_to: redirectOf(url), credentials, redirect }).toEqual({ redirect_to: CALLBACK, credentials: 'omit', redirect: 'error' });
    expect(body).toMatchObject({ email: ANI, code_challenge_method: 's256' });
    const record = state.held;
    expect(state.saves).toBe(1);
    expect(Object.keys(record ?? {}).sort()).toEqual(RECORD_KEYS);
    expect(record).toMatchObject({ v: 1, callbackUrl: CALLBACK, createdAt: T, auth: AUTH, profile: 'local' });
    expect(body.code_challenge).toBe(s256(String(record?.verifier)));
    expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBeLessThanOrEqual(2048);
    expect(JSON.stringify(record)).not.toContain(ANI);
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it('gives registered and unknown addresses the same result, and sends nothing more for 60 seconds', async () => {
    let at = T;
    const server = recoverServer([ANI]);
    const { auth, state } = app(server, () => at);
    const { request } = requestOf(auth);
    expect(await request(ANI)).toEqual({ requested: true });
    const first = state.held?.flowId;
    at = T + 59_000;
    expect(await request(UNKNOWN)).toEqual({ requested: true });
    expect(server.sent).toHaveLength(1);
    expect(state.held?.flowId).toBe(first);
    at = T + 61_000;
    expect(await request(UNKNOWN)).toEqual({ requested: true });
    expect(server.sent.map(({ url, body }) => [redirectOf(url), Object.keys(body).sort(), body.email])).toEqual([
      [CALLBACK, Object.keys(server.sent[0].body).sort(), ANI],
      [CALLBACK, Object.keys(server.sent[0].body).sort(), UNKNOWN],
    ]);
    expect(state.held?.flowId).not.toBe(first);
    expect(server.mailbox).toEqual([ANI]);
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it('refuses a non-.test address with not_synthetic before any client or request', async () => {
    const server = recoverServer([ANI]);
    const { auth, state, built } = app(server, () => T);
    const { request } = requestOf(auth);
    await refusal(() => request('ani@example.com'), 'not_synthetic');
    expect({ built: built.length, sent: server.sent.length, saves: state.saves }).toEqual({ built: 0, sent: 0, saves: 0 });
  });

  it('refuses with unavailable, before any client or request, when secure WebCrypto is missing', async () => {
    replaceGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const server = recoverServer([ANI]);
    const { auth, state, built } = app(server, () => T);
    const { request } = requestOf(auth);
    await refusal(() => request(ANI), 'unavailable');
    expect({ built: built.length, sent: server.sent.length, saves: state.saves }).toEqual({ built: 0, sent: 0, saves: 0 });
  });
});
