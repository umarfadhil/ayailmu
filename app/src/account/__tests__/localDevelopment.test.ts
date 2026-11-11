import { loadSupabaseConfig, type EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { accountApiOrigin } from '@/account/staging';
import { accountAuthOrigin } from '@/account/supabaseConfig';
import { normalStarterBuild } from '@/config/normalStarter';
import { registrationPolicy } from '@/ui/account/registrationController';
import { registrationEmailRefusal } from '@/auth/registration';
import { starterReviewAccess } from '@/pilot/unitA/review';

const API = 'https://localhost:58444';
const AUTH = 'https://localhost:58445';
export const LOCAL_DEVELOPMENT_ENV = {
  EXPO_PUBLIC_APP_MODE: 'tester', EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'local-development', EXPO_PUBLIC_LOCAL_DEVELOPMENT: 'on',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off', EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_PRIVATE_BETA: 'off', EXPO_PUBLIC_LEARNING_BETA: 'off',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'confirmed-email', EXPO_PUBLIC_NORMAL_USER_STARTER: 'on',
  EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off', EXPO_PUBLIC_PASSWORD_RECOVERY: 'off',
  EXPO_PUBLIC_REMEMBER_DEVICE: 'on', EXPO_PUBLIC_API_BASE_URL: API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH,
};

describe('explicit normal local-development accounts (no network)', () => {
  it('enables only its own capability with the two exact HTTPS loopback roots', () => {
    expect(loadSupabaseConfig(LOCAL_DEVELOPMENT_ENV)).toEqual({
      enabled: true, provider: 'local-supabase', environment: 'local-development',
      localDevelopment: true, apiBaseUrl: API, authUrl: AUTH,
    });
  });

  it.each(['http://localhost:58444','https://127.0.0.1:58444','https://localhost:58444/',
    'https://localhost:58445','https://api.example.org','https://localhost:58444.evil.org'])('refuses API drift %s', (value) => {
    expect(loadSupabaseConfig({...LOCAL_DEVELOPMENT_ENV,EXPO_PUBLIC_API_BASE_URL:value}).enabled).toBe(false);
  });

  it.each(['http://localhost:58445','https://127.0.0.1:58445','https://localhost:58445/',
    'https://localhost:58444','https://auth.example.org'])('refuses Auth drift %s', (value) => {
    expect(loadSupabaseConfig({...LOCAL_DEVELOPMENT_ENV,EXPO_PUBLIC_SUPABASE_AUTH_URL:value}).enabled).toBe(false);
  });

  it.each(['EXPO_PUBLIC_LOCAL_DEVELOPMENT','EXPO_PUBLIC_PRODUCTION_ACCOUNTS','EXPO_PUBLIC_PRIVATE_QA',
    'EXPO_PUBLIC_PRIVATE_BETA','EXPO_PUBLIC_LEARNING_BETA','EXPO_PUBLIC_APP_MODE','EXPO_PUBLIC_GOOGLE_SIGN_IN',
    'EXPO_PUBLIC_PASSWORD_RECOVERY','EXPO_PUBLIC_ACCOUNT_REGISTRATION'])('fails closed when %s conflicts', (key) => {
    expect(loadSupabaseConfig({...LOCAL_DEVELOPMENT_ENV,[key]:'bogus'}).enabled).toBe(false);
  });

  it('revalidates profile/capability/origins at the API and Auth boundaries', () => {
    expect(accountApiOrigin(API,'local-development',undefined,undefined,undefined,true)).toBe(API);
    expect(accountAuthOrigin(AUTH,'local-development',undefined,undefined,undefined,true)).toBe(AUTH);
    expect(accountApiOrigin(API,'local-development')).toBeNull();
    expect(accountAuthOrigin(AUTH,'production',true,undefined,undefined,true)).toBeNull();
    expect(accountApiOrigin(API,'production',true)).toBeNull();
    expect(accountAuthOrigin(AUTH,'production',true)).toBeNull();
  });

  it('offers conventional confirmed-email signup without an owner allowlist or synthetic policy', () => {
    const config = loadSupabaseConfig(LOCAL_DEVELOPMENT_ENV);
    expect(registrationPolicy(config,'confirmed-email')).toBe('confirmed-email');
    expect(registrationPolicy(config,'on')).toBeNull();
    expect(registrationPolicy(config,'private-qa-confirmed-email')).toBeNull();
    expect(registrationEmailRefusal('first@example.org','confirmed-email')).toBeNull();
    expect(registrationEmailRefusal('second@example.net','confirmed-email')).toBeNull();
    expect(registrationEmailRefusal('not an email','confirmed-email')).toBe('invalid_email');
    const forged = {...config,environment:'production'} as EnabledSupabaseConfig;
    expect(registrationPolicy(forged,'confirmed-email')).toBeNull();
  });

  it('makes the normal starter eligible only through the unchanged real review gate', () => {
    expect(normalStarterBuild(LOCAL_DEVELOPMENT_ENV)).toBe(true);
    expect(starterReviewAccess().allowed).toBe(true);
    expect(normalStarterBuild({...LOCAL_DEVELOPMENT_ENV,EXPO_PUBLIC_NORMAL_USER_STARTER:'off'})).toBe(false);
    expect(normalStarterBuild({...LOCAL_DEVELOPMENT_ENV,EXPO_PUBLIC_LOCAL_DEVELOPMENT:'off'})).toBe(false);
  });
});
