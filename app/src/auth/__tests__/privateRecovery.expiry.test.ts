import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { memoryRecoveryStore, RECOVERY_ATTEMPT_TTL_MS } from '@/auth/recovery';
const callbackUrl = 'arabictrial://recover';
const authUrl = 'https://localhost:58445';
const code = '11111111-2222-4333-8444-555555555555';
const config = { enabled: true, provider: 'local-supabase', environment: 'private-qa', privateQa: true, apiBaseUrl: 'https://localhost:58444', authUrl } as const;
it.each(['session', 'attempt'])('does not hold an expired private %s after a delayed exchange', async kind => {
  let at = 1000;
  const store = memoryRecoveryStore(); store.save({ v: 1, flowId: 'expiry_flow_01', verifier: 'a'.repeat(64), callbackUrl, auth: authUrl, createdAt: at, profile: 'private-qa' });
  const signOut = jest.fn(async () => ({ error: null }));
  const sdk = { exchangeCodeForSession: async () => {
    if (kind === 'attempt') at += RECOVERY_ATTEMPT_TTL_MS;
    return { data: { session: { access_token: 'fixture', expires_at: kind === 'session' ? 1 : 9999999999, user: { id: '11111111-2222-4333-8444-666666666666', email: 'owner-qa@example.invalid' } } }, error: null };
  }, signOut, stopAutoRefresh: async () => undefined, dispose: async () => undefined };
  const auth = createSupabaseAuth({ config, fetch: jest.fn(), now: () => at, recovery: { config: { enabled: true, platform: 'native', callbackUrl }, store, nativeCrypto: { random: (size: number) => new Uint8Array(size).fill(7), sha256: async () => new Uint8Array(32).fill(7) }, createClient: () => sdk } } as unknown as Parameters<typeof createSupabaseAuth>[0]);
  await expect(auth.recovery!.resume(`${callbackUrl}?code=${code}`)).rejects.toMatchObject({ code: 'expired' });
  expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  await expect(auth.recovery!.update('fixture-password')).rejects.toMatchObject({ code: 'bad_callback' });
});
