// Production account configuration, RED. A production build opts in with both EXPO_PUBLIC_ACCOUNT_ENV=production and
// EXPO_PUBLIC_PRODUCTION_ACCOUNTS=on beside the existing explicit self-hosted provider (EXPO_PUBLIC_AUTH_PROVIDER=local-supabase,
// a standalone GoTrue at its root). The host names are fictional placeholders (example.org): nothing here contacts anything.
import { loadSupabaseConfig } from '@/account/supabaseConfig';

const PRODUCTION_API = 'https://api.example.org';
const PRODUCTION_AUTH = 'https://auth.example.org';

describe('with both production opt-ins', () => {
  it('the production API and Auth root origins turn account sync on, marked production with the productionAccounts capability', () => {
    const env = {
      EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
      EXPO_PUBLIC_ACCOUNT_ENV: 'production',
      EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
      EXPO_PUBLIC_API_BASE_URL: PRODUCTION_API,
      EXPO_PUBLIC_SUPABASE_AUTH_URL: PRODUCTION_AUTH,
    };
    expect(loadSupabaseConfig(env)).toMatchObject({
      enabled: true,
      provider: 'local-supabase',
      environment: 'production',
      productionAccounts: true,
      apiBaseUrl: PRODUCTION_API,
      authUrl: PRODUCTION_AUTH,
    });
  });
});
