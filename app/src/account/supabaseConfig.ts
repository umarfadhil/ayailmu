// The account configuration: the account API and a standalone Supabase Auth server (GoTrue), whose endpoints are at the
// root of its own origin (never a hosted /auth/v1 prefix, never the tokens' logical issuer). Every build names the
// provider explicitly as local-supabase, a retained legacy name for that standalone GoTrue whatever the profile.
// - The local default (EXPO_PUBLIC_ACCOUNT_ENV unset or empty): the loopback account API on port 8092 and a loopback Auth
//   server; the configuration has no environment.
// - A staging build opts in with EXPO_PUBLIC_ACCOUNT_ENV exactly "staging": its API and Auth server are then staging root
//   origins (account/staging.ts), never local addresses, and the configuration says environment: 'staging'.
// - A production build needs both EXPO_PUBLIC_ACCOUNT_ENV exactly "production" and EXPO_PUBLIC_PRODUCTION_ACCOUNTS
//   exactly "on"; neither alone turns production on (the production profile without the flag is refused as an unknown
//   one, and the flag changes nothing in a local or staging build). Its API and Auth server are two distinct strict
//   canonical HTTPS root origins of public DNS names, and the configuration says environment: 'production' with
//   productionAccounts: true.
// Anything absent or unsafe, any other profile and the legacy Firebase emulator variables on their own included, turns
// account sync off before any client is built; guest learning never depends on it.
import type { DisabledAccountConfig } from '@/account/config';
import { localPilotOrigin, PILOT_API_PORT } from '@/account/loopback';
import { isUnknownAccountEnv, STAGING, STAGING_ORIGIN_RULE, stagingOrigin } from '@/account/staging';

/** The one provider this configuration turns on: a retained legacy name for a standalone GoTrue at its root, in every profile. */
export const LOCAL_SUPABASE = 'local-supabase';

/** The build-time variables read. Expo inlines EXPO_PUBLIC_* values when it bundles the app. */
export interface SupabaseEnv {
  EXPO_PUBLIC_AUTH_PROVIDER?: string;
  /** Exactly "staging" for a staging build, or exactly "production" (with the production flag) for a production one; unset or empty for the local default. */
  EXPO_PUBLIC_ACCOUNT_ENV?: string;
  /** The production flag: exactly "on", beside EXPO_PUBLIC_ACCOUNT_ENV=production, for a production build; no effect for another profile. */
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS?: string;
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_AUTH_URL?: string;
}

export interface EnabledSupabaseConfig {
  enabled: true;
  provider: typeof LOCAL_SUPABASE;
  /** 'staging' in a staging build and 'production' in a production one, whose two origins are then public root origins; absent for the local default. */
  environment?: typeof STAGING | 'production';
  /** Only in a production build, and then exactly true: the explicit capability the API client and the Auth adapter require beside 'production'. */
  productionAccounts?: true;
  /** Normalized origin of the account API, e.g. http://127.0.0.1:8092 (or a staging or production root origin), with no trailing slash. */
  apiBaseUrl: string;
  /** Normalized origin of the Auth server, whose endpoints are at its root, e.g. http://127.0.0.1:54321 (or a staging or production root origin). */
  authUrl: string;
}

export type SupabaseConfig = EnabledSupabaseConfig | DisabledAccountConfig;

/**
 * http, a loopback host, a port from 1 to 65535 (no leading zero), and at most a root slash. Matched whole, so
 * credentials, another host, a path (the hosted /auth/v1 prefix included), a query or a fragment can never match.
 */
const LOCAL_AUTH_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):([1-9]\d{0,4})\/?$/;

/** The normalized origin (http://host:port) when `value` is exactly the root of a local Auth server; otherwise null. */
export function localAuthOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = LOCAL_AUTH_ORIGIN.exec(value);
  return match !== null && Number(match[2]) <= 65535 ? `http://${match[1]}:${match[2]}` : null;
}

/**
 * The Auth server's root when `value` is exactly one for the profile `environment`, as accountApiOrigin is for the API:
 * without one, a local Auth root (normalized); with exactly "staging", a staging root origin; with exactly "production"
 * and the explicit capability `productionAccounts` exactly true, a public root origin as in staging. Otherwise null.
 */
export function accountAuthOrigin(value: unknown, environment: unknown, productionAccounts?: unknown): string | null {
  if (environment === undefined) return localAuthOrigin(value);
  if (environment === 'production') return productionAccounts === true ? stagingOrigin(value) : null;
  return environment === STAGING ? stagingOrigin(value) : null;
}

/** Account sync off, with a reason that names the setting and what it must be, never its value. */
function off(setting: keyof SupabaseEnv, value: unknown, expected: string): DisabledAccountConfig {
  const problem = typeof value === 'string' && value !== '' ? `is not ${expected}` : 'is not set';
  return { enabled: false, reason: `${setting} ${problem}, so account sync is off.` };
}

/** A staging build's configuration: the API, then the Auth server, each a staging root origin (so never a local address). */
function loadStagingConfig(env: SupabaseEnv): SupabaseConfig {
  const apiBaseUrl = stagingOrigin(env.EXPO_PUBLIC_API_BASE_URL);
  if (!apiBaseUrl) return off('EXPO_PUBLIC_API_BASE_URL', env.EXPO_PUBLIC_API_BASE_URL, `the staging account API (${STAGING_ORIGIN_RULE})`);
  const authUrl = stagingOrigin(env.EXPO_PUBLIC_SUPABASE_AUTH_URL);
  if (!authUrl) return off('EXPO_PUBLIC_SUPABASE_AUTH_URL', env.EXPO_PUBLIC_SUPABASE_AUTH_URL, `the staging Auth server's root (${STAGING_ORIGIN_RULE})`);
  return { enabled: true, provider: LOCAL_SUPABASE, environment: STAGING, apiBaseUrl, authUrl };
}

/** A production build's configuration: the API, then the Auth server on another origin, each a public root origin (so never a local address). */
function loadProductionConfig(env: SupabaseEnv): SupabaseConfig {
  const apiBaseUrl = stagingOrigin(env.EXPO_PUBLIC_API_BASE_URL);
  if (!apiBaseUrl) return off('EXPO_PUBLIC_API_BASE_URL', env.EXPO_PUBLIC_API_BASE_URL, `the production account API (${STAGING_ORIGIN_RULE})`);
  const authUrl = stagingOrigin(env.EXPO_PUBLIC_SUPABASE_AUTH_URL);
  if (!authUrl || authUrl === apiBaseUrl) {
    return off(
      'EXPO_PUBLIC_SUPABASE_AUTH_URL',
      env.EXPO_PUBLIC_SUPABASE_AUTH_URL,
      `the production Auth server's root (${STAGING_ORIGIN_RULE}, not the account API's origin)`
    );
  }
  return { enabled: true, provider: LOCAL_SUPABASE, environment: 'production', productionAccounts: true, apiBaseUrl, authUrl };
}

/**
 * Reads the account configuration, in this order so that the first problem is the one named: the provider (exactly
 * local-supabase); then a production build, only with the profile exactly production and the production flag exactly
 * on, whose API and Auth server are two distinct strict public HTTPS root origins; then the profile (unset or empty for
 * the local default, or exactly staging; any other value is refused, the production profile without its flag included);
 * then the API (http on 127.0.0.1 or localhost, port 8092) and the Auth server (http on 127.0.0.1 or localhost, a port
 * from 1 to 65535), where nothing may follow a port but one root slash. In a staging build the API and the Auth server
 * are staging root origins instead. Anything else turns account sync off instead of throwing, with a reason that names
 * the setting, never its value.
 */
export function loadSupabaseConfig(
  env: SupabaseEnv = {
    EXPO_PUBLIC_AUTH_PROVIDER: process.env.EXPO_PUBLIC_AUTH_PROVIDER,
    EXPO_PUBLIC_ACCOUNT_ENV: process.env.EXPO_PUBLIC_ACCOUNT_ENV,
    EXPO_PUBLIC_PRODUCTION_ACCOUNTS: process.env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SUPABASE_AUTH_URL: process.env.EXPO_PUBLIC_SUPABASE_AUTH_URL,
  }
): SupabaseConfig {
  if (env.EXPO_PUBLIC_AUTH_PROVIDER !== LOCAL_SUPABASE) return off('EXPO_PUBLIC_AUTH_PROVIDER', env.EXPO_PUBLIC_AUTH_PROVIDER, LOCAL_SUPABASE);
  if (env.EXPO_PUBLIC_ACCOUNT_ENV === 'production' && env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS === 'on') return loadProductionConfig(env);
  if (isUnknownAccountEnv(env.EXPO_PUBLIC_ACCOUNT_ENV)) {
    return off('EXPO_PUBLIC_ACCOUNT_ENV', env.EXPO_PUBLIC_ACCOUNT_ENV, `exactly "${STAGING}" (or unset for the local build)`);
  }
  if (env.EXPO_PUBLIC_ACCOUNT_ENV === STAGING) return loadStagingConfig(env);
  const apiBaseUrl = localPilotOrigin(env.EXPO_PUBLIC_API_BASE_URL, PILOT_API_PORT);
  if (!apiBaseUrl) {
    return off(
      'EXPO_PUBLIC_API_BASE_URL',
      env.EXPO_PUBLIC_API_BASE_URL,
      `the local account API (http on 127.0.0.1 or localhost, port ${PILOT_API_PORT}, nothing after the port)`
    );
  }
  const authUrl = localAuthOrigin(env.EXPO_PUBLIC_SUPABASE_AUTH_URL);
  if (!authUrl) {
    return off(
      'EXPO_PUBLIC_SUPABASE_AUTH_URL',
      env.EXPO_PUBLIC_SUPABASE_AUTH_URL,
      "the local Auth server's root (http on 127.0.0.1 or localhost, a port from 1 to 65535, nothing after the port)"
    );
  }
  return { enabled: true, provider: LOCAL_SUPABASE, apiBaseUrl, authUrl };
}
