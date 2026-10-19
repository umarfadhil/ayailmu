// The staging profile of the account services. A staging build opts in explicitly with EXPO_PUBLIC_ACCOUNT_ENV=staging
// (beside the local-supabase provider); its account API, standalone Auth server and web page are then strict canonical
// HTTPS root origins of public DNS names, and a local address never is one. Without the opt-in, local addresses only.
// Every value is matched whole and taken exactly as written, never normalized (no URL parsing: React Native's URL does
// not implement its parts), so an address that would need normalizing is refused.
import { localPilotOrigin, PILOT_API_PORT } from '@/account/loopback';

/** The one account profile besides the local default, exactly as EXPO_PUBLIC_ACCOUNT_ENV and a configuration's environment spell it. */
export const STAGING = 'staging';

/** What a staging root origin is, as a refusal reason states it (never the value). */
export const STAGING_ORIGIN_RULE = 'https, a public DNS name in lower case, no port, nothing after the name';

/**
 * https, then a lower-case ASCII DNS name of at least two labels, and nothing else. Each label is 1 to 63 letters, digits
 * or inner hyphens; the last starts with a letter, so an IPv4 literal never matches. Matched whole, so a port (the default
 * one included), a path or root slash, userinfo, a query, a fragment, percent-encoding, a wildcard, a trailing dot, an
 * IPv6 literal, upper case, whitespace, a control character or a backslash can never match.
 */
const STAGING_ORIGIN = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

/** https:// and the longest DNS name (253 characters). */
const MAX_ORIGIN_LENGTH = 'https://'.length + 253;

/**
 * Last labels that are never public DNS: the special-use localhost, local, test, example, invalid, onion, alt and arpa
 * (home.arpa's), the private-use internal, and names kept for private networks.
 */
const NON_PUBLIC_NAMES = new Set('localhost local test example invalid onion alt arpa internal home lan corp intranet private'.split(' '));

/** `value` exactly as written when it is a staging root origin (https://name, a public DNS name); otherwise null. */
export function stagingOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_ORIGIN_LENGTH) return null;
  const match = STAGING_ORIGIN.exec(value);
  if (match === null) return null;
  const name = match[1];
  return NON_PUBLIC_NAMES.has(name.slice(name.lastIndexOf('.') + 1)) ? null : value;
}

/**
 * Whether EXPO_PUBLIC_ACCOUNT_ENV names no known profile: anything but unset or empty (the local default) or exactly
 * "staging", another case or spacing included. Such a build turns nothing on.
 */
export function isUnknownAccountEnv(value: unknown): boolean {
  return value !== undefined && value !== '' && value !== STAGING;
}

/**
 * The account API origin when `value` is exactly one for the profile `environment`: without one, the local pilot API
 * (normalized); with exactly "staging", a staging root origin. Any other profile allows nothing, so an address is only
 * ever taken together with its own profile.
 */
export function accountApiOrigin(value: unknown, environment: unknown): string | null {
  if (environment === undefined) return localPilotOrigin(value, PILOT_API_PORT);
  return environment === STAGING ? stagingOrigin(value) : null;
}
