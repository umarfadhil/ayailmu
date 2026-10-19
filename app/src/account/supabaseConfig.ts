// The local Supabase Auth account configuration, the default for account sync: the provider named explicitly as
// local-supabase, the loopback account API on port 8092, and the local Auth server, whose endpoints are at the root of
// its own loopback port (never the tokens' logical issuer). A staging build opts in explicitly with
// EXPO_PUBLIC_ACCOUNT_ENV=staging beside the same provider: its API and standalone Auth server are then staging root
// origins (account/staging.ts), never local addresses, and the configuration says environment: 'staging'. Anything
// absent or unsafe, an opt-in that is not exactly "staging" and the legacy Firebase emulator variables on their own
// included, turns account sync off before any client is built; guest learning never depends on it.
import type { DisabledAccountConfig } from '@/account/config';
import { localPilotOrigin, PILOT_API_PORT } from '@/account/loopback';
import { isUnknownAccountEnv, STAGING, STAGING_ORIGIN_RULE, stagingOrigin } from '@/account/staging';

/** The one provider this configuration turns on. */
export const LOCAL_SUPABASE = 'local-supabase';

/** The build-time variables read. Expo inlines EXPO_PUBLIC_* values when it bundles the app. */
export interface SupabaseEnv {
  EXPO_PUBLIC_AUTH_PROVIDER?: string;
  /** Exactly "staging" for a staging build; unset or empty for the local default. */
  EXPO_PUBLIC_ACCOUNT_ENV?: string;
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_AUTH_URL?: string;
}

export interface EnabledSupabaseConfig {
  enabled: true;
  provider: typeof LOCAL_SUPABASE;
  /** Only in a staging build, whose two origins are then staging root origins; absent for the local default. */
  environment?: typeof STAGING;
  /** Normalized origin of the account API, e.g. http://127.0.0.1:8092 (or a staging root origin), with no trailing slash. */
  apiBaseUrl: string;
  /** Normalized origin of the Auth server, whose endpoints are at its root, e.g. http://127.0.0.1:54321 (or a staging root origin). */
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
 * without one, a local Auth root (normalized); with exactly "staging", a staging root origin. Otherwise null.
 */
export function accountAuthOrigin(value: unknown, environment: unknown): string | null {
  if (environment === undefined) return localAuthOrigin(value);
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

/**
 * Reads the local-supabase configuration, in this order so that the first problem is the one named: the provider
 * (exactly local-supabase), the profile (unset or empty for the local default, or exactly staging), the API (http on
 * 127.0.0.1 or localhost, port 8092), then the Auth server (http on 127.0.0.1 or localhost, a port from 1 to 65535).
 * Nothing may follow a port but one root slash. In a staging build the API and the Auth server are staging root origins
 * instead. Anything else turns account sync off instead of throwing, with a reason that names the setting, never its value.
 */
export function loadSupabaseConfig(
  env: SupabaseEnv = {
    EXPO_PUBLIC_AUTH_PROVIDER: process.env.EXPO_PUBLIC_AUTH_PROVIDER,
    EXPO_PUBLIC_ACCOUNT_ENV: process.env.EXPO_PUBLIC_ACCOUNT_ENV,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SUPABASE_AUTH_URL: process.env.EXPO_PUBLIC_SUPABASE_AUTH_URL,
  }
): SupabaseConfig {
  if (env.EXPO_PUBLIC_AUTH_PROVIDER !== LOCAL_SUPABASE) return off('EXPO_PUBLIC_AUTH_PROVIDER', env.EXPO_PUBLIC_AUTH_PROVIDER, LOCAL_SUPABASE);
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
