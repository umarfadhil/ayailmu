// The Auth adapter's profile is the one it validated when it was built, RED. Changing the caller's configuration object
// afterwards never changes the email policy: a local adapter still takes synthetic .test addresses only, refusing a
// real-format one before anything is sent. A remembered production record is restored only under exactly its own
// installation, Auth server, account API and production profile; any other binding restores nothing, sends nothing and
// clears the record. Local protocol fixtures only: the fake servers of test/fakeAccountApi.ts and fictional example.org
// hosts, never resolved or contacted; the vault is in memory and its refresh token is a fixture that is never sent.
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import type { SessionVault } from '@/auth/types';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
import { PRODUCTION_API, PRODUCTION_AUTH } from '../../../test/productionNetwork';

/** A real-format address, known to the fake GoTrue only. */
const LEARNER: FakeUser = {
  email: 'learner@example.org',
  password: 'fixture-password-only',
  uid: 'uid-production-learner',
  token: 'legacy-fixture-token',
  accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
};

it("a local adapter keeps its validated profile when the caller's configuration object changes afterwards", async () => {
  const fake = fakeAccountApi([LEARNER]);
  const sent = jest.fn(fake.fetch as unknown as typeof fetch);
  const config: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: FAKE_API, authUrl: FAKE_GOTRUE };
  const auth = createSupabaseAuth({ config, fetch: sent as unknown as typeof fetch });
  config.environment = 'production';
  config.productionAccounts = true;
  try {
    const refused = await auth.signIn(LEARNER.email, LEARNER.password).then(
      () => null,
      (e: unknown) => e
    );
    expect(refused).toMatchObject({ code: 'not_synthetic' });
    expect(auth.status()).toEqual({ state: 'signed-out' });
    // Counted, not listed: a failure never prints a request, so never the password.
    expect(sent).toHaveBeenCalledTimes(0);
  } finally {
    if (auth.status().state !== 'signed-out') await auth.signOut();
  }
});

describe('a remembered production record bound elsewhere', () => {
  const CONFIG = {
    enabled: true,
    provider: 'local-supabase',
    environment: 'production',
    productionAccounts: true,
    apiBaseUrl: PRODUCTION_API,
    authUrl: PRODUCTION_AUTH,
  } as const;
  /** A whole, valid production password record, as a save would write it. */
  const RECORD = {
    v: 1,
    kind: 'password',
    installation: 'fixture-installation',
    auth: PRODUCTION_AUTH,
    api: PRODUCTION_API,
    profile: 'production',
    uid: '8c2e9f13-6a4d-4c79-8b52-4df391a0b625',
    email: 'learner@example.org',
    accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
    refreshToken: 'fixture-never-sent',
    savedAt: new Date(Date.now()).toISOString(),
  };

  it.each([
    ['the local profile', { profile: 'local' }],
    ['the staging profile', { profile: 'staging' }],
    ['another Auth server', { auth: 'https://auth-other.example.org' }],
    ['another account API', { api: 'https://api-other.example.org' }],
    ['another installation', { installation: 'another-installation' }],
  ])('with %s restores nothing, sends nothing and clears the record', async (_case, over: Record<string, string>) => {
    let text: string | null = JSON.stringify({ ...RECORD, ...over });
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
    const probe = jest.fn(() => {
      throw new Error('nothing may be sent');
    });
    const auth = createSupabaseAuth({ config: CONFIG, fetch: probe as unknown as typeof fetch, remember: { vault } });

    await expect(auth.remembered?.restore()).resolves.toBeNull();
    // Compared as booleans and counted, so a failure never prints the record or its refresh token.
    expect(vault.read() === null).toBe(true);
    expect(probe).toHaveBeenCalledTimes(0);
  });
});
