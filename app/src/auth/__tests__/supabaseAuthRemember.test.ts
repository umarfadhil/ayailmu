// Remembering a password sign-in on this device (D1 in app/docs/plans/2026-10-20-session-recovery.md), written before the
// change. With remember: { vault } the adapter offers auth.remembered. save(accountId) binds the current password
// session's refresh token, with this installation, the exact Auth origin, account API and profile, the provider user and
// the account the API verified, into one record in the secure vault (never an access token or a password). restore()
// presents it once, through a fresh SDK client, adopts the session only if the provider answers for that same user, and
// writes the rotated token back; release() lets go of this run's session without a logout. A record from another
// installation, origin, profile, version, kind or time is discarded without a request; an unreachable server keeps it; a
// refusal clears it. Signing out or signing in again clears it at once, and a late refresh or restore result is revoked,
// never adopted or written back. Without remember nothing changes. The real @supabase/auth-js SDK runs over the frozen
// fake GoTrue of test/fakeAccountApi.ts, behind this suite's own levers (hold a refresh grant, or lose its reply after the
// server rotated the token); the vault is an in-memory fake of the secure store. No keychain, credential or real server.
import type { EnabledGoogleConfig } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { GoogleAttemptRecord, GoogleSignIn } from '@/auth/google';
import { createSupabaseAuth, type SupabaseAuth, type SupabaseAuthOptions } from '@/auth/supabaseAuth';
import { AuthError, type AuthErrorCode, type AuthIdentity } from '@/auth/types';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';

jest.setTimeout(30_000);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** More than the SDK's retry window for a lost connection (30 s): how far one failed attempt moves the clock. */
const OUTAGE_STEP = 31_000;
/** This installation's identifier as the vault reports it: a non-secret marker, kept apart from the secure record. */
const INSTALLATION = 'install-7f3a9c2e5b1d';
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: FAKE_API, authUrl: FAKE_GOTRUE };
const NATIVE_GOOGLE: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'native', callbackUrl: 'arabictrial://account' };
const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-remember-1', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };
const BUDI: FakeUser = { email: 'budi@ayailmu.test', password: 'pw-budi-remember-2', uid: 'uid-budi', token: 'legacy-id-token-budi', accountId: '7c2e2a5f-3d4b-4e6f-9a71-82b3c4d5e6f7' };

/** The secure vault the adapter is given (remember: { vault }): one small record, read and written synchronously. */
interface SessionVaultPort {
  /** This installation's non-secret identifier, created once per installation and never kept in the secure store. */
  installation(): string;
  read(): string | null;
  /** Throws when the secure store refuses. */
  write(text: string): void;
  clear(): void;
}

/** auth.remembered: present only with remember: { vault }. */
interface RememberedPort {
  /** Binds the current password session to `accountId`, as the account API verified it; false when nothing was saved. */
  save(accountId: string): Promise<boolean>;
  /** Restores the remembered session through one refresh grant; null when there is nothing valid to restore. */
  restore(): Promise<{ identity: AuthIdentity; accountId: string } | null>;
  /** Lets go of this run's session without a logout, keeping the record for the next run. */
  release(): Promise<void>;
}
type RememberingAuth = SupabaseAuth & { remembered?: RememberedPort };

/** The one record the vault holds: never an access token or a password. */
interface RememberedRecord {
  v: number;
  kind: string;
  installation: string;
  auth: string;
  api: string;
  profile: string;
  uid: string;
  email: string;
  accountId: string;
  refreshToken: string;
  savedAt: string;
}

const realNow = Date.now;
let skew = 0;
/** Moves on the clock that the SDK, the adapter and the fake GoTrue all read (Date.now). */
const later = (ms: number) => {
  skew += ms;
};
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 50));
/** Waits for `promise`, never longer than 2 s, so missing behaviour fails an assertion instead of hanging. */
const within = (promise: Promise<void>) => Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);

/** An in-memory secure vault: its record text, and how often it was written and cleared. */
function memoryVault() {
  const state = { text: null as string | null, writes: 0, clears: 0 };
  const port: SessionVaultPort = {
    installation: () => INSTALLATION,
    read: () => state.text,
    write: (text: string) => {
      state.writes += 1;
      state.text = text;
    },
    clear: () => {
      state.clears += 1;
      state.text = null;
    },
  };
  const record = (): RememberedRecord | null => (state.text === null ? null : (JSON.parse(state.text) as RememberedRecord));
  return { port, state, record };
}

/** The fake servers' fetch with this suite's levers on refresh grants: hold the next one, or lose its reply after the server rotated the token. */
function levers(api: FakeAccountApi) {
  const refreshUrl = `${FAKE_GOTRUE}/token?grant_type=refresh_token`;
  let held: { arrived: () => void; gate: Promise<void> } | null = null;
  let loseReply = false;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === refreshUrl) {
      const hold = held;
      held = null;
      if (hold) {
        hold.arrived();
        await hold.gate;
      }
      if (loseReply) {
        loseReply = false;
        await api.fetch(input, init); // the server rotates the token...
        later(OUTAGE_STEP); // ...beyond the SDK's retry window...
        throw new TypeError('Network request failed'); // ...and its reply never arrives
      }
    }
    return api.fetch(input, init);
  }) as typeof globalThis.fetch;
  return {
    fetch,
    /** The next refresh grant waits until released; `arrived` settles once it has reached the server's door. */
    holdNextRefresh() {
      let arrived: () => void = () => undefined;
      let release: () => void = () => undefined;
      const reached = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      held = { arrived: () => arrived(), gate };
      return { arrived: reached, release: () => release() };
    },
    loseNextRefreshReply() {
      loseReply = true;
    },
  };
}

let fake: FakeAccountApi = fakeAccountApi([ANI, BUDI]);
let net = levers(fake);
let clock: jest.SpyInstance<number, []> | null = null;

function remembering(vault: SessionVaultPort | null, google?: SupabaseAuthOptions['google']): SupabaseAuth {
  const options = { config: CONFIG, fetch: net.fetch, ...(google ? { google } : {}), ...(vault ? { remember: { vault } } : {}) };
  return createSupabaseAuth(options as unknown as SupabaseAuthOptions);
}

/** auth.remembered, or a plain failure naming what is missing. */
function memory(auth: SupabaseAuth): RememberedPort {
  const remembered = (auth as RememberingAuth).remembered;
  if (!remembered) throw new Error('This adapter has no remembered-session surface (auth.remembered).');
  return remembered;
}

function googleOptions(): NonNullable<SupabaseAuthOptions['google']> {
  let held: GoogleAttemptRecord | null = null;
  return {
    config: NATIVE_GOOGLE,
    store: {
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
    },
  };
}

function googleOf(auth: SupabaseAuth): GoogleSignIn {
  if (!auth.google) throw new Error('no Google sign-in was built');
  return auth.google;
}

/** A session the fake GoTrue issues for `user`, as an earlier run of the app got it: its refresh token. */
async function mintRefreshToken(user: FakeUser): Promise<string> {
  const reply = await fake.fetch(`${FAKE_GOTRUE}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const body = (await reply.json()) as { refresh_token?: unknown };
  if (typeof body.refresh_token !== 'string') throw new Error('the fake GoTrue issued no refresh token');
  return body.refresh_token;
}

/** A record as a remembering build would have saved it for `user`, with `overrides`. */
function recordFor(user: FakeUser, refreshToken: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    kind: 'password',
    installation: INSTALLATION,
    auth: FAKE_GOTRUE,
    api: FAKE_API,
    profile: 'local',
    uid: providerUserId(user),
    email: user.email,
    accountId: user.accountId,
    refreshToken,
    savedAt: new Date(Date.now()).toISOString(),
    ...overrides,
  });
}

/** The refresh token the fake GoTrue issued last (each grant issues an access token, then a refresh token). */
const latestRefreshToken = () => fake.auth.issued().at(-1);
/** The Auth requests sent since `from`, as method and path with query. */
const grantsSince = (from: number) =>
  fake.wire
    .slice(from)
    .filter((r) => r.server === 'auth')
    .map((r) => `${r.method} ${r.path}?${r.query}`);

async function refreshGrantStatus(refreshToken: string): Promise<number> {
  const reply = await fake.fetch(`${FAKE_GOTRUE}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return reply.status;
}

/** What the account API says an access token signs in as. */
async function accountOfToken(token: string): Promise<{ status: number; accountId: unknown }> {
  const reply = await fake.fetch(`${FAKE_API}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  const body = reply.status === 200 ? ((await reply.json()) as { account_id?: unknown }) : null;
  return { status: reply.status, accountId: body?.account_id ?? null };
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

beforeEach(() => {
  skew = 0;
  clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  fake = fakeAccountApi([ANI, BUDI]);
  net = levers(fake);
});

afterEach(() => {
  clock?.mockRestore();
});

const DISCARDED: { case: string; overrides?: Record<string, unknown>; text?: string }[] = [
  { case: 'a record from before a reinstall (another installation)', overrides: { installation: 'install-from-an-earlier-install' } },
  { case: 'a record for another Auth origin', overrides: { auth: 'http://127.0.0.1:59999' } },
  { case: 'a record for another account API', overrides: { api: 'http://127.0.0.1:8093' } },
  { case: 'a record for another profile', overrides: { profile: 'staging' } },
  { case: 'a record saved more than 30 days ago', overrides: { savedAt: new Date(Date.now() - 31 * DAY).toISOString() } },
  { case: 'a record of another version', overrides: { v: 2 } },
  { case: 'a record of a Google session (never remembered)', overrides: { kind: 'google' } },
  { case: 'text that is not a record', text: 'not a record' },
];

describe('remembering a password sign-in on this device', () => {
  it('control: without remember there is no remembered surface, and signing in and out is exactly as before', async () => {
    const auth = remembering(null);
    expect((auth as RememberingAuth).remembered).toBeUndefined();
    await auth.signIn(ANI.email, ANI.password);
    expect(await auth.signOut()).toEqual({ revoked: true });
    expect(fake.auth.liveSessions(ANI.email)).toBe(0);
  });

  it('saves only the current password session, once its account is known, as exactly one safe record', async () => {
    const vault = memoryVault();
    const auth = remembering(vault.port);
    const remembered = memory(auth);
    expect(await remembered.save(ANI.accountId)).toBe(false); // no session yet
    await auth.signIn(ANI.email, ANI.password);
    expect(await remembered.save('not-an-account-id')).toBe(false);
    expect(vault.state.text).toBeNull();

    expect(await remembered.save(ANI.accountId)).toBe(true);
    const record = vault.record();
    expect(record).toEqual({
      v: 1,
      kind: 'password',
      installation: INSTALLATION,
      auth: FAKE_GOTRUE,
      api: FAKE_API,
      profile: 'local',
      uid: providerUserId(ANI),
      email: ANI.email,
      accountId: ANI.accountId,
      refreshToken: latestRefreshToken(),
      savedAt: expect.any(String),
    });
    expect(Math.abs(Date.parse(record?.savedAt ?? '') - Date.now())).toBeLessThan(MINUTE);
    // Never the access token or the password, and no token anywhere but the vault's record.
    const accessToken = await auth.authorized(async (token) => token);
    expect(vault.state.text).not.toContain(accessToken);
    expect(vault.state.text).not.toContain(ANI.password);
    const visible = JSON.stringify(auth.status());
    for (const secret of fake.auth.issued()) expect(visible).not.toContain(secret);
  });

  it('an explicit refresh rotates the remembered refresh token in place, keeping the first save time; the spent token is refused', async () => {
    const vault = memoryVault();
    const auth = remembering(vault.port);
    const remembered = memory(auth);
    await auth.signIn(ANI.email, ANI.password);
    expect(await remembered.save(ANI.accountId)).toBe(true);
    const first = vault.record();

    later(HOUR + MINUTE);
    await auth.refresh();

    const rotated = vault.record();
    expect(rotated?.refreshToken).toBe(latestRefreshToken());
    expect(rotated?.refreshToken).not.toBe(first?.refreshToken);
    expect({ ...rotated, refreshToken: null }).toEqual({ ...first, refreshToken: null });
    // A stale record could never restore: the server refuses the spent token.
    expect(await refreshGrantStatus(first?.refreshToken ?? '')).toBe(400);
  });

  it('a new run restores the remembered session with one refresh grant and no password, bound to its account; nothing remembered restores nothing', async () => {
    const empty = memoryVault();
    const nothing = memory(remembering(empty.port));
    const before = fake.wire.length;
    expect(await nothing.restore()).toBeNull();
    expect(fake.wire.slice(before)).toEqual([]);

    const vault = memoryVault();
    const minted = await mintRefreshToken(ANI);
    vault.state.text = recordFor(ANI, minted);
    const auth = remembering(vault.port);
    expect(auth.status()).toEqual({ state: 'signed-out' });
    const from = fake.wire.length;

    const restored = await memory(auth).restore();

    expect(restored).toEqual({ identity: { uid: providerUserId(ANI), email: ANI.email, expiresAt: expect.any(Number) }, accountId: ANI.accountId });
    expect(grantsSince(from)).toEqual(['POST /token?grant_type=refresh_token']);
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity: { uid: providerUserId(ANI), email: ANI.email } });
    expect(vault.record()?.refreshToken).toBe(latestRefreshToken());
    expect(vault.record()?.refreshToken).not.toBe(minted);
    const token = await auth.authorized(async (t) => t);
    expect(await accountOfToken(token)).toEqual({ status: 200, accountId: ANI.accountId });
  });

  it.each(DISCARDED)('$case is discarded without any request, and the vault is cleared', async ({ overrides, text }) => {
    const vault = memoryVault();
    const auth = remembering(vault.port);
    const remembered = memory(auth);
    vault.state.text = text ?? recordFor(ANI, await mintRefreshToken(ANI), overrides);
    const from = fake.wire.length;

    expect(await remembered.restore()).toBeNull();

    expect(fake.wire.slice(from)).toEqual([]);
    expect(vault.state.text).toBeNull();
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it('an outage keeps the record; a reply lost after the server rotated the token never counts as restored; the spent token is then refused and the record cleared', async () => {
    const vault = memoryVault();
    const auth = remembering(vault.port);
    const remembered = memory(auth);
    vault.state.text = recordFor(ANI, await mintRefreshToken(ANI));
    const kept = vault.state.text;

    // Unreachable: nothing is adopted, and the record stays for a later run.
    fake.auth.setOffline(true, () => later(OUTAGE_STEP));
    expectAuthError(await failure(() => remembered.restore()), 'network', fake.auth.issued());
    expect(vault.state.text).toBe(kept);
    expect(auth.status()).toEqual({ state: 'signed-out' });
    fake.auth.setOffline(false);

    // The server rotates the token but its reply is lost: still not restored, and the record is not rewritten.
    net.loseNextRefreshReply();
    expectAuthError(await failure(() => remembered.restore()), 'network', fake.auth.issued());
    expect(vault.state.text).toBe(kept);
    expect(auth.status()).toEqual({ state: 'signed-out' });

    // The next try presents the spent token: refused, so the record is cleared and nothing is adopted or sent to the API.
    later(2 * MINUTE);
    const from = fake.wire.length;
    expectAuthError(await failure(() => remembered.restore()), 'expired', fake.auth.issued());
    expect(vault.state.text).toBeNull();
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(fake.wire.slice(from).filter((r) => r.server === 'api')).toEqual([]);
  });

  it('signing out while a restore or a refresh waits clears the record at once; the late result is revoked, never adopted or written back', async () => {
    // A restore on its way.
    const vault = memoryVault();
    const auth = remembering(vault.port);
    const remembered = memory(auth);
    vault.state.text = recordFor(ANI, await mintRefreshToken(ANI));
    const held = net.holdNextRefresh();
    const restoring = failure(() => remembered.restore());
    await within(held.arrived);
    const leaving = auth.signOut();
    expect(vault.state.text).toBeNull();
    held.release();
    expectAuthError(await restoring, 'signed_out', fake.auth.issued());
    await leaving;
    await settle();
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(vault.state.text).toBeNull();
    expect(fake.auth.liveSessions(ANI.email)).toBe(0);

    // A refresh of a remembered session on its way (the SDK's own logout waits behind it, so it is not awaited first).
    const vault2 = memoryVault();
    const auth2 = remembering(vault2.port);
    await auth2.signIn(BUDI.email, BUDI.password);
    expect(await memory(auth2).save(BUDI.accountId)).toBe(true);
    later(HOUR + MINUTE);
    const held2 = net.holdNextRefresh();
    const renewing = failure(() => auth2.refresh());
    await within(held2.arrived);
    const leaving2 = auth2.signOut();
    expect(vault2.state.text).toBeNull();
    held2.release();
    expectAuthError(await renewing, 'signed_out', fake.auth.issued());
    await leaving2;
    await settle();
    expect(vault2.state.text).toBeNull();
    expect(auth2.status()).toEqual({ state: 'signed-out' });
  });

  it('a newer sign-in, by password or Google, clears the remembered record at once; a restore it overtakes is revoked and the newer session stands', async () => {
    const vault = memoryVault();
    const auth = remembering(vault.port, googleOptions());
    const remembered = memory(auth);
    vault.state.text = recordFor(ANI, await mintRefreshToken(ANI));
    const held = net.holdNextRefresh();
    const restoring = failure(() => remembered.restore());
    await within(held.arrived);

    const signingIn = auth.signIn(BUDI.email, BUDI.password);
    expect(vault.state.text).toBeNull();
    await signingIn;
    held.release();
    expectAuthError(await restoring, 'superseded', fake.auth.issued());
    await settle();
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity: { uid: providerUserId(BUDI), email: BUDI.email } });
    expect(fake.auth.liveSessions(ANI.email)).toBe(0);
    expect(vault.state.text).toBeNull();

    // Remembered again, then a Google sign-in starts: the password record goes at once (Google itself stays RAM-only).
    expect(await remembered.save(BUDI.accountId)).toBe(true);
    expect(vault.record()?.accountId).toBe(BUDI.accountId);
    await googleOf(auth).start();
    expect(vault.state.text).toBeNull();
  });

  it('release lets go of this run’s session without any logout and keeps the record, so the next run restores it', async () => {
    const vault = memoryVault();
    const auth = remembering(vault.port);
    const remembered = memory(auth);
    await auth.signIn(ANI.email, ANI.password);
    expect(await remembered.save(ANI.accountId)).toBe(true);
    const saved = vault.state.text;
    const from = fake.wire.length;

    await remembered.release();

    expect(auth.status()).toEqual({ state: 'signed-out' });
    expectAuthError(await failure(() => auth.authorized(async (t) => t)), 'signed_out');
    expect(fake.wire.slice(from)).toEqual([]); // no logout
    expect(fake.auth.liveSessions(ANI.email)).toBe(1);
    expect(vault.state.text).toBe(saved);
    const next = remembering(vault.port);
    expect(await memory(next).restore()).toMatchObject({ accountId: ANI.accountId });
  });
});
