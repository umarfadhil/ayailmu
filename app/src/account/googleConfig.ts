// Continue with Google's build configuration. Google sign-in rides on the Supabase Auth configuration of the build's
// account profile and is off unless the build opts in explicitly with the exact callback of the platform it runs on: on
// the web, the account route on this page's own loopback origin (the tab that started an attempt keeps its record, so the
// callback must come back to it), or in a staging build (EXPO_PUBLIC_ACCOUNT_ENV=staging) or a production build
// (EXPO_PUBLIC_ACCOUNT_ENV=production, which also needs EXPO_PUBLIC_PRODUCTION_ACCOUNTS=on) on this page's own public
// HTTPS root origin, so a web callback never crosses profiles; on native, whatever the profile, the app's scheme
// (app.json) and its account route, in a build that can run the system browser's auth session (not Expo Go, whose
// reason is reported as it is). The app never holds a Google client ID or secret: the Auth server does. Anything absent
// or unsafe keeps it off with a reason that names the setting, never its value.
import type { DisabledAccountConfig } from '@/account/config';
import { isUnknownAccountEnv, STAGING, stagingOrigin } from '@/account/staging';

/** The one external provider this configuration turns on. */
export const GOOGLE = 'google';
/** The native callback: the app's scheme and its account route. */
export const GOOGLE_NATIVE_CALLBACK = 'arabictrial://account';
/** The account route, where the web callback lands. */
export const GOOGLE_WEB_CALLBACK_PATH = '/account';

/** The build-time variables read. Expo inlines EXPO_PUBLIC_* values when it bundles the app; none is a secret. */
export interface GoogleEnv {
  /** Exactly "on" to offer Continue with Google. */
  EXPO_PUBLIC_GOOGLE_SIGN_IN?: string;
  /**
   * Exactly "staging" for a staging build (its web callback on its staging page), exactly "production" for a production
   * build (which also needs EXPO_PUBLIC_PRODUCTION_ACCOUNTS); unset or empty for the local default.
   */
  EXPO_PUBLIC_ACCOUNT_ENV?: string;
  /** Exactly "on" to allow Google sign-in in a production build; any other value, or none, keeps a production build off. */
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS?: string;
  /** The web callback: http, this page's loopback origin (in a staging or production build, its public HTTPS root origin), the account route; nothing else. */
  EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL?: string;
  /** The native callback: exactly GOOGLE_NATIVE_CALLBACK. */
  EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL?: string;
}

/** Where the app runs, as the platform's Google browser reports it. */
export type GooglePlatform =
  | {
      kind: 'web';
      /** This page's origin, e.g. http://localhost:8081: the web callback must be on it (its tab keeps the attempt). */
      origin: string;
    }
  | {
      kind: 'native';
      /** Why the system browser's auth session cannot run in this build (Expo Go, a missing module), or null. */
      unavailable: string | null;
    };

export interface EnabledGoogleConfig {
  enabled: true;
  provider: typeof GOOGLE;
  platform: 'web' | 'native';
  /** The exact URL the Auth server sends the browser back to; nothing else is ever accepted as a callback. */
  callbackUrl: string;
}

export type GoogleConfig = EnabledGoogleConfig | DisabledAccountConfig;

/**
 * http, a loopback host, a port from 1 to 65535 (no leading zero), then exactly the account route. Matched whole, so
 * credentials, another host, another path, a query or a fragment can never match (no URL parsing: React Native's URL
 * does not implement its parts).
 */
const WEB_CALLBACK = /^http:\/\/(127\.0\.0\.1|localhost):([1-9]\d{0,4})\/account$/;

/** The origin (http://host:port) of `value` when it is exactly a web callback; otherwise null. */
export function googleWebCallbackOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = WEB_CALLBACK.exec(value);
  return match !== null && Number(match[2]) <= 65535 ? `http://${match[1]}:${match[2]}` : null;
}

/** The origin of `value` when it is exactly a staging web callback: a staging root origin, then the account route; otherwise null. */
export function stagingWebCallbackOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value.endsWith(GOOGLE_WEB_CALLBACK_PATH)) return null;
  return stagingOrigin(value.slice(0, value.length - GOOGLE_WEB_CALLBACK_PATH.length));
}

/** The account profile of a production build; it needs the explicit production-accounts capability on top of the profile. */
const PRODUCTION = 'production';

/**
 * The origin of `value` when it is exactly a web callback of the profile `environment` (none: local; "staging" or
 * "production": a public HTTPS root origin, then the account route); otherwise null.
 */
function webCallbackOrigin(value: unknown, environment: unknown): string | null {
  if (environment === undefined) return googleWebCallbackOrigin(value);
  return environment === STAGING || environment === PRODUCTION ? stagingWebCallbackOrigin(value) : null;
}

/**
 * Whether the profile `environment` and the production-accounts capability `productionAccounts` go together: production
 * only with exactly true; local (absent) and staging only with the capability absent. Nothing crosses over.
 */
function profileAllowed(environment: unknown, productionAccounts: unknown): boolean {
  if (environment === PRODUCTION) return productionAccounts === true;
  return (environment === undefined || environment === STAGING) && productionAccounts === undefined;
}

/**
 * Whether `config` is a Google configuration this module could have produced for the account profile `environment`
 * (absent: the local default; exactly "staging": a staging build; exactly "production": a production build, only with
 * `productionAccounts` exactly true, and with it absent for the other two). The Auth adapter revalidates with it under
 * its own configuration's profile, so a web callback never crosses profiles; the native callback is the same under all
 * of them. The production web callback is any canonical public HTTPS root origin and the account route: this predicate
 * cannot know the page's origin, so the loader compares it.
 */
export function isSafeGoogleConfig(
  config: unknown,
  environment?: unknown,
  productionAccounts?: unknown
): config is EnabledGoogleConfig {
  if (typeof config !== 'object' || config === null) return false;
  const c = config as Partial<Record<keyof EnabledGoogleConfig, unknown>>;
  if (c.enabled !== true || c.provider !== GOOGLE || !profileAllowed(environment, productionAccounts)) return false;
  if (c.platform === 'native') return c.callbackUrl === GOOGLE_NATIVE_CALLBACK;
  return c.platform === 'web' && webCallbackOrigin(c.callbackUrl, environment) !== null;
}

/** Google sign-in off, with a reason that names the setting and what it must be, never its value. */
function off(setting: keyof GoogleEnv, value: unknown, expected: string): DisabledAccountConfig {
  const problem = typeof value === 'string' && value !== '' ? `is not ${expected}` : 'is not set';
  return { enabled: false, reason: `${setting} ${problem}, so Google sign-in is off.` };
}

/**
 * Reads the Google configuration for `platform`: the explicit opt-in, the build's profile (unset or empty for the local
 * default, exactly staging, or exactly production, which also needs EXPO_PUBLIC_PRODUCTION_ACCOUNTS exactly "on"), then
 * that platform's callback (and, on native, whether the build can run the system browser's auth session, reported with
 * its own reason). Anything else keeps Google sign-in off instead of throwing, with a reason that names the setting,
 * never its value.
 */
export function loadGoogleConfig(
  platform: GooglePlatform,
  env: GoogleEnv = {
    EXPO_PUBLIC_GOOGLE_SIGN_IN: process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN,
    EXPO_PUBLIC_ACCOUNT_ENV: process.env.EXPO_PUBLIC_ACCOUNT_ENV,
    EXPO_PUBLIC_PRODUCTION_ACCOUNTS: process.env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS,
    EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: process.env.EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL,
    EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: process.env.EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL,
  }
): GoogleConfig {
  if (env.EXPO_PUBLIC_GOOGLE_SIGN_IN !== 'on') return off('EXPO_PUBLIC_GOOGLE_SIGN_IN', env.EXPO_PUBLIC_GOOGLE_SIGN_IN, 'exactly "on"');
  const accountEnv = env.EXPO_PUBLIC_ACCOUNT_ENV;
  if (accountEnv === PRODUCTION) {
    if (env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS !== 'on') {
      return off('EXPO_PUBLIC_PRODUCTION_ACCOUNTS', env.EXPO_PUBLIC_PRODUCTION_ACCOUNTS, 'exactly "on"');
    }
  } else if (isUnknownAccountEnv(accountEnv)) {
    return off('EXPO_PUBLIC_ACCOUNT_ENV', accountEnv, `exactly "${STAGING}" (or unset for the local build)`);
  }
  if (platform.kind === 'web') {
    const callbackUrl = env.EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL;
    const environment = accountEnv === PRODUCTION ? PRODUCTION : accountEnv === STAGING ? STAGING : undefined;
    if (typeof callbackUrl !== 'string' || webCallbackOrigin(callbackUrl, environment) !== platform.origin) {
      return off(
        'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL',
        callbackUrl,
        environment === PRODUCTION
          ? "this production page's own account route (https, this page's own public origin, then /account, nothing else)"
          : environment === STAGING
            ? "this staging page's own account route (https, this page's own origin, then /account, nothing else)"
            : "this page's own account route (http, this page's loopback origin and port, then /account, nothing else)"
      );
    }
    return { enabled: true, provider: GOOGLE, platform: 'web', callbackUrl };
  }
  const callbackUrl = env.EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL;
  if (callbackUrl !== GOOGLE_NATIVE_CALLBACK) {
    return off('EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL', callbackUrl, `the app's own account route (${GOOGLE_NATIVE_CALLBACK}, nothing else)`);
  }
  if (platform.unavailable !== null) return { enabled: false, reason: `Google sign-in is off: ${platform.unavailable}` };
  return { enabled: true, provider: GOOGLE, platform: 'native', callbackUrl };
}
