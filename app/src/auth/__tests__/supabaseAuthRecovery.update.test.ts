// Changing the password through a recovery link (R1 in app/docs/plans/2026-10-20-session-recovery.md), written before the
// change: the update step only. After request and resume, the adapter privately holds a recovery session in a dedicated
// SDK client; auth.recovery.update(password) asks the Auth server, through that client only, to change the password, then
// retires that client with a scope=local sign-out and resolves { updated: true, revoked }, where revoked says only
// whether the server accepted that one logout. Nothing is adopted: the normal session stays signed out until the learner
// signs in again. Without a ready recovery session, update is refused with bad_callback and sends nothing. A password the
// server refuses as weak is weak_password, with no server or password text, and the recovery session stays for a
// corrected try. The real SDK runs over the frozen in-memory fixture test/fakeRecoveryApi.ts: mock-provider evidence only,
// never real mail, a real Auth server or a device. Every client is owned and let go; global fetch counts as egress.
import { AuthClient, type GoTrueClientOptions } from '@supabase/auth-js';
import { webcrypto } from 'crypto';

import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { PasswordRecovery, RecoveryAttemptRecord, RecoveryConfig, RecoverySdkClient } from '@/auth/recovery';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError } from '@/auth/types';
import { FAKE_RECOVERY_AUTH, fakeRecoveryApi, type FakeRecoveryApi, type RecoveryCall } from '../../../test/fakeRecoveryApi';

const CALLBACK = 'arabictrial://recover';
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: FAKE_RECOVERY_AUTH };
const NATIVE: RecoveryConfig = { enabled: true, platform: 'native', callbackUrl: CALLBACK };
const ANI = 'ani.update@ayailmu.test';
const OLD_PASSWORD = 'pw-old-update-1';
const NEW_PASSWORD = 'pw-new-update-2';
/** Under the fixture server's six characters: it refuses this as weak_password. */
const WEAK_PASSWORD = 'weak5';

/** auth.recovery.update, declared here only: the step this file is written before. */
interface RecoveryUpdate {
  update(password: string): Promise<{ updated: true; revoked: boolean }>;
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

const receipt = ({ method, path, grant, scope }: RecoveryCall) => `${method} ${path}${grant ? ` grant=${grant}` : ''}${scope ? ` scope=${scope}` : ''}`;
const outcome = (promise: Promise<unknown>) => promise.then((value) => value, (error: unknown) => error);

function expectCode(error: unknown, code: string, hidden: string[] = []) {
  expect(error).toBeInstanceOf(AuthError);
  expect(error).toMatchObject({ code, message: `Account sign-in problem: ${code}` });
  const shown = `${String(error)} ${JSON.stringify(error)}`;
  for (const text of hidden) expect(shown).not.toContain(text);
}

function recoveryOf(auth: SupabaseAuth): PasswordRecovery {
  if (!auth.recovery) throw new Error('This adapter has no password-recovery surface (auth.recovery).');
  return auth.recovery;
}

/** auth.recovery.update, or a plain failure naming what is missing. */
function updateOf(recovery: PasswordRecovery): (password: string) => Promise<{ updated: true; revoked: boolean }> {
  const update = (recovery as PasswordRecovery & Partial<RecoveryUpdate>).update;
  if (typeof update !== 'function') throw new Error('This adapter has no password-recovery update (auth.recovery.update).');
  return (password) => update.call(recovery, password);
}

interface Scene {
  server: FakeRecoveryApi;
  id: string;
  auth: SupabaseAuth;
  recovery: PasswordRecovery;
  state: { held: RecoveryAttemptRecord | null; saves: number };
  built: RecoverySdkClient[];
}

/** A seeded fixture server and an adapter with recovery over it; everything is let go afterwards, and no session stays live. */
async function scene(run: (s: Scene) => Promise<void>) {
  const server = fakeRecoveryApi({ callbacks: [CALLBACK] });
  const { id } = server.seed(ANI, OLD_PASSWORD);
  const state = { held: null as RecoveryAttemptRecord | null, saves: 0 };
  const built: RecoverySdkClient[] = [];
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
    const sdk = new AuthClient(options);
    built.push(sdk);
    return sdk;
  };
  const auth = createSupabaseAuth({ config: CONFIG, fetch: server.fetch, recovery: { config: NATIVE, store, createClient } });
  const recovery = recoveryOf(auth);
  try {
    await run({ server, id, auth, recovery, state, built });
  } finally {
    await recovery.cancel().catch(() => undefined);
    await auth.signOut().catch(() => undefined);
    for (const sdk of built) await sdk.dispose().catch(() => undefined);
  }
  expect(server.liveSessions(ANI)).toBe(0);
}

/** Request, then resume the mailed link: a ready recovery session, the attempt consumed, nothing adopted. */
async function ready({ server, recovery, state, auth }: Scene) {
  expect(await recovery.request(ANI)).toEqual({ requested: true });
  expect(state.saves).toBe(1);
  const mail = server.mailbox[server.mailbox.length - 1];
  expect(mail?.to).toBe(ANI);
  expect(await recovery.resume(mail?.callback ?? '')).toEqual({ ready: true });
  expect(state.held).toBeNull();
  expect(server.liveSessions(ANI)).toBe(1);
  expect(auth.status()).toEqual({ state: 'signed-out' });
}

describe('password recovery update', () => {
  it('app control: a mailed link resumes into a held recovery session that is never adopted, and cancel ends only it', () =>
    scene(async (s) => {
      await ready(s);
      expectCode(await outcome(s.auth.authorized(async () => 'never called')), 'signed_out');
      await s.recovery.cancel();
      expect(s.server.liveSessions(ANI)).toBe(0);
      expect(s.auth.status()).toEqual({ state: 'signed-out' });
      expect(s.server.calls.map(receipt)).toEqual(['POST /recover', 'POST /token grant=pkce', 'POST /logout scope=local']);
    }));

  it('changes the password through the recovery session only, retires it locally, and adopts nothing', () =>
    scene(async (s) => {
      await ready(s);
      const update = updateOf(s.recovery);
      const result = await update(NEW_PASSWORD);
      expect(result).toEqual({ updated: true, revoked: true });
      expect(s.server.liveSessions(ANI)).toBe(0);
      expect(s.auth.status()).toEqual({ state: 'signed-out' });
      // Done: a second update is refused and sends nothing.
      const sent = s.server.calls.length;
      expectCode(await outcome(update('pw-another-update-3')), 'bad_callback', ['pw-another-update-3']);
      expect(s.server.calls).toHaveLength(sent);
      // Only an explicit sign-in signs in: the new password works, the old one no longer does.
      expectCode(await outcome(s.auth.signIn(ANI, OLD_PASSWORD)), 'invalid_credentials', [OLD_PASSWORD]);
      expect(await s.auth.signIn(ANI, NEW_PASSWORD)).toMatchObject({ uid: s.id, email: ANI });
      await s.auth.signOut();
      expect(s.server.calls.map(receipt)).toEqual([
        'POST /recover',
        'POST /token grant=pkce',
        'PUT /user',
        'POST /logout scope=local',
        'POST /token grant=password',
        'POST /token grant=password',
        'POST /logout scope=local',
      ]);
    }));

  it('refuses an update without a ready recovery session with bad_callback, sending nothing', () =>
    scene(async (s) => {
      const update = updateOf(s.recovery);
      expectCode(await outcome(update(NEW_PASSWORD)), 'bad_callback', [NEW_PASSWORD]);
      expect({ calls: s.server.calls.length, built: s.built.length }).toEqual({ calls: 0, built: 0 });
      expect(s.auth.status()).toEqual({ state: 'signed-out' });
    }));

  it('reports a password the server refuses as weak_password and keeps the recovery session for a corrected try', () =>
    scene(async (s) => {
      await ready(s);
      const update = updateOf(s.recovery);
      expectCode(await outcome(update(WEAK_PASSWORD)), 'weak_password', [WEAK_PASSWORD, 'Password should be', ...s.server.secrets]);
      expect(s.server.liveSessions(ANI)).toBe(1);
      expect(await update(NEW_PASSWORD)).toEqual({ updated: true, revoked: true });
      expect(s.server.liveSessions(ANI)).toBe(0);
      expect(s.auth.status()).toEqual({ state: 'signed-out' });
      expect(s.server.calls.map(receipt)).toEqual(['POST /recover', 'POST /token grant=pkce', 'PUT /user', 'PUT /user', 'POST /logout scope=local']);
    }));
});
