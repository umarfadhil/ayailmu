import type { GoTrueClientOptions } from '@supabase/auth-js';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { createSecureRecoveryStore, memoryRecoveryStore, readWrappedRecoveryCallback, type RecoveryAttemptRecord } from '@/auth/recovery';

const callbackUrl = 'arabictrial://recover';
const authUrl = 'https://localhost:58445';
const config = { enabled: true, provider: 'local-supabase', environment: 'private-qa', privateQa: true, apiBaseUrl: 'https://localhost:58444', authUrl } as const;
const token = `pkce_${'ab'.repeat(28)}`;
const redirect = `redirect_to=${encodeURIComponent(callbackUrl)}`;
const inner = `${authUrl}/verify?token=${token}&type=recovery&${redirect}`;
const wrap = (link: string) => `${callbackUrl}?verify_url=${encodeURIComponent(link)}`;
const code = '0b6a4f4e-3c1d-4e8b-9a5f-2d7c8e1f0a3b';
const uid = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const record: RecoveryAttemptRecord = { v: 1, flowId: 'flow_private_01', verifier: 'a'.repeat(64), callbackUrl, createdAt: 1000, auth: authUrl, profile: 'private-qa' };
const nativeCrypto = { random: (size: number) => Uint8Array.from({ length: size }, (_, i) => i + 1), sha256: async () => new Uint8Array(32).fill(7) };

function app(reply: () => Promise<unknown>, email = 'owner-qa@example.invalid') {
  const store = memoryRecoveryStore();
  store.save(record);
  const fetch = jest.fn(reply);
  const exchanged: unknown[] = [];
  const signOut = jest.fn(async () => ({ error: null }));
  const createClient = (options: GoTrueClientOptions) => ({
    exchangeCodeForSession: jest.fn(async (given: string, { flowId }: { flowId: string }) => {
      exchanged.push([given, flowId, options.storage?.getItem(`${options.storageKey}-flow-${flowId}-code-verifier`)]);
      return { data: { session: { access_token: 'access', user: { id: uid, email } } }, error: null };
    }),
    signOut,
    stopAutoRefresh: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
  });
  const recovery = { config: { enabled: true, platform: 'native', callbackUrl }, store, nativeCrypto, createClient };
  const auth = createSupabaseAuth({ config, fetch, now: () => 1000, recovery } as unknown as Parameters<typeof createSupabaseAuth>[0]);
  return { auth, fetch, store, exchanged, signOut };
}
const redirected = (status: number, location: string) => async () => ({ status, headers: { get: (name: string) => (name === 'location' ? location : null) } });

it('reads only the exact wrapper of the exact verification link, in any parameter order', () => {
  expect(readWrappedRecoveryCallback(wrap(inner), callbackUrl, authUrl)).toBe(inner);
  expect(readWrappedRecoveryCallback(wrap(`${authUrl}/verify?${redirect}&type=recovery&token=${token}`), callbackUrl, authUrl)).toBe(inner);
  for (const bad of [
    wrap(`${inner}&extra=1`),
    wrap(`${authUrl}/verify?token=${token}&token=${token}&type=recovery`),
    wrap(`${inner}#frag`),
    `${wrap(inner)}#frag`,
    `${wrap(inner)}&next=1`,
    wrap(inner.replace('https://', 'https://user@')),
    wrap(inner.replace(':58445', ':58446')),
    wrap(inner.replace('localhost', '127.0.0.1')),
    wrap(inner.replace(encodeURIComponent(callbackUrl), encodeURIComponent(encodeURIComponent(callbackUrl)))),
    wrap(inner.replace(token, token.toUpperCase().replace('PKCE_', 'pkce_'))),
    wrap(inner.replace('type=recovery', 'type=signup')),
    wrap(inner).replace('%3A', '%3a'),
    `${callbackUrl}?verify_url=${inner}`,
  ]) {
    expect(readWrappedRecoveryCallback(bad, callbackUrl, authUrl)).toBeNull();
  }
});

it('a cold wrapped callback takes the bound attempt once, follows one 303 and exchanges its code once', async () => {
  const { auth, fetch, store, exchanged } = app(redirected(303, `${callbackUrl}?code=${code}`));
  await expect(auth.recovery!.resume(wrap(inner))).resolves.toEqual({ ready: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(inner);
  expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual' });
  expect(init.headers).toBeUndefined();
  expect(exchanged).toEqual([[code, record.flowId, JSON.stringify(`${record.verifier}/recovery`)]]);
  expect(store.take()).toBeNull();
});

it.each([
  ['a 302', redirected(302, `${callbackUrl}?code=${code}`)],
  ['an error 303', redirected(303, `${callbackUrl}?error=access_denied`)],
])('%s is no success, and the attempt is spent', async (_, reply) => {
  const { auth, store, exchanged } = app(reply);
  await expect(auth.recovery!.resume(wrap(inner))).rejects.toMatchObject({ code: 'bad_callback' });
  expect(exchanged).toEqual([]);
  expect(store.take()).toBeNull();
});

it('a cancel during verification fences the late reply and the exchange', async () => {
  const { auth, exchanged } = app(() => new Promise(() => undefined));
  const pending = auth.recovery!.resume(wrap(inner));
  await auth.recovery!.cancel();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  expect(exchanged).toEqual([]);
});

it('a recovery session that is not the approved owner is retired, never held', async () => {
  const { auth, signOut } = app(redirected(303, `${callbackUrl}?code=${code}`), 'Owner-qa@example.invalid');
  await expect(auth.recovery!.resume(wrap(inner))).rejects.toMatchObject({ code: 'bad_response' });
  expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  await expect(auth.recovery!.update('new-password-1')).rejects.toMatchObject({ code: 'bad_callback' });
});

describe('secure store profile gates', () => {
  const parts = () => {
    const data = new Map<string, string>();
    let marker: string | null = null;
    return {
      secureStore: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
      whenUnlockedThisDeviceOnly: 7,
      marker: { read: () => marker, write: (v: string) => void (marker = v) },
      newMarker: () => 'install1',
    };
  };
  const privateBinding = { api: config.apiBaseUrl, auth: authUrl, callbackUrl, environment: 'private-qa', privateQa: true };
  const factory = createSecureRecoveryStore as unknown as (p: unknown, b: unknown, now: () => number) => ReturnType<typeof createSecureRecoveryStore>;

  it.each([
    ['a production capability', { ...privateBinding, productionAccounts: true }],
    ['another API root', { ...privateBinding, api: 'https://localhost:58446' }],
    ['no private capability', { ...privateBinding, privateQa: undefined }],
  ])('refuses a private binding with %s', (_, binding) => {
    expect(() => factory(parts(), binding, () => 1000).save(record)).toThrow();
  });

  it('keeps each profile to its own attempts', () => {
    expect(() => factory(parts(), privateBinding, () => 1000).save({ ...record, profile: 'production' })).toThrow();
    // The old three-field binding stays production's: never a private attempt, nor the private roots.
    expect(() => factory(parts(), { api: config.apiBaseUrl, auth: authUrl, callbackUrl }, () => 1000).save(record)).toThrow();
  });
});
