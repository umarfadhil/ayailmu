// Production email sign-in, RED. Under the explicit production configuration (environment 'production' with the
// productionAccounts capability), the maintained SDK signs a real-format address in at the standalone GoTrue's root, the
// account API verifies its account, and signing out revokes the session there. A local protocol fixture only: the
// fictional hosts (example.org) are answered by the frozen fakes of test/fakeAccountApi.ts, never resolved or contacted,
// and no real user, consent or deliverable address is involved.
import { createApiClient } from '@/api/client';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
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

describe('the production email sign-in', () => {
  it("signs a real-format address in at the standalone GoTrue's root, verifies its account, and signs out there", async () => {
    const fake = fakeAccountApi([LEARNER]);
    const net = productionNetwork(fake.fetch as unknown as typeof fetch);
    const auth = createSupabaseAuth({ config: CONFIG, fetch: net.fetch });
    const api = createApiClient({ baseUrl: PRODUCTION_API, environment: 'production', productionAccounts: true, fetch: net.fetch });
    try {
      await expect(auth.signIn(LEARNER.email, LEARNER.password)).resolves.toMatchObject({ uid: providerUserId(LEARNER), email: LEARNER.email });
      await expect(auth.authorized((token, signal) => api.me(token, signal))).resolves.toEqual({
        accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
        profiles: [],
      });
      await expect(auth.signOut()).resolves.toEqual({ revoked: true });

      expect(net.requests).toEqual([`POST ${PRODUCTION_AUTH}/token?grant_type=password`, `GET ${PRODUCTION_API}/v1/me`, `POST ${PRODUCTION_AUTH}/logout?scope=local`]);
      expect(net.requests.some((request) => request.includes('/auth/v1'))).toBe(false);
    } finally {
      // A session a failed step left is ended too, so its SDK client is retired through the SDK's own sign-out.
      if (auth.status().state !== 'signed-out') await auth.signOut();
    }
  });
});
