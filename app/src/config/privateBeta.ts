// The private tester beta: a frontend capability a build turns on only with every setting below explicit and exact.
// It needs EXPO_PUBLIC_PRIVATE_BETA exactly "on", EXPO_PUBLIC_APP_MODE exactly "tester", the staging account profile
// (EXPO_PUBLIC_ACCOUNT_ENV exactly "staging" beside the local-supabase provider), the production flag exactly "off" and
// the private QA flag off (unset, empty or exactly "off"). Its account API and Auth server are then two distinct staging
// root origins (account/staging.ts), taken as written and never guessed. Anything else turns the beta off, with a reason
// that names the setting, never its value. This capability never approves content (see pilot/unitA/review.ts).
import { STAGING, STAGING_ORIGIN_RULE, stagingOrigin } from '@/account/staging';
import { LOCAL_SUPABASE } from '@/account/supabaseConfig';

/** The one app mode the private beta runs in, exactly as EXPO_PUBLIC_APP_MODE spells it. */
export const TESTER_APP_MODE = 'tester';

/** The build-time variables read. Expo inlines EXPO_PUBLIC_* values when it bundles the app. */
export interface PrivateBetaEnv {
  /** The private beta flag: exactly "on" for a private tester build. */
  EXPO_PUBLIC_PRIVATE_BETA?: string;
  /** Exactly "tester" for a private tester build. */
  EXPO_PUBLIC_APP_MODE?: string;
  /** Exactly "staging" for a private tester build. */
  EXPO_PUBLIC_ACCOUNT_ENV?: string;
  /** Exactly "local-supabase", the provider every account build names. */
  EXPO_PUBLIC_AUTH_PROVIDER?: string;
  /** Exactly "off" for a private tester build. */
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS?: string;
  /** Unset, empty or exactly "off" for a private tester build. */
  EXPO_PUBLIC_PRIVATE_QA?: string;
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_AUTH_URL?: string;
}

export interface EnabledPrivateBetaConfig {
  enabled: true;
  /** The staging account API's root origin, exactly as written. */
  apiBaseUrl: string;
  /** The staging Auth server's root origin, exactly as written, never the account API's. */
  authUrl: string;
}

export interface DisabledPrivateBetaConfig {
  enabled: false;
  reason: string;
}

export type PrivateBetaConfig = EnabledPrivateBetaConfig | DisabledPrivateBetaConfig;

/** The private beta off, with a reason that names the setting and what it must be, never its value. */
function off(setting: keyof PrivateBetaEnv, value: unknown, expected: string): DisabledPrivateBetaConfig {
  const problem = typeof value === 'string' && value !== '' ? `is not ${expected}` : 'is not set';
  return { enabled: false, reason: `${setting} ${problem}, so the private beta is off.` };
}

/**
 * Reads the private beta configuration, in this order so that the first problem is the one named: the beta flag, the
 * app mode, the account profile, the provider, the production flag, the private QA flag, then the account API and the
 * Auth server, each a staging root origin and the two distinct. Anything else turns the beta off instead of throwing.
 */
export function loadPrivateBetaConfig(
  env: PrivateBetaEnv = {
    EXPO_PUBLIC_PRIVATE_BETA: process.env.EXPO_PUBLIC_PRIVATE_BETA,
    EXPO_PUBLIC_APP_MODE: process.env.EXPO_PUBLIC_APP_MODE,
    EXPO_PUBLIC_ACCOUNT_ENV: process.env.EXPO_PUBLIC_ACCOUNT_ENV,
    EXPO_PUBLIC_AUTH_PROVIDER: process.env.EXPO_PUBLIC_AUTH_PROVIDER,
    EXPO_PUBLIC_PRODUCTION_ACCOUNTS: process.env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS,
    EXPO_PUBLIC_PRIVATE_QA: process.env.EXPO_PUBLIC_PRIVATE_QA,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SUPABASE_AUTH_URL: process.env.EXPO_PUBLIC_SUPABASE_AUTH_URL,
  }
): PrivateBetaConfig {
  if (env.EXPO_PUBLIC_PRIVATE_BETA !== 'on') return off('EXPO_PUBLIC_PRIVATE_BETA', env.EXPO_PUBLIC_PRIVATE_BETA, 'exactly "on"');
  if (env.EXPO_PUBLIC_APP_MODE !== TESTER_APP_MODE) return off('EXPO_PUBLIC_APP_MODE', env.EXPO_PUBLIC_APP_MODE, `exactly "${TESTER_APP_MODE}"`);
  if (env.EXPO_PUBLIC_ACCOUNT_ENV !== STAGING) return off('EXPO_PUBLIC_ACCOUNT_ENV', env.EXPO_PUBLIC_ACCOUNT_ENV, `exactly "${STAGING}"`);
  if (env.EXPO_PUBLIC_AUTH_PROVIDER !== LOCAL_SUPABASE) return off('EXPO_PUBLIC_AUTH_PROVIDER', env.EXPO_PUBLIC_AUTH_PROVIDER, LOCAL_SUPABASE);
  if (env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS !== 'off') {
    return off('EXPO_PUBLIC_PRODUCTION_ACCOUNTS', env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS, 'exactly "off" in a private beta build');
  }
  const privateQa = env.EXPO_PUBLIC_PRIVATE_QA;
  if (privateQa !== undefined && privateQa !== '' && privateQa !== 'off') {
    return off('EXPO_PUBLIC_PRIVATE_QA', privateQa, 'unset or exactly "off" in a private beta build');
  }
  const apiBaseUrl = stagingOrigin(env.EXPO_PUBLIC_API_BASE_URL);
  if (!apiBaseUrl) return off('EXPO_PUBLIC_API_BASE_URL', env.EXPO_PUBLIC_API_BASE_URL, `the staging account API (${STAGING_ORIGIN_RULE})`);
  const authUrl = stagingOrigin(env.EXPO_PUBLIC_SUPABASE_AUTH_URL);
  if (!authUrl || authUrl === apiBaseUrl) {
    return off(
      'EXPO_PUBLIC_SUPABASE_AUTH_URL',
      env.EXPO_PUBLIC_SUPABASE_AUTH_URL,
      `the staging Auth server's root (${STAGING_ORIGIN_RULE}, not the account API's origin)`
    );
  }
  return { enabled: true, apiBaseUrl, authUrl };
}
