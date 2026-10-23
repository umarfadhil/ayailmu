// Hardening the remembered password sign-in (D1 in app/docs/plans/2026-10-20-session-recovery.md, after review),
// written before the change.
// 1. A newer sign-in, by password or with Google, never goes on while the vault cannot forget the remembered record.
//    That record would otherwise restore the earlier account on the next start. The sign-in is refused with the fixed
//    code not_forgotten, before any grant is sent or any Google attempt is prepared. The record is left as it
//    truthfully is, and a current remembered session stays exactly as it was, still kept in step with its record.
// 2. A remembered record stays within 2048 UTF-8 bytes. A larger one is discarded and cleared before any request, and
//    a session whose refresh token would not fit is never saved.
// The real @supabase/auth-js SDK runs over the frozen fake GoTrue of test/fakeAccountApi.ts, behind this suite's own
// fetch lever, which puts an oversized refresh token in the next password grant's reply. The vault is an in-memory
// stand-in for the secure store, whose overwrite can be refused. No keychain, credential or real server.
import { AuthClient } from '@supabase/auth-js';

import type { EnabledGoogleConfig } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { GoogleAttemptRecord, GoogleAuthOptions, GoogleSignIn } from '@/auth/google';
import { createSupabaseAuth, type RememberedSessions, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError, type AuthErrorCode, type SessionVault } from '@/auth/types';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';

jest.setTimeout(30_000);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The most a remembered record may take in the native vault, in UTF-8 bytes. */
const MAX_RECORD_BYTES = 2048;
const INSTALLATION = 'install-7f3a9c2e5b1d';
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: FAKE_API, authUrl: FAKE_GOTRUE };
const NATIVE_GOOGLE: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'native', callbackUrl: 'arabictrial://account' };
const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-remember-1', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };
const BUDI: FakeUser = { email: 'budi@ayailmu.test', password: 'pw-budi-remember-2', uid: 'uid-budi', token: 'legacy-id-token-budi', accountId: '7c2e2a5f-3d4b-4e6f-9a71-82b3c4d5e6f7' };
/** The vault's own refusal, which a refused sign-in never shows. */
const VAULT_REFUSAL = 'The secure store refused to overwrite the record.';

/** The code a refused newer sign-in carries once the change lands; it is not in AuthErrorCode yet. */
type FutureCode = AuthErrorCode | 'not_forgotten';

const realNow = Date.now;
let skew = 0;
/** Moves on the clock that the SDK, the adapter and the fake GoTrue all read (Date.now). */
const later = (ms: number) => {
  skew += ms;
};

/** An in-memory stand-in for the secure vault. With `refuseClear`, a clear throws and the record stays exactly as it was. */
function memoryVault() {
  const state = { text: null as string | null, refuseClear: false };
  const port: SessionVault = {
    installation: () => INSTALLATION,
    read: () => state.text,
    write: (text) => {
      state.text = text;
    },
    clear: () => {
      if (state.refuseClear) throw new Error(VAULT_REFUSAL);
      state.text = null;
    },
  };
  return { port, state };
}

/** The fake servers' fetch, with this suite's lever: the next password grant's reply carries a refresh token of `size` characters. */
function levers(api: FakeAccountApi) {
  const passwordUrl = `${FAKE_GOTRUE}/token?grant_type=password`;
  let oversized: number | null = null;
  const state = { altered: 0 };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const reply = await api.fetch(input, init);
    const size = oversized;
    if (String(input) !== passwordUrl || size === null || reply.status !== 200) return reply;
    oversized = null;
    state.altered += 1;
    const body = JSON.stringify({ ...((await reply.json()) as Record<string, unknown>), refresh_token: 'r'.repeat(size) });
    return { ...(reply as unknown as Record<string, unknown>), text: async () => body, json: async () => JSON.parse(body) as unknown } as unknown as Response;
  }) as typeof globalThis.fetch;
  return {
    fetch,
    state,
    oversizeNextPasswordGrant(size: number) {
      oversized = size;
    },
  };
}

let fake: FakeAccountApi = fakeAccountApi([ANI, BUDI]);
let net = levers(fake);
let clock: jest.SpyInstance<number, []> | null = null;

function remembering(vault: SessionVault, google?: GoogleAuthOptions): SupabaseAuth {
  return createSupabaseAuth({ config: CONFIG, fetch: net.fetch, remember: { vault }, ...(google ? { google } : {}) });
}

/** auth.remembered, or a plain failure naming what is missing. */
function memory(auth: SupabaseAuth): RememberedSessions {
  if (!auth.remembered) throw new Error('This adapter has no remembered-session surface (auth.remembered).');
  return auth.remembered;
}

function googleOf(auth: SupabaseAuth): GoogleSignIn {
  if (!auth.google) throw new Error('no Google sign-in was built');
  return auth.google;
}

/** Native Google sign-in, counting in `seen` every SDK client built for it and every attempt recorded. */
function countedGoogle(seen: { clients: number; recorded: number }): GoogleAuthOptions {
  let held: GoogleAttemptRecord | null = null;
  return {
    config: NATIVE_GOOGLE,
    store: {
      save: (record) => {
        seen.recorded += 1;
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
    createClient: (options) => {
      seen.clients += 1;
      return new AuthClient(options);
    },
  };
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

/** A record as a remembering build would have saved it for `user`. */
function recordFor(user: FakeUser, refreshToken: string): string {
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
  });
}

/** `text` behind leading JSON whitespace, up to exactly `bytes` UTF-8 bytes. */
function paddedTo(bytes: number, text: string): string {
  return `${' '.repeat(bytes - Buffer.byteLength(text, 'utf8'))}${text}`;
}

/** The refresh token the fake GoTrue issued last. */
const latestRefreshToken = () => fake.auth.issued().at(-1);
const recordOf = (vault: { state: { text: string | null } }) =>
  vault.state.text === null ? null : (JSON.parse(vault.state.text) as { refreshToken?: unknown });

/** What `run` came to: its value, or what it threw or rejected with. Never rejects. */
function outcomeOf<T>(run: () => Promise<T>): Promise<{ value: T } | { error: unknown }> {
  return new Promise<T>((resolve) => resolve(run())).then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );
}

/** A refusal: a typed AuthError of `code`, whose text shows none of `secrets`. */
function expectRefused(outcome: { value: unknown } | { error: unknown }, code: FutureCode, secrets: string[]) {
  expect(outcome).toEqual({ error: expect.any(AuthError) });
  const error = (outcome as { error: AuthError }).error;
  expect(error.code).toBe(code);
  const shown = `${String(error)} ${JSON.stringify(error)}`;
  for (const secret of secrets) expect(shown).not.toContain(secret);
}

/** Everything a refusal must never show: both passwords, every token issued, the vault's record and its own refusal. */
const secretsBeside = (record: string | null) => [ANI.password, BUDI.password, ...fake.auth.issued(), ...(record === null ? [] : [record]), VAULT_REFUSAL];

beforeEach(() => {
  skew = 0;
  clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  fake = fakeAccountApi([ANI, BUDI]);
  net = levers(fake);
});

afterEach(() => {
  clock?.mockRestore();
});

describe('a newer sign-in while the vault cannot forget the remembered record', () => {
  it('a password sign-in is refused before any grant, and the earlier remembered record is left as it is', async () => {
    const vault = memoryVault();
    const auth = remembering(vault.port);
    const seeded = recordFor(ANI, await mintRefreshToken(ANI));
    vault.state.text = seeded;
    vault.state.refuseClear = true;
    const from = fake.wire.length;

    expectRefused(await outcomeOf(() => auth.signIn(BUDI.email, BUDI.password)), 'not_forgotten', secretsBeside(seeded));

    expect(fake.wire.slice(from)).toEqual([]); // no password grant, nor any other request
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(vault.state.text).toBe(seeded); // still there, so never claimed forgotten
  });

  it('a refused newer sign-in leaves the current remembered session exactly as it was and in step with its record; signing out then says the record was not forgotten', async () => {
    const vault = memoryVault();
    const auth = remembering(vault.port);
    await auth.signIn(ANI.email, ANI.password);
    expect(await memory(auth).save(ANI.accountId)).toBe(true);
    const before = auth.status();
    const saved = vault.state.text;
    vault.state.refuseClear = true;
    const from = fake.wire.length;

    expectRefused(await outcomeOf(() => auth.signIn(BUDI.email, BUDI.password)), 'not_forgotten', secretsBeside(saved));

    expect(fake.wire.slice(from)).toEqual([]);
    expect(auth.status()).toEqual(before);
    expect(vault.state.text).toBe(saved);
    // Still remembered, never silently forgotten: its refresh still writes the rotated token into the record.
    later(HOUR + MINUTE);
    await auth.refresh();
    expect(recordOf(vault)?.refreshToken).toBe(latestRefreshToken());
    // An explicit sign-out ends and revokes it, and says truthfully that the record could not be forgotten.
    expect(await auth.signOut()).toEqual({ revoked: true, forgotten: false });
    expect(fake.auth.liveSessions(ANI.email)).toBe(0);
    expect(vault.state.text).not.toBeNull();
  });

  it('Google start is refused before any SDK client is built or any attempt recorded, and the remembered record is left as it is', async () => {
    const vault = memoryVault();
    const seen = { clients: 0, recorded: 0 };
    const auth = remembering(vault.port, countedGoogle(seen));
    const seeded = recordFor(ANI, await mintRefreshToken(ANI));
    vault.state.text = seeded;
    vault.state.refuseClear = true;
    const from = fake.wire.length;

    expectRefused(await outcomeOf(() => googleOf(auth).start()), 'not_forgotten', secretsBeside(seeded));

    expect(seen).toEqual({ clients: 0, recorded: 0 }); // no PKCE pair, no authorize URL, no recorded attempt
    expect(fake.wire.slice(from)).toEqual([]);
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(vault.state.text).toBe(seeded);
  });
});

describe('a remembered record stays within 2048 UTF-8 bytes', () => {
  it('a record over 2048 UTF-8 bytes is discarded and cleared before any Auth request', async () => {
    // One byte over: an otherwise valid record, which would restore, behind JSON whitespace.
    const over = memoryVault();
    const padded = paddedTo(MAX_RECORD_BYTES + 1, recordFor(ANI, await mintRefreshToken(ANI)));
    expect(Buffer.byteLength(padded, 'utf8')).toBe(MAX_RECORD_BYTES + 1);
    over.state.text = padded;
    const from = fake.wire.length;
    expect(await outcomeOf(() => memory(remembering(over.port)).restore())).toEqual({ value: null });
    expect(fake.wire.slice(from)).toEqual([]);
    expect(over.state.text).toBeNull();

    // Over in UTF-8 bytes, though not in characters.
    const wide = memoryVault();
    const wideText = recordFor(ANI, `${'é'.repeat(1000)}${await mintRefreshToken(ANI)}`);
    expect(wideText.length).toBeLessThanOrEqual(MAX_RECORD_BYTES);
    expect(Buffer.byteLength(wideText, 'utf8')).toBeGreaterThan(MAX_RECORD_BYTES);
    wide.state.text = wideText;
    const wideFrom = fake.wire.length;
    expect(await outcomeOf(() => memory(remembering(wide.port)).restore())).toEqual({ value: null });
    expect(fake.wire.slice(wideFrom)).toEqual([]);
    expect(wide.state.text).toBeNull();
  });

  it('a session whose refresh token would take the record over 2048 bytes is never saved, and stays an ordinary sign-in in RAM', async () => {
    const vault = memoryVault();
    const auth = remembering(vault.port);
    net.oversizeNextPasswordGrant(4096);
    await auth.signIn(ANI.email, ANI.password);
    expect(net.state.altered).toBe(1);

    expect(await memory(auth).save(ANI.accountId)).toBe(false);

    expect(vault.state.text).toBeNull();
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity: { uid: providerUserId(ANI), email: ANI.email } });
  });
});
