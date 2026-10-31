import { loadSupabaseConfig, type SupabaseEnv } from '@/account/supabaseConfig';
import { registrationPolicy } from '@/ui/account/registrationController';

export interface NormalStarterEnv extends SupabaseEnv {
  EXPO_PUBLIC_NORMAL_USER_STARTER?: string;
  EXPO_PUBLIC_REMEMBER_DEVICE?: string;
}

// Build eligibility ONLY. A build that passes here is not review-approved: it
// must still pass the unchanged starterReviewAccess check elsewhere. This module
// never touches content, review, or pending records, and starterBetaBuild stays
// closed to the two older profiles.

// Each flag must equal one of its exact values; anything else is ineligible.
// GOOGLE_SIGN_IN and PASSWORD_RECOVERY are optional capability REQUESTS: "on" or
// "off" are both eligible, so an optional feature never bars study. Whether a
// requested capability is actually available (platform, config, crypto, store) is
// decided by the account layer, not here.
const REQUIRED_FLAGS: readonly (readonly [string, readonly string[]])[] = [
  ['EXPO_PUBLIC_NORMAL_USER_STARTER', ['on']],
  ['EXPO_PUBLIC_APP_MODE', ['tester']],
  ['EXPO_PUBLIC_AUTH_PROVIDER', ['local-supabase']],
  ['EXPO_PUBLIC_ACCOUNT_ENV', ['production']],
  ['EXPO_PUBLIC_PRODUCTION_ACCOUNTS', ['on']],
  ['EXPO_PUBLIC_ACCOUNT_REGISTRATION', ['confirmed-email']],
  ['EXPO_PUBLIC_PRIVATE_QA', ['off']],
  ['EXPO_PUBLIC_PRIVATE_BETA', ['off']],
  ['EXPO_PUBLIC_LEARNING_BETA', ['off']],
  ['EXPO_PUBLIC_GOOGLE_SIGN_IN', ['on', 'off']],
  ['EXPO_PUBLIC_PASSWORD_RECOVERY', ['on', 'off']],
  ['EXPO_PUBLIC_REMEMBER_DEVICE', ['on', 'off']],
];

// Expo only inlines literal `process.env.EXPO_PUBLIC_*` member accesses, so every
// key is named explicitly here rather than spreading or indexing process.env.
function processEnvSnapshot(): NormalStarterEnv {
  return {
    EXPO_PUBLIC_NORMAL_USER_STARTER: process.env.EXPO_PUBLIC_NORMAL_USER_STARTER,
    EXPO_PUBLIC_APP_MODE: process.env.EXPO_PUBLIC_APP_MODE,
    EXPO_PUBLIC_AUTH_PROVIDER: process.env.EXPO_PUBLIC_AUTH_PROVIDER,
    EXPO_PUBLIC_ACCOUNT_ENV: process.env.EXPO_PUBLIC_ACCOUNT_ENV,
    EXPO_PUBLIC_PRODUCTION_ACCOUNTS: process.env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS,
    EXPO_PUBLIC_ACCOUNT_REGISTRATION: process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION,
    EXPO_PUBLIC_PRIVATE_QA: process.env.EXPO_PUBLIC_PRIVATE_QA,
    EXPO_PUBLIC_PRIVATE_BETA: process.env.EXPO_PUBLIC_PRIVATE_BETA,
    EXPO_PUBLIC_LEARNING_BETA: process.env.EXPO_PUBLIC_LEARNING_BETA,
    EXPO_PUBLIC_GOOGLE_SIGN_IN: process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN,
    EXPO_PUBLIC_PASSWORD_RECOVERY: process.env.EXPO_PUBLIC_PASSWORD_RECOVERY,
    EXPO_PUBLIC_REMEMBER_DEVICE: process.env.EXPO_PUBLIC_REMEMBER_DEVICE,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SUPABASE_AUTH_URL: process.env.EXPO_PUBLIC_SUPABASE_AUTH_URL,
  };
}

export function normalStarterBuild(
  env: NormalStarterEnv = processEnvSnapshot(),
): boolean {
  try {
    if (typeof env !== 'object' || env === null) return false;
    const values = env as Readonly<Record<string, unknown>>;

    for (const [key, accepted] of REQUIRED_FLAGS) {
      const value = values[key];
      if (typeof value !== 'string' || !accepted.includes(value)) return false;
    }

    // Origin and production-config validation stays in the existing loader.
    const config = loadSupabaseConfig(env);
    if (
      config.enabled !== true ||
      config.environment !== 'production' ||
      config.productionAccounts !== true ||
      config.privateQa !== undefined ||
      config.learningBeta !== undefined
    ) {
      return false;
    }

    return (
      registrationPolicy(config, env.EXPO_PUBLIC_ACCOUNT_REGISTRATION) ===
      'confirmed-email'
    );
  } catch {
    return false;
  }
}
