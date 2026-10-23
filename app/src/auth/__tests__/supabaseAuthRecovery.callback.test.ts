// Password recovery callbacks (R1 in app/docs/plans/2026-10-20-session-recovery.md), written before the change: the strict
// callback step. With the optional recovery option (its own config, its own one-attempt store and, when given, the factory
// of its own SDK client) the adapter offers auth.recovery, whose resume(url) takes the recovery link's callback. A native
// build's one callback is exactly arabictrial://recover?code=<lowercase UUID>. Another origin, scheme or path, the Google
// callback (arabictrial://account), a fragment, a token parameter, a duplicate or unexpected parameter, or a malformed
// code is refused with the fixed AuthError('bad_callback') before any request or SDK client, and the normal session stays
// as it was. The attempt store is recovery's own, apart from Google's store and the remembered-session vault. Its one
// record is exactly { v: 1, flowId, verifier, callbackUrl, createdAt, auth, profile }: the SDK's PKCE flow ID and
// verifier, the exact callback, the creation time (ms, at most 60 minutes old), the configured Auth origin and the
// profile; never an email, a password or a session token. Every case seeds its own live attempt, and a positive case shows
// the exact callback with that attempt gets past the checks to the dedicated recovery SDK client, so each refusal below is
// the URL's own. Without the option nothing changes. Every request and SDK client goes to a local spy that throws: no
// SDK, server or credential is involved.
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { createSupabaseAuth, type SupabaseAuth, type SupabaseAuthOptions } from '@/auth/supabaseAuth';
import { AuthError } from '@/auth/types';

const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:54321' };
const NATIVE_CALLBACK = 'arabictrial://recover';
/** A well-formed code (a canonical lowercase UUID), so each row below has only its own defect. */
const CODE = '5d3c1b2a-8f7e-4d6c-9b5a-4e3d2c1b0a9f';

/** recovery.config: built only when EXPO_PUBLIC_PASSWORD_RECOVERY is exactly "on". */
interface RecoveryConfig {
  enabled: true;
  platform: 'native' | 'web';
  /** Native: exactly arabictrial://recover. Web: the app's own origin with exactly the /recover path. */
  callbackUrl: string;
}
/** The one pending attempt (version 1): bound to this Auth origin and profile, used once, at most 60 minutes old. */
interface RecoveryAttempt {
  v: 1;
  /** The SDK's PKCE flow ID, as its verifier's storage key names it. */
  flowId: string;
  /** The PKCE verifier (112 lowercase hex characters): sent only in the one exchange. */
  verifier: string;
  callbackUrl: string;
  /** When the request was sent, in ms since the epoch. */
  createdAt: number;
  /** The configured Auth origin. */
  auth: string;
  profile: 'local' | 'staging';
}
/** Recovery's own store for its pending attempt, never Google's store or the remembered-session vault. */
interface RecoveryAttemptStore {
  save(record: RecoveryAttempt): void;
  take(): RecoveryAttempt | null;
  clear(): void;
}
interface RecoveryOptions {
  config: RecoveryConfig;
  store: RecoveryAttemptStore;
  /** Builds recovery's dedicated SDK client when a request or exchange needs one (default: the maintained SDK). */
  createClient?: (options: Record<string, unknown>) => unknown;
}
/** auth.recovery: present only with the recovery option. This step reaches only resume. */
interface RecoveryPort {
  resume(callbackUrl: string): Promise<unknown>;
}
type RecoveringAuth = SupabaseAuth & { recovery?: RecoveryPort };

/** Every request and every recovery SDK client asked for; each throws locally, so nothing leaves this test. */
const sent: string[] = [];
const built: unknown[] = [];
const refuse = (async (input: RequestInfo | URL) => {
  sent.push(String(input));
  throw new Error('local spy: no request may be sent');
}) as typeof fetch;
const globalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

beforeEach(() => {
  sent.length = 0;
  built.length = 0;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: refuse });
});
afterAll(() => {
  if (globalFetch) Object.defineProperty(globalThis, 'fetch', globalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

/** A live attempt as a request for CONFIG leaves it: well formed, current and bound, holding no token. */
const liveAttempt = (): RecoveryAttempt => ({
  v: 1,
  flowId: '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  verifier: '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(3).concat('a1b2c3d4e5f60718'),
  callbackUrl: NATIVE_CALLBACK,
  createdAt: Date.now(),
  auth: CONFIG.authUrl,
  profile: 'local',
});

/** Recovery's options for a native build, with its own store holding a fresh live attempt. */
function recoveryOptions(): RecoveryOptions {
  let held: RecoveryAttempt | null = liveAttempt();
  return {
    config: { enabled: true, platform: 'native', callbackUrl: NATIVE_CALLBACK },
    store: {
      save: (record) => {
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
      built.push(options);
      throw new Error('local spy: no recovery SDK client may be built');
    },
  };
}

function adapter(recovery?: RecoveryOptions): SupabaseAuth {
  const options = { config: CONFIG, fetch: refuse, ...(recovery ? { recovery } : {}) };
  return createSupabaseAuth(options as unknown as SupabaseAuthOptions);
}

/** auth.recovery, or a plain failure naming what is missing. */
function recoveryOf(auth: SupabaseAuth): RecoveryPort {
  const recovery = (auth as RecoveringAuth).recovery;
  if (!recovery) throw new Error('This adapter has no password-recovery surface (auth.recovery).');
  return recovery;
}

const BAD_CALLBACKS: [string, string][] = [
  ['a foreign origin', `https://evil.example/recover?code=${CODE}`],
  ['the web callback on a native build', `http://localhost:8081/recover?code=${CODE}`],
  ['the Google callback', `arabictrial://account?code=${CODE}`],
  ['a fragment', `${NATIVE_CALLBACK}?code=${CODE}#recovery`],
  ['implicit-flow tokens in a fragment', `${NATIVE_CALLBACK}#access_token=fake-access&refresh_token=fake-refresh&type=recovery`],
  ['a token parameter', `${NATIVE_CALLBACK}?code=${CODE}&access_token=fake-access`],
  ['a duplicate code', `${NATIVE_CALLBACK}?code=${CODE}&code=${CODE}`],
  ['an unexpected parameter', `${NATIVE_CALLBACK}?code=${CODE}&type=recovery`],
  ['a malformed code', `${NATIVE_CALLBACK}?code=not-a-code`],
];

describe('password recovery callbacks', () => {
  it('default: without the recovery option there is no recovery surface and nothing is sent', () => {
    const auth = adapter();
    expect((auth as RecoveringAuth).recovery).toBeUndefined();
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(sent).toEqual([]);
  });

  it('positive routing: the exact callback with a live attempt asks once for the dedicated recovery SDK client', async () => {
    const auth = adapter(recoveryOptions());
    const recovery = recoveryOf(auth);
    const error = await Promise.resolve()
      .then(() => recovery.resume(`${NATIVE_CALLBACK}?code=${CODE}`))
      .then(() => null, (caught: unknown) => caught);
    expect(built).toHaveLength(1);
    expect(error).toBeTruthy();
    expect((error as { code?: unknown }).code).not.toBe('bad_callback');
    expect(sent).toEqual([]);
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });

  it.each(BAD_CALLBACKS)('refuses %s with bad_callback before any request or SDK client', async (_defect, url) => {
    const auth = adapter(recoveryOptions());
    const recovery = recoveryOf(auth);
    const error = await Promise.resolve()
      .then(() => recovery.resume(url))
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: 'bad_callback', message: 'Account sign-in problem: bad_callback' });
    expect(sent).toEqual([]);
    expect(built).toEqual([]);
    expect(auth.status()).toEqual({ state: 'signed-out' });
  });
});
