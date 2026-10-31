import { createHash, randomFillSync } from 'crypto';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { memoryRecoveryStore, type RecoveryAttemptRecord } from '@/auth/recovery';
import { deviceRecoveryStore } from '@/auth/recoveryDevice';
import { createRegistration } from '@/auth/registration';
import { recoveryFailure } from '@/ui/recoveryMessages';
import { AuthError } from '@/auth/types';
import type { RecoveryCrypto } from '@/auth/recoveryCrypto';
const callbackUrl = 'arabictrial://recover';
const authUrl = 'https://localhost:58445';
const config = { enabled: true, provider: 'local-supabase', environment: 'private-qa', privateQa: true, apiBaseUrl: 'https://localhost:58444', authUrl } as const;
const recoveryConfig = { enabled: true, platform: 'native', callbackUrl } as const;
const owner = 'owner-qa@example.invalid';
const code = '11111111-2222-4333-8444-555555555555';
const uid = '11111111-2222-4333-8444-666666666666';
const nativeCrypto: RecoveryCrypto = { random: size => randomFillSync(new Uint8Array(size)), sha256: async data => Uint8Array.from(createHash('sha256').update(data).digest()) };
const inner = `${authUrl}/verify?token=pkce_${'a'.repeat(56)}&type=recovery&redirect_to=${encodeURIComponent(callbackUrl)}`;
const wrapper = `${callbackUrl}?verify_url=${encodeURIComponent(inner)}`;
function response(url: string, status: number, body: unknown = {}, location?: string) {
  return { url, status, ok: status >= 200 && status < 300, redirected: false, headers: { get: (name: string) => name.toLowerCase() === 'location' ? location ?? null : 'application/json' }, text: async () => JSON.stringify(body), json: async () => body } as Response;
}
it('starts the cooldown and pending lifetime when POST leaves, after a slow digest', async () => {
  let at = 1000; let finish!: (bytes: Uint8Array) => void;
  const crypto: RecoveryCrypto = { ...nativeCrypto, sha256: () => new Promise(r => { finish = r; }) };
  const store = memoryRecoveryStore(); const fetch = jest.fn(async (url: RequestInfo | URL) => response(String(url),200));
  const auth = createSupabaseAuth({ config, fetch, now: () => at, recovery: { config: recoveryConfig, store, nativeCrypto: crypto } });
  const pending = auth.recovery!.request(owner); at = 61000; finish(new Uint8Array(32).fill(7)); await pending;
  const record = store.take()!; expect(record.createdAt).toBe(61000);
  at = 62000; await auth.recovery!.request(owner); expect(fetch).toHaveBeenCalledTimes(1);
});
it('explains the approved recipient refusal in recovery', () => {
  expect(recoveryFailure(new AuthError('private_recipient'),'request')).toEqual({ stage: 'email', message: 'Gunakan email yang disetujui untuk build ini.' });
});
it('never returns RAM for an explicitly private disabled configuration', () => {
  expect(deviceRecoveryStore({ ...config, enabled: false } as unknown as Parameters<typeof deviceRecoveryStore>[0])).toBeNull();
});
it('cold callback exchanges the exact persisted verifier through the installed real SDK', async () => {
  const store = memoryRecoveryStore(); const at = 1000;
  const record: RecoveryAttemptRecord = { v: 1, flowId: 'cold_flow_01', verifier: 'a'.repeat(64), callbackUrl, auth: authUrl, createdAt: at, profile: 'private-qa' }; store.save(record);
  const sent: { url: string; init?: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = async (input,init) => {
    const url = String(input); sent.push({ url,init });
    if (url === inner) { expect(store.take()).toBeNull(); return response(url,303,{},`${callbackUrl}?code=${code}`); }
    if (url === `${authUrl}/token?grant_type=pkce`) {
      expect(JSON.parse(String(init?.body))).toEqual({ auth_code: code, code_verifier: record.verifier });
      return response(url,200,{ access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: owner } });
    }
    if (url === `${authUrl}/logout?scope=local`) return response(url,204);
    throw new Error('unexpected in-memory route');
  };
  const auth = createSupabaseAuth({ config, fetch, now: () => at, recovery: { config: recoveryConfig, store, nativeCrypto } });
  await expect(auth.recovery!.resume(wrapper)).resolves.toEqual({ ready: true });
  expect(sent.slice(0,2).map(s => s.url)).toEqual([inner,`${authUrl}/token?grant_type=pkce`]);
  expect(sent[0].init?.headers).toBeUndefined();
  await auth.recovery!.cancel();
});
it('private signup replies require the exact owner spelling', async () => {
  const registration = createRegistration({ config, emailPolicy: 'private-qa-confirmed-email', fetch: async (url) => response(String(url),200,{ user: { id: uid, email: 'Owner-qa@example.invalid' }, session: null }) });
  await expect(registration.register(owner,'fixture-password')).rejects.toMatchObject({ code: 'bad_response' });
  await registration.dispose();
});
