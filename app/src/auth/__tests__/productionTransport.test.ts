// Production account transports, RED. Under the explicit production opt-in (EXPO_PUBLIC_ACCOUNT_ENV=production with
// EXPO_PUBLIC_PRODUCTION_ACCOUNTS=on), the account API client and the standalone GoTrue client take the configuration's
// two public root origins, as they take staging's. The host names are fictional placeholders (example.org): constructing
// a client contacts nothing, so fetch is never called.
import { createApiClient } from '@/api/client';
import { createSupabaseAuth } from '@/auth/supabaseAuth';

const PRODUCTION_API = 'https://api.example.org';
const PRODUCTION_AUTH = 'https://auth.example.org';

describe('with the production configuration', () => {
  it('the account API client takes the production API root origin, contacting nothing', () => {
    const options = { baseUrl: PRODUCTION_API, environment: 'production', productionAccounts: true, fetch: jest.fn() } as const;
    expect(() => createApiClient(options)).not.toThrow();
    expect(options.fetch).not.toHaveBeenCalled();
  });

  it('the standalone GoTrue client takes the production configuration, contacting nothing', () => {
    const config = {
      enabled: true,
      provider: 'local-supabase',
      environment: 'production',
      productionAccounts: true,
      apiBaseUrl: PRODUCTION_API,
      authUrl: PRODUCTION_AUTH,
    } as const;
    const options = { config, fetch: jest.fn() };
    expect(() => createSupabaseAuth(options)).not.toThrow();
    expect(options.fetch).not.toHaveBeenCalled();
  });
});
