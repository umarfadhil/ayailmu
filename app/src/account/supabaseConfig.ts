// The local Supabase Auth account configuration, the default for account sync: the provider named explicitly as
// local-supabase, the loopback account API on port 8092, and the local Auth server, whose endpoints are at the root of
// its own loopback port (never the tokens' logical issuer). Anything absent or unsafe, the legacy Firebase emulator
// variables on their own included, turns account sync off before any client is built; guest learning never depends on it.
import type { DisabledAccountConfig } from '@/account/config';
import { localPilotOrigin, PILOT_API_PORT } from '@/account/loopback';

/** The one provider this configuration turns on. */
export const LOCAL_SUPABASE = 'local-supabase';

/** The build-time variables read. Expo inlines EXPO_PUBLIC_* values when it bundles the app. */
export interface SupabaseEnv {
  EXPO_PUBLIC_AUTH_PROVIDER?: string;
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_AUTH_URL?: string;
}

export interface EnabledSupabaseConfig {
  enabled: true;
  provider: typeof LOCAL_SUPABASE;
  /** Normalized origin of the account API, e.g. http://127.0.0.1:8092, with no trailing slash. */
  apiBaseUrl: string;
  /** Normalized origin of the local Auth server, whose endpoints are at its root, e.g. http://127.0.0.1:54321. */
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

/** Account sync off, with a reason that names the setting and what it must be, never its value. */
function off(setting: keyof SupabaseEnv, value: unknown, expected: string): DisabledAccountConfig {
  const problem = typeof value === 'string' && value !== '' ? `is not ${expected}` : 'is not set';
  return { enabled: false, reason: `${setting} ${problem}, so account sync is off.` };
}

/**
 * Reads the local-supabase configuration, in this order so that the first problem is the one named: the provider
 * (exactly local-supabase), the API (http on 127.0.0.1 or localhost, port 8092), then the Auth server (http on
 * 127.0.0.1 or localhost, a port from 1 to 65535). Nothing may follow a port but one root slash. Anything else turns
 * account sync off instead of throwing, with a reason that names the setting, never its value.
 */
export function loadSupabaseConfig(
  env: SupabaseEnv = {
    EXPO_PUBLIC_AUTH_PROVIDER: process.env.EXPO_PUBLIC_AUTH_PROVIDER,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SUPABASE_AUTH_URL: process.env.EXPO_PUBLIC_SUPABASE_AUTH_URL,
  }
): SupabaseConfig {
  if (env.EXPO_PUBLIC_AUTH_PROVIDER !== LOCAL_SUPABASE) return off('EXPO_PUBLIC_AUTH_PROVIDER', env.EXPO_PUBLIC_AUTH_PROVIDER, LOCAL_SUPABASE);
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
