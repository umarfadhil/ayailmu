import { AUTH_REQUEST_TIMEOUT_MS, createSupabaseAuth } from '@/auth/supabaseAuth';
import { memoryRecoveryStore } from '@/auth/recovery';
import type { RecoveryCrypto } from '@/auth/recoveryCrypto';

const config = { enabled: true, provider: 'local-supabase', environment: 'private-qa', privateQa: true, apiBaseUrl: 'https://localhost:58444', authUrl: 'https://localhost:58445' } as const;
const owner = 'owner-qa@example.invalid';
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
function app() {
  const pendingDigests: ((value: Uint8Array) => void)[] = [];
  const nativeCrypto: RecoveryCrypto = { random: size => new Uint8Array(size).fill(7), sha256: () => new Promise(resolve => { pendingDigests.push(resolve); }) };
  const store = memoryRecoveryStore(); const save = jest.spyOn(store, 'save');
  const fetch = jest.fn(async () => ({ status: 200 } as Response));
  const auth = createSupabaseAuth({ config, fetch, recovery: { config: { enabled: true, platform: 'native', callbackUrl: 'arabictrial://recover' }, store, nativeCrypto } });
  return { auth, fetch, store, save, pendingDigests };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
it.each(['cancel', 'signOut'] as const)('%s promptly settles a request whose native digest never resolves', async action => {
  const { auth, fetch, store, save, pendingDigests } = app();
  let outcome: unknown;
  const pending = auth.recovery!.request(owner).catch(error => { outcome = error; });
  if (action === 'cancel') await auth.recovery!.cancel(); else await auth.signOut();
  await flush();
  expect(outcome).toMatchObject({ code: action === 'cancel' ? 'cancelled' : 'signed_out' });
  expect(jest.getTimerCount()).toBe(0);
  pendingDigests[0](new Uint8Array(32).fill(7)); await flush(); await pending;
  expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(store.take()).toBeNull();
});
it('a newer recovery intent promptly supersedes a stuck digest', async () => {
  const { auth, fetch, save } = app(); let outcome: unknown;
  void auth.recovery!.request(owner).catch(error => { outcome = error; });
  const newer = auth.recovery!.request(owner).catch(error => error);
  await flush(); expect(outcome).toMatchObject({ code: 'superseded' });
  await auth.recovery!.cancel(); await newer;
  expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
it('the native digest deadline refuses without egress and ignores a late digest', async () => {
  const { auth, fetch, save, store, pendingDigests } = app(); let outcome: unknown;
  const pending = auth.recovery!.request(owner).catch(error => { outcome = error; });
  await jest.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
  await flush(); expect(outcome).toMatchObject({ code: 'unavailable' });
  expect(jest.getTimerCount()).toBe(0);
  pendingDigests[0](new Uint8Array(32).fill(7)); await flush(); await pending;
  expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(store.take()).toBeNull();
});
