// Who owns a recovery session when things overlap (R1 in app/docs/plans/2026-10-20-session-recovery.md), pinned after
// review. A recovery exchange overtaken by cancel or a newer normal sign-in settles cancelled or superseded, adopts
// nothing, and has retired the session the server minted for it by the time it settles; the newer sign-in stays signed
// in and its own token is what authorized calls get. A password update whose cleanup is overtaken by a newer sign-in
// settles superseded, never a stale success (the password may already have changed; no rollback is claimed). While one
// update is on its way, another through the same recovery session is refused unsent. Past its lifetime, a recovery
// session is refused as expired before any password request and retired. The real SDK and adapter run over the frozen
// in-memory fixture test/fakeRecoveryApi.ts; this suite only holds one reply after the fixture has already applied the
// request. Mock-provider evidence only, never real mail, a real Auth server or a device.
import { AuthClient, type GoTrueClientOptions } from '@supabase/auth-js';
import { webcrypto } from 'crypto';

import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { PasswordRecovery, RecoveryAttemptRecord, RecoveryConfig, RecoverySdkClient } from '@/auth/recovery';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError } from '@/auth/types';
import { FAKE_RECOVERY_AUTH, fakeRecoveryApi, type FakeRecoveryApi } from '../../../test/fakeRecoveryApi';

const CALLBACK = 'arabictrial://recover';
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: FAKE_RECOVERY_AUTH };
const NATIVE: RecoveryConfig = { enabled: true, platform: 'native', callbackUrl: CALLBACK };
const ANI = 'ani.owner@ayailmu.test';
const BUDI = 'budi.owner@ayailmu.test';
const ANI_PASSWORD = 'pw-ani-owner-1';
const BUDI_PASSWORD = 'pw-budi-owner-2';
const NEW_PASSWORD = 'pw-ani-new-owner-3';
const PASSWORDS = [ANI_PASSWORD, BUDI_PASSWORD, NEW_PASSWORD];

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

const outcome = (promise: Promise<unknown>) => promise.then((value) => value, (error: unknown) => error);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function expectCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AuthError);
  expect(error).toMatchObject({ code, message: `Account sign-in problem: ${code}` });
  for (const password of PASSWORDS) expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(password);
}

/** Waits for a held reply's request to reach the fixture, never longer than 2 s. */
async function arrival(arrived: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([arrived, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('local test: the held request never arrived')), 2000)))]);
  } finally {
    clearTimeout(timer);
  }
}

type Match = (method: string, path: string, grant: string | null) => boolean;
const PKCE: Match = (method, path, grant) => method === 'POST' && path === '/token' && grant === 'pkce';
const LOGOUT: Match = (method, path) => method === 'POST' && path === '/logout';
const PUT_USER: Match = (method, path) => method === 'PUT' && path === '/user';

/** The fixture's fetch, able to hold the reply of the next matching request after the fixture has applied it. */
function gated(server: FakeRecoveryApi) {
  let next: { match: Match; arrive: () => void; released: Promise<void> } | null = null;
  const releases: (() => void)[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const reply = await server.fetch(input, init);
    const { pathname, searchParams } = new URL(String(input));
    const hold = next;
    if (hold?.match(init?.method ?? 'GET', pathname, searchParams.get('grant_type'))) {
      next = null;
      hold.arrive();
      await hold.released;
    }
    return reply;
  }) as typeof globalThis.fetch;
  return {
    fetch,
    hold(match: Match) {
      let arrive = () => undefined as void;
      let release = () => undefined as void;
      const arrived = new Promise<void>((resolve) => (arrive = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      next = { match, arrive: () => arrive(), released };
      releases.push(() => release());
      return { arrived, release: () => release() };
    },
    releaseAll: () => releases.forEach((release) => release()),
  };
}

interface Scene {
  server: FakeRecoveryApi;
  net: ReturnType<typeof gated>;
  auth: SupabaseAuth;
  recovery: PasswordRecovery;
  /** Starts tracking an operation: its outcome, settled before cleanup whatever happens. */
  track: (promise: Promise<unknown>) => Promise<unknown>;
  advance: (ms: number) => void;
}

async function scene(run: (s: Scene) => Promise<void>) {
  const server = fakeRecoveryApi({ callbacks: [CALLBACK] });
  server.seed(ANI, ANI_PASSWORD);
  server.seed(BUDI, BUDI_PASSWORD);
  const net = gated(server);
  let clock = Date.now();
  let held: RecoveryAttemptRecord | null = null;
  const store = {
    save: (record: RecoveryAttemptRecord) => {
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
  const built: RecoverySdkClient[] = [];
  const createClient = (options: GoTrueClientOptions): RecoverySdkClient => {
    const sdk = new AuthClient(options);
    built.push(sdk);
    return sdk;
  };
  const auth = createSupabaseAuth({ config: CONFIG, fetch: net.fetch, now: () => clock, recovery: { config: NATIVE, store, createClient } });
  const recovery = auth.recovery;
  if (!recovery) throw new Error('This adapter has no password-recovery surface (auth.recovery).');
  const outstanding: Promise<unknown>[] = [];
  const track = (promise: Promise<unknown>) => {
    const settled = outcome(promise);
    outstanding.push(settled);
    return settled;
  };
  try {
    await run({ server, net, auth, recovery, track, advance: (ms) => (clock += ms) });
  } finally {
    net.releaseAll();
    await Promise.all(outstanding);
    await recovery.cancel().catch(() => undefined);
    await auth.signOut().catch(() => undefined);
    for (let i = 0; i < 50 && server.liveSessions(ANI) + server.liveSessions(BUDI) > 0; i += 1) await tick();
    for (const sdk of built) await sdk.dispose().catch(() => undefined);
  }
  expect({ ani: server.liveSessions(ANI), budi: server.liveSessions(BUDI) }).toEqual({ ani: 0, budi: 0 });
  expect(server.calls.filter(({ path }) => path === '/logout').every(({ scope }) => scope === 'local')).toBe(true);
}

/** Request, then the mailed link: a recovery session for ANI, ready and held, nothing adopted. */
async function ready({ server, recovery, auth }: Scene) {
  expect(await recovery.request(ANI)).toEqual({ requested: true });
  expect(await recovery.resume(server.mailbox[server.mailbox.length - 1]?.callback ?? '')).toEqual({ ready: true });
  expect(server.liveSessions(ANI)).toBe(1);
  expect(auth.status()).toEqual({ state: 'signed-out' });
}

/** BUDI's newer normal sign-in, and proof that authorized calls carry BUDI's own token. */
async function budiSignsIn({ server, auth }: Scene) {
  expect(await auth.signIn(BUDI, BUDI_PASSWORD)).toMatchObject({ email: BUDI });
  const user = await auth.authorized(async (token, signal) => {
    const reply = await server.fetch(`${FAKE_RECOVERY_AUTH}/user`, { headers: { Authorization: `Bearer ${token}` }, signal });
    return (await reply.json()) as { email?: unknown };
  });
  expect(user.email).toBe(BUDI);
}

const puts = (server: FakeRecoveryApi) => server.calls.filter(({ method, path }) => method === 'PUT' && path === '/user').length;

describe('password recovery ownership', () => {
  it.each([
    ['cancel', 'cancelled'],
    ['a newer normal sign-in', 'superseded'],
  ])('an exchange overtaken by %s settles %s, adopts nothing and has retired its session', (how, code) =>
    scene(async (s) => {
      expect(await s.recovery.request(ANI)).toEqual({ requested: true });
      const gate = s.net.hold(PKCE);
      const late = s.track(s.recovery.resume(s.server.mailbox[0]?.callback ?? ''));
      await arrival(gate.arrived);
      expect(s.server.liveSessions(ANI)).toBe(1);
      if (how === 'cancel') await s.recovery.cancel();
      else await budiSignsIn(s);
      gate.release();
      expectCode(await late, code);
      expect(s.server.liveSessions(ANI)).toBe(0);
      if (how === 'cancel') expect(s.auth.status()).toEqual({ state: 'signed-out' });
      else {
        expect(s.auth.status()).toMatchObject({ state: 'signed-in', identity: { email: BUDI } });
        expect(s.server.liveSessions(BUDI)).toBe(1);
      }
    })
  );

  it('an update whose cleanup a newer sign-in overtakes settles superseded, never a stale success', () =>
    scene(async (s) => {
      await ready(s);
      const gate = s.net.hold(LOGOUT);
      const update = s.track(s.recovery.update(NEW_PASSWORD));
      await arrival(gate.arrived);
      expect(puts(s.server)).toBe(1);
      await budiSignsIn(s);
      gate.release();
      expectCode(await update, 'superseded');
      expect(s.server.liveSessions(ANI)).toBe(0);
      expect(s.auth.status()).toMatchObject({ state: 'signed-in', identity: { email: BUDI } });
      expect(s.server.liveSessions(BUDI)).toBe(1);
    }));

  it('refuses a second update while the first is on its way, sending no second password request', () =>
    scene(async (s) => {
      await ready(s);
      const gate = s.net.hold(PUT_USER);
      const first = s.track(s.recovery.update(NEW_PASSWORD));
      await arrival(gate.arrived);
      expectCode(await outcome(s.recovery.update('pw-ani-second-owner-4')), 'bad_callback');
      expect(puts(s.server)).toBe(1);
      gate.release();
      expect(await first).toEqual({ updated: true, revoked: true });
      expect(puts(s.server)).toBe(1);
      expect(s.server.liveSessions(ANI)).toBe(0);
      expect(s.auth.status()).toEqual({ state: 'signed-out' });
    }));

  it('refuses an update past the recovery session lifetime as expired, before any password request, and retires it', () =>
    scene(async (s) => {
      await ready(s);
      s.advance(61 * 60_000);
      expectCode(await outcome(s.recovery.update(NEW_PASSWORD)), 'expired');
      expect(puts(s.server)).toBe(0);
      expect(s.server.liveSessions(ANI)).toBe(0);
      expect(s.auth.status()).toEqual({ state: 'signed-out' });
    }));
});
