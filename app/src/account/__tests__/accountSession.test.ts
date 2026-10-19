// The bridge from a signed-in Auth emulator session to the verified server account (GET /v1/me), written before
// its implementation. The real emulator sign-in and the API adapter share one injected transport, so a /v1/me
// reply can be held and delivered late: after a sign-out, or after a newer sign-in.
import type { EnabledAccountConfig } from '@/account/config';
import { accountNamespace } from '@/account/datasets';
import { createAccountSession } from '@/account/session';
import { createApiClient } from '@/api/client';
import { AuthError, createEmulatorAuth, type AuthErrorCode } from '@/auth/emulatorAuth';

const T = Date.UTC(2026, 9, 18, 2, 0, 0);
const CONFIG: EnabledAccountConfig = {
  enabled: true,
  apiBaseUrl: 'http://127.0.0.1:8092',
  authEmulatorUrl: 'http://127.0.0.1:9099',
  projectId: 'demo-ayailmu',
};
const ANI = { email: 'ani@ayailmu.test', password: 'pw-ani-local-1', uid: 'uid-ani', token: 'id-token-ani', accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01' };
const BUDI = { email: 'budi@ayailmu.test', password: 'pw-budi-local-2', uid: 'uid-budi', token: 'id-token-budi', accountId: '9b7d5e21-0c4f-4a8e-b1d3-2f6a8c0e4b12' };
const BUDI_PROFILE = 'c2e4a6b8-1d3f-4e5a-8b7c-9d0e1f2a3b4c';
const USERS = [ANI, BUDI];

interface FetchInit {
  method?: string;
  headers?: unknown;
  body?: unknown;
  credentials?: string;
  redirect?: string;
  signal?: unknown;
}

function reply(status: number, body: unknown, url: string) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    redirected: false,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  };
}

/** The request headers as lower-case name → value, whichever form fetch was given. */
function headerMap(headers: unknown): Record<string, string> {
  const pairs: [string, string][] = [];
  if (Array.isArray(headers)) pairs.push(...(headers as [string, string][]));
  else if (headers && typeof (headers as Headers).forEach === 'function') (headers as Headers).forEach((value, name) => pairs.push([name, value]));
  else if (headers) pairs.push(...Object.entries(headers as Record<string, string>));
  return Object.fromEntries(pairs.map(([name, value]) => [name.toLowerCase(), String(value)]));
}

/** The Auth emulator and the account API behind one injected fetch. /v1/me replies can be held and released later. */
function localStack() {
  const revoked = new Set<string>();
  const held: (() => void)[] = [];
  let holding = false;
  const calls = jest.fn((input: unknown, init: FetchInit = {}) => {
    const url = String(input);
    if (url.startsWith(`${CONFIG.authEmulatorUrl}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?`)) {
      const body = JSON.parse(String(init.body)) as { email?: string; password?: string };
      const user = USERS.find((u) => u.email === body.email && u.password === body.password);
      return Promise.resolve(
        user
          ? reply(200, { localId: user.uid, email: user.email, idToken: user.token, refreshToken: `refresh-${user.uid}`, expiresIn: '3600' }, url)
          : reply(400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }, url)
      );
    }
    if (url === `${CONFIG.apiBaseUrl}/v1/me`) {
      const bearer = headerMap(init.headers).authorization;
      const user = USERS.find((u) => bearer === `Bearer ${u.token}` && !revoked.has(u.token));
      const response = user
        ? reply(200, { account_id: user.accountId, profiles: user === BUDI ? [{ profile_id: BUDI_PROFILE, revision: 2, high_seq: 5 }] : [] }, url)
        : reply(401, { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'unauthenticated' }, url);
      if (!holding) return Promise.resolve(response);
      // Held: this reply arrives only when released, aborted or not, like a response already on the wire.
      return new Promise((resolve) => held.push(() => resolve(response)));
    }
    return Promise.reject(new TypeError('Network request failed'));
  });
  return {
    fetch: calls as unknown as typeof fetch,
    held,
    hold: (on: boolean) => {
      holding = on;
    },
    /** From now on the API answers 401 for this token. */
    revoke: (token: string) => void revoked.add(token),
  };
}

/** Lets queued work run until `ready` holds. */
async function until(ready: () => boolean) {
  for (let i = 0; i < 50 && !ready(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ready()).toBe(true);
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

function expectAuthError(error: unknown, code: AuthErrorCode) {
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).code).toBe(code);
}

describe('verified account session', () => {
  it('publishes only the current sign-in’s verified account: a late /v1/me after sign-out or a newer sign-in is dropped; the dataset is named by the verified account ID', async () => {
    const net = localStack();
    const auth = createEmulatorAuth({ config: CONFIG, fetch: net.fetch, now: () => T });
    const session = createAccountSession({ auth, api: createApiClient({ baseUrl: CONFIG.apiBaseUrl, fetch: net.fetch }) });
    expect(session.current()).toBeNull();

    // Signed out while /v1/me is on its way: the late reply publishes nothing.
    await auth.signIn(ANI.email, ANI.password);
    net.hold(true);
    const afterSignOut = failure(() => session.verify());
    await until(() => net.held.length === 1);
    auth.signOut();
    net.held.shift()!();
    expectAuthError(await afterSignOut, 'signed_out');
    expect(session.current()).toBeNull();

    // A newer sign-in while ANI's /v1/me is on its way: ANI's late account is never published for BUDI.
    await auth.signIn(ANI.email, ANI.password);
    const afterReplace = failure(() => session.verify());
    await until(() => net.held.length === 1);
    await auth.signIn(BUDI.email, BUDI.password);
    net.held.shift()!();
    expectAuthError(await afterReplace, 'superseded');
    expect(session.current()).toBeNull(); // BUDI is signed in, but not verified yet

    // BUDI's own verification publishes BUDI's account; its local dataset is the one named by that account ID.
    net.hold(false);
    const budi = await session.verify();
    expect(budi).toEqual({
      accountId: BUDI.accountId,
      uid: BUDI.uid,
      profiles: [{ profileId: BUDI_PROFILE, revision: 2, highSeq: 5 }],
      namespace: accountNamespace(BUDI.accountId),
    });
    expect(session.current()).toEqual(budi);
    // Never named after the address, the Auth uid or a local learner ID; nothing secret or from the earlier session is published.
    for (const notThere of [BUDI.email, BUDI.uid, 'lrn-']) expect(JSON.stringify(budi.namespace)).not.toContain(notThere);
    const published = JSON.stringify(session.current());
    for (const notThere of [BUDI.email, BUDI.token, ANI.accountId, ANI.uid]) expect(published).not.toContain(notThere);

    // Signing out unpublishes it; a new sign-in stays unverified until /v1/me answers for it.
    auth.signOut();
    expect(session.current()).toBeNull();
    await auth.signIn(BUDI.email, BUDI.password);
    expect(session.current()).toBeNull();
    await expect(session.verify()).resolves.toMatchObject({ accountId: BUDI.accountId });
    expect(session.current()).toMatchObject({ accountId: BUDI.accountId });

    // The API refusing the token (401) means sign in again: nothing stays published.
    net.revoke(BUDI.token);
    expectAuthError(await failure(() => session.verify()), 'expired');
    expect(session.current()).toBeNull();
    expect(auth.status()).toMatchObject({ state: 'expired', identity: { uid: BUDI.uid } });
  });
});
