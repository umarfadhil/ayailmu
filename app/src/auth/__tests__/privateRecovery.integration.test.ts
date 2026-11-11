import { createHash, randomFillSync } from 'crypto';
import type { RecoveryCrypto } from '@/auth/recoveryCrypto';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { createSecureRecoveryStore, isSafeRecoveryConfig, memoryRecoveryStore } from '@/auth/recovery';
const callbackUrl = 'arabictrial://recover';
const config = { enabled: true, provider: 'local-supabase', environment: 'private-qa', privateQa: true, apiBaseUrl: 'https://localhost:58444', authUrl: 'https://localhost:58445' } as const;
const nativeCrypto: RecoveryCrypto = { random: (size: number) => randomFillSync(new Uint8Array(size)), sha256: async (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest()) };
const recoveryConfig = { enabled: true, platform: 'native', callbackUrl } as const;
function app(crypto = nativeCrypto) {
  const store = memoryRecoveryStore();
  const fetch = jest.fn(async () => ({ status: 200, ok: true } as Response));
  const auth = createSupabaseAuth({ config, fetch, recovery: { config: recoveryConfig, store, nativeCrypto: crypto } } as Parameters<typeof createSupabaseAuth>[0]);
  return { auth, fetch, store };
}
it('requires private capability and a native callback', () => {
  expect((isSafeRecoveryConfig as Function)(recoveryConfig, 'private-qa')).toBe(false);
  expect((isSafeRecoveryConfig as Function)(recoveryConfig, 'private-qa', undefined, true)).toBe(true);
});
it('requests S256 through the injected transport and keeps only the bound verifier', async () => {
  const { auth, fetch, store } = app();
  await expect(auth.recovery!.request('owner-qa@example.invalid')).resolves.toEqual({ requested: true });
  const record = store.take()!;
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`${config.authUrl}/recover?redirect_to=${encodeURIComponent(callbackUrl)}`);
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'manual', method: 'POST' });
  expect(JSON.parse(String(init.body))).toEqual({ email: 'owner-qa@example.invalid', code_challenge: createHash('sha256').update(record.verifier).digest('base64url'), code_challenge_method: 's256' });
  expect(Object.keys(record).sort()).toEqual(['auth','callbackUrl','createdAt','flowId','profile','v','verifier']);
  expect(record.profile).toBe('private-qa');
  expect(store.take()).toBeNull();
});
it('refuses another recipient before crypto or transport', async () => {
  const { auth, fetch } = app();
  await expect(auth.recovery!.request('Owner-qa@example.invalid')).rejects.toMatchObject({ code: 'private_recipient' });
  expect(fetch).not.toHaveBeenCalled();
});
it('cancellation during digest prevents egress and persistence', async () => {
  let resolve!: (value: Uint8Array) => void;
  const { auth, fetch, store } = app({ ...nativeCrypto, sha256: () => new Promise<Uint8Array>(r => { resolve = r; }) });
  const pending = auth.recovery!.request('owner-qa@example.invalid');
  await auth.recovery!.cancel(); resolve(new Uint8Array(32));
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  expect(fetch).not.toHaveBeenCalled(); expect(store.take()).toBeNull();
});
it('a private secure attempt survives reconstruction and is consumed once', () => {
  const data = new Map<string,string>(); let marker: string | null = null;
  const parts = { secureStore: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v: string) => { data.set(k,v); } }, whenUnlockedThisDeviceOnly: 7, marker: { read: () => marker, write: (v: string) => { marker = v; } }, newMarker: () => 'install1' };
  const binding = { api: config.apiBaseUrl, auth: config.authUrl, callbackUrl, environment: 'private-qa', privateQa: true };
  const record = { v: 1, flowId: 'flow_private_01', verifier: 'a'.repeat(64), callbackUrl, createdAt: 1000, auth: config.authUrl, profile: 'private-qa' } as const;
  const factory = createSecureRecoveryStore as Function;
  factory(parts,binding,() => 1000).save(record);
  const cold = factory(parts,binding,() => 1000); expect(cold.take()).toEqual(record); expect(cold.take()).toBeNull();
});
