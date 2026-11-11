import type { EnabledGoogleConfig } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';

import { memoryGoogleStore } from '../google';
import { createSupabaseAuth } from '../supabaseAuth';

// Constructor/local-guard tests only; these are not OAuth acceptance tests.
const PROD = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: 'https://api.example.org',
  authUrl: 'https://auth.example.org',
} as EnabledSupabaseConfig;

const NATIVE = {
  enabled: true,
  provider: 'google',
  platform: 'native',
  callbackUrl: 'arabictrial://account',
} as EnabledGoogleConfig;

const WEB = {
  enabled: true,
  provider: 'google',
  platform: 'web',
  callbackUrl: 'https://learn.example.org/account',
} as EnabledGoogleConfig;

function build(config: EnabledSupabaseConfig, googleConfig?: EnabledGoogleConfig) {
  const fetch = jest.fn().mockRejectedValue(new Error('unexpected network'));
  const createClient = jest.fn(() => {
    throw new Error('unexpected createClient');
  });
  const create = () =>
    createSupabaseAuth({
      config,
      fetch,
      createClient,
      ...(googleConfig ? { google: { config: googleConfig, store: memoryGoogleStore() } } : {}),
    });
  return { fetch, createClient, create };
}

describe('production Google auth constructor', () => {
  test.each([
    ['native', NATIVE],
    ['web', WEB],
  ])('accepts a valid %s Google config without building an SDK client or fetching', (_name, googleConfig) => {
    const { fetch, createClient, create } = build(PROD, googleConfig);
    let auth!: ReturnType<typeof createSupabaseAuth>;
    expect(() => {
      auth = create();
    }).not.toThrow();
    expect(auth.google).toBeDefined();
    expect(createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    ['native wrong route', { ...NATIVE, callbackUrl: 'arabictrial://other' }],
    ['web query', { ...WEB, callbackUrl: 'https://learn.example.org/account?next=/x' }],
  ])('refuses an unsafe Google callback (%s) before any client or network', (_name, unsafe) => {
    const { fetch, createClient, create } = build(PROD, unsafe as EnabledGoogleConfig);
    expect(create).toThrow();
    expect(createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('refuses a production config missing the productionAccounts capability', () => {
    const forged = { ...PROD } as Record<string, unknown>;
    delete forged.productionAccounts;
    const { fetch, createClient, create } = build(forged as unknown as EnabledSupabaseConfig, NATIVE);
    expect(create).toThrow();
    expect(createClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('valid production config without Google yields no google and no fetch', () => {
    const { fetch, create } = build(PROD);
    expect(create().google).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
