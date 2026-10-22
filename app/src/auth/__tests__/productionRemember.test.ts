// Production remembered sign-in, RED. A production build that remembers a password sign-in binds the vault's record to
// the production profile, never the local one. A local protocol fixture only: the fictional hosts (example.org) are
// answered by the frozen fakes of test/fakeAccountApi.ts, never resolved or contacted, and the vault is in memory.
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import type { SessionVault } from '@/auth/types';
import { fakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
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

it('a remembered production sign-in is recorded under the production profile', async () => {
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
  const auth = createSupabaseAuth({ config: CONFIG, fetch: net.fetch, remember: { vault } });
  try {
    await auth.signIn(LEARNER.email, LEARNER.password);
    await expect(auth.remembered?.save(LEARNER.accountId)).resolves.toBe(true);
    const record = JSON.parse(vault.read() ?? '{}') as Record<string, unknown>;
    // Field by field, so a failure never prints the record's refresh token.
    expect(record.profile).toBe('production');
    expect(record.email).toBe(LEARNER.email);
  } finally {
    await auth.signOut();
  }
});
