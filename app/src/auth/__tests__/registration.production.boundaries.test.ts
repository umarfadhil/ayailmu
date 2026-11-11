import { createRegistration, type RegistrationOptions, type RegistrationSdkClient } from '@/auth/registration';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';

// Mock-only: the SDK boundary and fetch are fakes, so these prove the adapter's policy gates and its handling of
// production Auth answers, never real SMTP/inbox delivery, phone confirmation or a reachable production Auth server.
// The fixture roots are reserved and never requested.
const API = 'https://api.example.org';
const AUTH = 'https://auth.example.org';
const EMAIL = 'learner@example.org';
const USER = { id: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', email: EMAIL };
const SESSION = {
  access_token: 'fixture-access',
  refresh_token: 'fixture-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  user: USER,
};
const PRODUCTION = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: API,
  authUrl: AUTH,
} as EnabledSupabaseConfig;
const asConfig = (config: object) => config as unknown as EnabledSupabaseConfig;

type Registration = ReturnType<typeof createRegistration>;
const created: Registration[] = [];
afterEach(async () => {
  while (created.length > 0) await created.pop()?.dispose();
});

function harness(config: EnabledSupabaseConfig, emailPolicy?: string) {
  const sdk = {
    signUp: jest.fn().mockResolvedValue({ data: { user: USER, session: null }, error: null }),
    verifyOtp: jest.fn().mockResolvedValue({ data: { user: USER, session: SESSION }, error: null }),
    resend: jest.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    stopAutoRefresh: jest.fn().mockResolvedValue(undefined),
  };
  const createClient = jest.fn(() => sdk as unknown as RegistrationSdkClient);
  const fetchFake = jest.fn(() => {
    throw new Error('no network in this test');
  });
  const options = {
    config,
    createClient,
    fetch: fetchFake as unknown as typeof fetch,
    ...(emailPolicy === undefined ? {} : { emailPolicy }),
  } as unknown as RegistrationOptions & { emailPolicy: string };
  const build = () => {
    const registration = createRegistration(options);
    created.push(registration);
    return registration;
  };
  return { sdk, createClient, fetchFake, build };
}

function expectRefusedBeforeSdk(config: EnabledSupabaseConfig, emailPolicy?: string) {
  const h = harness(config, emailPolicy);
  expect(h.build).toThrow();
  expect(h.createClient).not.toHaveBeenCalled();
  expect(h.fetchFake).not.toHaveBeenCalled();
}

describe('createRegistration production boundaries (mock-only, no real SMTP or phone proof)', () => {
  it('refuses confirmed-email for local and staging configs at construction, before any SDK client or fetch', () => {
    expectRefusedBeforeSdk(
      asConfig({
        enabled: true,
        provider: 'local-supabase',
        apiBaseUrl: 'http://127.0.0.1:8092',
        authUrl: 'http://127.0.0.1:59838',
      }),
      'confirmed-email',
    );
    expectRefusedBeforeSdk(
      asConfig({ enabled: true, provider: 'local-supabase', environment: 'staging', apiBaseUrl: API, authUrl: AUTH }),
      'confirmed-email',
    );
  });

  it('keeps refusing unsafe production configs, unknown policies and the default policy before the factory', () => {
    const { productionAccounts: _omitted, ...withoutAccounts } = PRODUCTION;
    expectRefusedBeforeSdk(asConfig(withoutAccounts), 'confirmed-email');
    expectRefusedBeforeSdk(asConfig({ ...PRODUCTION, authUrl: API }), 'confirmed-email');
    expectRefusedBeforeSdk(asConfig({ ...PRODUCTION, authUrl: 'http://auth.example.org' }), 'confirmed-email');
    expectRefusedBeforeSdk(asConfig({ ...PRODUCTION, authUrl: `${AUTH}/auth/v1` }), 'confirmed-email');
    expectRefusedBeforeSdk(PRODUCTION, 'magic-link');
    expectRefusedBeforeSdk(PRODUCTION);
  });

  it('rejects unconventional addresses with invalid_email and creates no SDK client or request', async () => {
    const h = harness(PRODUCTION, 'confirmed-email');
    const registration = h.build();
    const invalid = ['', ' a@example.org', 'a..b@example.org', 'a b@example.org', 'a@127.0.0.1', `${'a'.repeat(65)}@example.org`];
    for (const email of invalid) {
      await expect(registration.register(email, 'Strong-fixture-password-2026')).rejects.toMatchObject({
        code: 'invalid_email',
      });
    }
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.sdk.signUp).not.toHaveBeenCalled();
    expect(h.fetchFake).not.toHaveBeenCalled();
  });

  it('refuses an auto-confirmed sign-up session and retires it locally instead of adopting it', async () => {
    const h = harness(PRODUCTION, 'confirmed-email');
    h.sdk.signUp.mockResolvedValue({ data: { user: USER, session: SESSION }, error: null });
    const registration = h.build();
    await expect(registration.register(EMAIL, 'Strong-fixture-password-2026')).rejects.toMatchObject({
      code: 'auto_confirm_refused',
    });
    expect(h.sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(h.fetchFake).not.toHaveBeenCalled();
  });

  it('confirms a signup code, retires the session locally and returns a token-free outcome', async () => {
    const h = harness(PRODUCTION, 'confirmed-email');
    const registration = h.build();
    const outcome = await registration.confirm(EMAIL, '482913');
    expect(outcome).toEqual({ status: 'confirmed', signInRequired: true });
    expect(h.sdk.verifyOtp).toHaveBeenCalledTimes(1);
    expect(h.sdk.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: '482913', type: 'signup' });
    expect(h.sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('fixture-access');
    expect(serialized).not.toContain('fixture-refresh');
    expect(h.fetchFake).not.toHaveBeenCalled();
  });

  it('resends the signup code; an accepted request is not proof of inbox delivery', async () => {
    const h = harness(PRODUCTION, 'confirmed-email');
    const registration = h.build();
    await expect(registration.resend(EMAIL)).resolves.toEqual({ status: 'resent' });
    expect(h.sdk.resend).toHaveBeenCalledTimes(1);
    expect(h.sdk.resend).toHaveBeenCalledWith({ type: 'signup', email: EMAIL });
    expect(h.fetchFake).not.toHaveBeenCalled();
  });
});
