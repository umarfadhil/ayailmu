// Production remembered sign-in restored, RED. A later run of a production build restores the remembered password
// sign-in of a real-format address through one refresh grant at the standalone GoTrue's root, keeping the record bound to
// the production profile and its save time, with the rotated refresh token written back. A local protocol fixture only:
// the fictional hosts (example.org) are answered by the frozen fakes of test/fakeAccountApi.ts, never resolved or
// contacted, and the vault is in memory.
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import type { SessionVault } from '@/auth/types';
import { fakeAccountApi, providerUserId, type FakeUser } from '../../../test/fakeAccountApi';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';

/** A real-format address, known to the fake GoTrue only. */
const LEARNER: FakeUser = {
  email: 'learner@example.org',
  password: 'fixture-password-only',
  uid: 'uid-production-learner',
  token: 'legacy-fixture-token',
  accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
};

const CONFIG = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: PRODUCTION_API,
  authUrl: PRODUCTION_AUTH,
} as const;

it('a remembered production sign-in is restored in a later run through one refresh grant', async () => {
  const net = productionNetwork(fakeAccountApi([LEARNER]).fetch as unknown as typeof fetch);
  let text: string | null = null;
  const vault: SessionVault = {
    installation: () => 'fixture-installation',
    read: () => text,
    write(value) {
      text = value;
    },
    clear() {
      text = null;
    },
  };
  let auth = createSupabaseAuth({ config: CONFIG, fetch: net.fetch, remember: { vault } });
  try {
    await auth.signIn(LEARNER.email, LEARNER.password);
    await expect(auth.remembered?.save('6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6')).resolves.toBe(true);
    const before = JSON.parse(vault.read() ?? '{}') as Record<string, unknown>;
    await auth.remembered?.release();

    // A later run: a new adapter over the same vault and network.
    auth = createSupabaseAuth({ config: CONFIG, fetch: net.fetch, remember: { vault } });
    await expect(auth.remembered?.restore()).resolves.toMatchObject({
      identity: { uid: providerUserId(LEARNER), email: LEARNER.email },
      accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
    });
    const after = JSON.parse(vault.read() ?? '{}') as Record<string, unknown>;
    expect(after.profile).toBe('production');
    expect(after.savedAt).toBe(before.savedAt);
    // Compared as a boolean, so a failure never prints a refresh token.
    expect(typeof after.refreshToken).toBe('string');
    expect(after.refreshToken !== before.refreshToken).toBe(true);
    // The password grant, then the one refresh grant: release sent nothing, and no account API request was made.
    expect(net.requests).toEqual([`POST ${PRODUCTION_AUTH}/token?grant_type=password`, `POST ${PRODUCTION_AUTH}/token?grant_type=refresh_token`]);

    await expect(auth.signOut()).resolves.toEqual({ revoked: true });
    expect(vault.read()).toBeNull();
  } finally {
    if (auth.status().state !== 'signed-out') await auth.signOut();
  }
});
