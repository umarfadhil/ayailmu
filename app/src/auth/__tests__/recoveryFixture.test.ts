// The fixture control for password recovery: the maintained @supabase/auth-js AuthClient, used directly (never the app's
// adapter), over test/fakeRecoveryApi.ts, an in-memory Auth server for a disposable .test user. It shows the fixture
// speaks the SDK's PKCE recovery protocol: the request stores '<verifier>/recovery' in the client's own RAM storage and
// the mailbox gets the exact callback with one code; a fresh client given only that verifier exchanges the code once for
// that user's session; the same code never issues another session, and another code with the wrong verifier issues none;
// updateUser changes the password and a scope=local sign-out ends only that session, while a separate normal session
// stays usable; then the new password signs in and the old one is refused. Every client is owned and disposed, global
// fetch counts as egress, and nothing reaches a real service: fixture evidence only, never an app or provider claim.
import { AuthClient, type SupportedStorage } from '@supabase/auth-js';
import { webcrypto } from 'crypto';

import { FAKE_RECOVERY_AUTH, fakeRecoveryApi } from '../../../test/fakeRecoveryApi';

const CALLBACK = 'arabictrial://recover';
const ANI = 'ani.recovery@ayailmu.test';
const OLD_PASSWORD = 'pw-old-recovery-fixture-1';
const NEW_PASSWORD = 'pw-new-recovery-fixture-2';
const LINK = /^arabictrial:\/\/recover\?code=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

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

/** The one recovery flow a client's SDK keeps in its RAM: the flow ID its slot names, and the verifier in '<verifier>/recovery'. */
function flowOf(memory: Map<string, string>, storageKey: string) {
  const prefix = `${storageKey}-flow-`;
  const suffix = '-code-verifier';
  const slots = [...memory.keys()].filter((key) => key.startsWith(prefix) && key.endsWith(suffix));
  expect(slots).toHaveLength(1);
  const [verifier, kind, ...rest] = String(JSON.parse(memory.get(slots[0]) ?? '""')).split('/');
  expect({ kind, rest }).toEqual({ kind: 'recovery', rest: [] });
  expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
  return { flowId: slots[0].slice(prefix.length, -suffix.length), verifier };
}

/** The code in `mail`'s link, which must be addressed to `to` and be the exact callback with one code. */
function codeOf(mail: { to: string; callback: string } | undefined, to: string): string {
  expect(mail?.to).toBe(to);
  const match = LINK.exec(mail?.callback ?? '');
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

const receipt = ({ method, path, grant, scope }: { method: string; path: string; grant: string | null; scope: string | null }) =>
  `${method} ${path}${grant ? ` grant=${grant}` : ''}${scope ? ` scope=${scope}` : ''}`;

describe('password recovery fixture', () => {
  it('control: real SDK recovery fixture', async () => {
    const server = fakeRecoveryApi({ callbacks: [CALLBACK] });
    const { id } = server.seed(ANI, OLD_PASSWORD);
    const clients: InstanceType<typeof AuthClient>[] = [];
    /** A new owned client: PKCE over its own RAM storage (given `slots`, keyed under its storage key), through the fixture only. */
    const owned = (label: string, slots: (storageKey: string) => [string, string][] = () => []) => {
      const storageKey = `recovery-fixture-${label}-${clients.length + 1}`;
      const memory = new Map<string, string>(slots(storageKey));
      const storage: SupportedStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => void memory.set(key, value), removeItem: (key) => void memory.delete(key) };
      const sdk = new AuthClient({ url: FAKE_RECOVERY_AUTH, storageKey, flowType: 'pkce', persistSession: true, storage, detectSessionInUrl: false, autoRefreshToken: false, debug: false, fetch: server.fetch });
      clients.push(sdk);
      return { sdk, memory, storageKey };
    };
    /** A fresh client holding nothing but `verifier` in the slot the SDK reads for `flowId`. */
    const exchanger = (label: string, flowId: string, verifier: string) =>
      owned(label, (storageKey) => [[`${storageKey}-flow-${flowId}-code-verifier`, JSON.stringify(`${verifier}/recovery`)]]);
    try {
      // A separate normal session of the same user, which recovery must leave alone.
      const normal = owned('normal');
      expect((await normal.sdk.signInWithPassword({ email: ANI, password: OLD_PASSWORD })).error).toBeNull();
      expect(server.liveSessions(ANI)).toBe(1);

      // Two requests, each with its own flow, verifier and link.
      const requester = owned('request');
      expect(await requester.sdk.resetPasswordForEmail(ANI, { redirectTo: CALLBACK })).toEqual({ data: {}, error: null });
      const first = flowOf(requester.memory, requester.storageKey);
      const other = owned('other-request');
      expect(await other.sdk.resetPasswordForEmail(ANI, { redirectTo: CALLBACK })).toEqual({ data: {}, error: null });
      const second = flowOf(other.memory, other.storageKey);
      expect(server.mailbox).toHaveLength(2);
      const code = codeOf(server.mailbox[0], ANI);
      const otherCode = codeOf(server.mailbox[1], ANI);
      expect(otherCode).not.toBe(code);

      // The second link with the first request's verifier: refused, no session.
      const wrong = await exchanger('wrong-verifier', second.flowId, first.verifier).sdk.exchangeCodeForSession(otherCode, { flowId: second.flowId });
      expect(wrong.error).not.toBeNull();
      expect(wrong.data.session).toBeNull();
      expect(server.liveSessions(ANI)).toBe(1);

      // The first link on a fresh client given only its verifier: that user's session.
      const recovery = exchanger('exchange', first.flowId, first.verifier);
      const exchanged = await recovery.sdk.exchangeCodeForSession(code, { flowId: first.flowId });
      expect(exchanged.error).toBeNull();
      expect(exchanged.data.session?.user).toMatchObject({ id, email: ANI });
      expect(typeof exchanged.data.session?.access_token).toBe('string');
      expect(server.liveSessions(ANI)).toBe(2);

      // The same code again, on another fresh client with the right verifier: no second session.
      const replay = await exchanger('replay', first.flowId, first.verifier).sdk.exchangeCodeForSession(code, { flowId: first.flowId });
      expect(replay.error).not.toBeNull();
      expect(replay.data.session).toBeNull();
      expect(server.liveSessions(ANI)).toBe(2);

      // The new password through the recovery session, which then refreshes once and signs out on this device only.
      const updated = await recovery.sdk.updateUser({ password: NEW_PASSWORD });
      expect(updated.error).toBeNull();
      expect(updated.data.user).toMatchObject({ id, email: ANI });
      const refreshed = await recovery.sdk.refreshSession();
      expect(refreshed.error).toBeNull();
      expect(refreshed.data.session?.access_token).not.toBe(exchanged.data.session?.access_token);
      expect(server.liveSessions(ANI)).toBe(2);
      expect(await recovery.sdk.signOut({ scope: 'local' })).toEqual({ error: null });
      expect(server.liveSessions(ANI)).toBe(1);
      const stillNormal = await normal.sdk.getUser();
      expect(stillNormal.error).toBeNull();
      expect(stillNormal.data.user).toMatchObject({ id, email: ANI });

      // The new password signs in; the old one is refused.
      const fresh = await owned('new-password').sdk.signInWithPassword({ email: ANI, password: NEW_PASSWORD });
      expect(fresh.error).toBeNull();
      expect(fresh.data.user).toMatchObject({ id, email: ANI });
      const old = await owned('old-password').sdk.signInWithPassword({ email: ANI, password: OLD_PASSWORD });
      expect(old.error).toMatchObject({ status: 400, code: 'invalid_credentials' });
      expect(old.data.session).toBeNull();

      expect(server.calls.map(receipt)).toEqual([
        'POST /token grant=password',
        'POST /recover',
        'POST /recover',
        'POST /token grant=pkce',
        'POST /token grant=pkce',
        'POST /token grant=pkce',
        'PUT /user',
        'POST /token grant=refresh_token',
        'POST /logout scope=local',
        'GET /user',
        'POST /token grant=password',
        'POST /token grant=password',
      ]);
      const receipts = JSON.stringify(server.calls);
      for (const secret of [...server.secrets, first.verifier, second.verifier]) expect(receipts).not.toContain(secret);
    } finally {
      // Every client is let go: its session, if any, signed out on this device only, then disposed.
      for (const sdk of clients.reverse()) {
        try {
          await sdk.signOut({ scope: 'local' });
        } catch {
          // Let go either way.
        }
        try {
          await sdk.dispose();
        } catch {
          // Let go either way.
        }
      }
    }
    expect(server.liveSessions(ANI)).toBe(0);
    expect(server.calls.filter(({ path }) => path === '/logout').every(({ scope }) => scope === 'local')).toBe(true);
  });
});
