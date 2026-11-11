import { createRegistration, type RegistrationOptions, type RegistrationSdkClient } from '@/auth/registration';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';

// Mock-only: the SDK boundary and fetch are fakes, so this proves the adapter's handling of a production sign-up answer,
// never real SMTP delivery, phone confirmation or a reachable production Auth server. The fixture roots are reserved and
// never requested.
const PRODUCTION_CONFIG: EnabledSupabaseConfig = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: 'https://api.example.org',
  authUrl: 'https://auth.example.org',
};

describe('createRegistration (production, confirmed-email policy; mock-only, no real SMTP or phone proof)', () => {
  it('signs a conventional address up and resolves confirmation_required when the policy is explicitly confirmed-email', async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: { user: { id: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', email: 'learner@example.org' }, session: null },
      error: null,
    });
    const sdk = {
      signUp,
      verifyOtp: jest.fn(() => {
        throw new Error('verifyOtp must not be called by register');
      }),
      resend: jest.fn(() => {
        throw new Error('resend must not be called by register');
      }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      stopAutoRefresh: jest.fn().mockResolvedValue(undefined),
    } as unknown as RegistrationSdkClient;
    const createClient = jest.fn(() => sdk);
    const fetchFake = jest.fn(() => {
      throw new Error('no network in this test');
    }) as unknown as typeof fetch;

    const options = {
      config: PRODUCTION_CONFIG,
      createClient,
      fetch: fetchFake,
      emailPolicy: 'confirmed-email',
    } as RegistrationOptions & { emailPolicy: 'confirmed-email' };

    let registration: ReturnType<typeof createRegistration> | undefined;
    try {
      registration = createRegistration(options);
      await expect(registration.register('learner@example.org', 'Strong-fixture-password-2026')).resolves.toEqual({
        status: 'confirmation_required',
      });
      expect(createClient).toHaveBeenCalled();
      expect(signUp).toHaveBeenCalledTimes(1);
      expect(signUp).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'learner@example.org', password: 'Strong-fixture-password-2026' }),
      );
    } finally {
      await registration?.dispose();
    }
  });
});
