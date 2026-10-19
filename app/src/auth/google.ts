// Continue with Google through the local Auth server (GoTrue), with the maintained SDK's authorization code + PKCE flow:
// the port the account layer drives, the short-lived record of the one pending attempt, and the checks the Auth adapter
// makes of the authorize URL and of each callback. Between leaving for the browser and its callback the app keeps only
// what PKCE needs to finish that attempt, never a token or a session: on the web in this tab's sessionStorage (a
// full-page redirect ends the page's memory), on native in RAM (the app stays alive behind the system browser).
import type { GoTrueClient, GoTrueClientOptions } from '@supabase/auth-js';

import type { EnabledGoogleConfig } from '@/account/googleConfig';
import { isCanonicalUuid } from '@/account/ids';
import type { AuthIdentity } from '@/auth/types';

/** The scopes asked for: the sign-in identity only. Never Gmail or any other Google API. */
export const GOOGLE_SCOPES = 'openid email profile';
/** How long a pending attempt's record may wait for its callback. */
export const GOOGLE_ATTEMPT_TTL_MS = 10 * 60_000;
/** The web store's one key in this tab's sessionStorage. */
export const GOOGLE_ATTEMPT_KEY = 'ayailmu-google-attempt';

/** The one pending attempt, kept from leaving for the browser until its callback. */
export interface GoogleAttemptRecord {
  v: 1;
  /** The SDK's PKCE flow id (not a secret). */
  flowId: string;
  /** The SDK's PKCE code verifier for that flow: of no use without the code its callback brings, and used once. */
  verifier: string;
  /** The exact callback the attempt asked for. */
  callbackUrl: string;
  /** When it started (ms since the epoch). */
  createdAt: number;
}

/** One slot, synchronous: this tab's sessionStorage on the web, RAM on native. */
export interface PendingGoogleStore {
  /** Keeps the record in place of any earlier one; throws when the storage refuses it. */
  save(record: GoogleAttemptRecord): void;
  /**
   * The record, removed at once (single use); null when there is none, when it is malformed (which is removed too), or
   * when it cannot be removed (a record that cannot be used up is never handed over).
   */
  take(): GoogleAttemptRecord | null;
  clear(): void;
}

/** The SDK client's maintained public methods a Google sign-in may use, and nothing else. */
export type GoogleSdkClient = Pick<GoTrueClient, 'signInWithOAuth' | 'exchangeCodeForSession' | 'refreshSession' | 'signOut' | 'stopAutoRefresh' | 'dispose'>;

export interface GoogleAuthOptions {
  config: EnabledGoogleConfig;
  store: PendingGoogleStore;
  /** Builds each Google SDK client; the app's default is `new AuthClient(options)`. */
  createClient?: (options: GoTrueClientOptions) => GoogleSdkClient;
}

/** One Google attempt, from its authorize URL to its callback. */
export interface GoogleAttempt {
  /** The Auth server's authorize URL for Google, to open in the system browser: its challenge is S256, never the verifier. */
  readonly url: string;
  /** The exact callback this attempt asked for. */
  readonly callbackUrl: string;
  /**
   * Completes this attempt with the URL the browser reached. Rejects without sending anything unless this is still the
   * pending attempt and the URL is its exact callback with one code; otherwise exchanges that code once.
   */
  complete(callbackUrl: string): Promise<AuthIdentity>;
  /** The browser closed without a callback: this attempt ends, and its record is removed. */
  cancel(): void;
}

export interface GoogleSignIn {
  /** Begins a new attempt (the latest sign-in wins) and records it. Sends nothing. */
  start(): Promise<GoogleAttempt>;
  /**
   * A fresh app run (the web, after the full-page redirect): completes the attempt recorded before the page left, with the
   * URL this page was loaded with. Without a URL it only ends any recorded attempt, and resolves null.
   */
  resume(launchUrl: string | null): Promise<AuthIdentity | null>;
}

/** The SDK's PKCE flow id: what it accepts as one. */
export const PKCE_FLOW_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** An RFC 7636 code verifier: 43 to 128 unreserved characters (so never the SDK's «…/recovery» form). */
export const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const RECORD_FIELDS = ['callbackUrl', 'createdAt', 'flowId', 'v', 'verifier'].join(',');

/** A copy of `value` when it is exactly an attempt record (its own fields, nothing else beside them); otherwise null. */
export function attemptRecord(value: unknown): GoogleAttemptRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== RECORD_FIELDS) return null;
  const { v, flowId, verifier, callbackUrl, createdAt } = r;
  if (v !== 1 || typeof flowId !== 'string' || !PKCE_FLOW_ID.test(flowId) || typeof verifier !== 'string' || !PKCE_VERIFIER.test(verifier)) return null;
  if (typeof callbackUrl !== 'string' || callbackUrl === '' || typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  return { v: 1, flowId, verifier, callbackUrl, createdAt };
}

/** The native store: the record in RAM. */
export function memoryGoogleStore(): PendingGoogleStore {
  let held: GoogleAttemptRecord | null = null;
  return {
    save(record) {
      const copy = attemptRecord(record);
      if (!copy) throw new Error('Not a Google attempt record; nothing was kept.');
      held = copy;
    },
    take() {
      const record = held;
      held = null;
      return record;
    },
    clear() {
      held = null;
    },
  };
}

/** The web store: the record under GOOGLE_ATTEMPT_KEY in this tab's sessionStorage, and nothing else there. */
export function sessionGoogleStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): PendingGoogleStore {
  const remove = () => {
    try {
      storage.removeItem(GOOGLE_ATTEMPT_KEY);
    } catch {
      // Nothing more can be removed.
    }
  };
  return {
    save(record) {
      const copy = attemptRecord(record);
      if (!copy) throw new Error('Not a Google attempt record; nothing was kept.');
      storage.setItem(GOOGLE_ATTEMPT_KEY, JSON.stringify(copy)); // throws when the storage refuses it
    },
    take() {
      let raw: string | null = null;
      try {
        raw = storage.getItem(GOOGLE_ATTEMPT_KEY);
      } catch {
        return null;
      }
      if (raw === null) return null;
      // Single use, whatever it holds: handed over only once the storage has let go of it, as a second read confirms.
      // A removal refused, silently ignored or left unconfirmed hands nothing over, however often it is taken.
      try {
        storage.removeItem(GOOGLE_ATTEMPT_KEY);
        if (storage.getItem(GOOGLE_ATTEMPT_KEY) !== null) return null;
      } catch {
        return null;
      }
      try {
        return attemptRecord(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    clear: remove,
  };
}

/**
 * What this JavaScript runtime lacks of what PKCE with an S256 challenge needs (secure entropy, SHA-256, and the SDK's
 * text and base64 encoders), by name; null when it has it all. Without them the SDK would fall back to Math.random and
 * a plain challenge, so a Google sign-in never starts.
 */
export function missingWebCrypto(scope: { crypto?: unknown; TextEncoder?: unknown; btoa?: unknown } = globalThis): string | null {
  const crypto = scope.crypto as { getRandomValues?: unknown; subtle?: { digest?: unknown } } | undefined;
  const missing: string[] = [];
  if (typeof crypto?.getRandomValues !== 'function') missing.push('crypto.getRandomValues');
  if (typeof crypto?.subtle?.digest !== 'function') missing.push('crypto.subtle.digest');
  if (typeof scope.TextEncoder !== 'function') missing.push('TextEncoder');
  if (typeof scope.btoa !== 'function') missing.push('btoa');
  return missing.length ? missing.join(', ') : null;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url of `bytes`, as RFC 7636 writes an S256 challenge. */
function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const second = i + 1 < bytes.length;
    const third = i + 2 < bytes.length;
    const n = (bytes[i] << 16) | ((second ? bytes[i + 1] : 0) << 8) | (third ? bytes[i + 2] : 0);
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
    if (second) out += BASE64URL[(n >> 6) & 63];
    if (third) out += BASE64URL[n & 63];
  }
  return out;
}

/** The S256 code challenge of a verifier (RFC 7636), computed here with the platform's own WebCrypto. */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The parameters of a query or fragment, each name with all its values; null when one cannot be decoded. */
function parameters(text: string): Map<string, string[]> | null {
  const found = new Map<string, string[]>();
  for (const pair of text.split('&')) {
    if (pair === '') continue;
    const at = pair.indexOf('=');
    try {
      const name = decodeURIComponent((at === -1 ? pair : pair.slice(0, at)).replace(/\+/g, ' '));
      const value = decodeURIComponent((at === -1 ? '' : pair.slice(at + 1)).replace(/\+/g, ' '));
      found.set(name, [...(found.get(name) ?? []), value]);
    } catch {
      return null;
    }
  }
  return found;
}

/**
 * Whether `url` is the Auth server's authorize URL for this attempt as the SDK built it: at its root's /authorize, for
 * Google, returning to exactly the callback, asking for the identity scopes only with the account chooser, and with an
 * S256 challenge that is the SHA-256 of `verifier` (computed here, so a plain challenge or another verifier is refused).
 */
export async function isGoogleAuthorizeUrl(url: string, expected: { authUrl: string; callbackUrl: string; verifier: string }): Promise<boolean> {
  const prefix = `${expected.authUrl}/authorize?`;
  if (!url.startsWith(prefix) || url.includes('#')) return false;
  const query = parameters(url.slice(prefix.length));
  if (!query) return false;
  const only = (name: string) => {
    const values = query.get(name);
    return values?.length === 1 ? values[0] : null;
  };
  const challenge = only('code_challenge');
  if (
    only('provider') !== 'google' ||
    only('redirect_to') !== expected.callbackUrl ||
    only('scopes') !== GOOGLE_SCOPES ||
    only('prompt') !== 'select_account' ||
    only('code_challenge_method') !== 's256' ||
    challenge === null ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)
  ) {
    return false;
  }
  return challenge === (await s256Challenge(expected.verifier));
}

/** A callback as the adapter reads it: one code to exchange, the refusal it reports, or nothing to accept. */
export type GoogleCallback =
  | { kind: 'code'; code: string }
  | { kind: 'error'; code: 'cancelled' | 'not_registered' | 'provider_refused' }
  | { kind: 'invalid' };

/**
 * Anything token-like in a callback means an implicit-flow reply (or a link tampered with), which is never accepted,
 * whatever else it carries. Names are matched once decoded, so a percent-encoded name counts too.
 */
const TOKEN_PARAMETERS = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'id_token'];

/**
 * Reads `url` as a callback to exactly `callbackUrl`: the same text, then only a query and/or a fragment, with nothing
 * token-like in either. A code callback has exactly one code in GoTrue's own form (a canonical lower-case UUID, as the
 * pinned GoTrue issues it), no error and no fragment; an error callback (GoTrue may repeat it in the fragment) carries
 * one consistent refusal: access_denied alone is the learner cancelling, signup_disabled is an unknown account, anything
 * else a refusal. Nothing else is accepted; no URL API is used (React Native's is incomplete).
 */
export function readGoogleCallback(url: string, callbackUrl: string): GoogleCallback {
  const invalid: GoogleCallback = { kind: 'invalid' };
  if (typeof url !== 'string' || url.length > 4096 || !url.startsWith(callbackUrl)) return invalid;
  const rest = url.slice(callbackUrl.length);
  if (rest !== '' && rest[0] !== '?' && rest[0] !== '#') return invalid; // another path, or a look-alike
  const hash = rest.indexOf('#');
  const queryText = rest.startsWith('?') ? rest.slice(1, hash === -1 ? undefined : hash) : '';
  const fragmentText = hash === -1 ? null : rest.slice(hash + 1);
  const query = parameters(queryText);
  const fragment = fragmentText === null ? null : parameters(fragmentText);
  if (!query || (fragmentText !== null && !fragment)) return invalid;
  // Checked before anything else is read: a token beside a code (or a refusal) is never taken for a code callback.
  if (TOKEN_PARAMETERS.some((name) => query.has(name) || fragment?.has(name))) return invalid;

  const codes = query.get('code') ?? [];
  const errors = [...(query.get('error') ?? []), ...(fragment?.get('error') ?? [])];
  if (codes.length > 0) {
    if (codes.length !== 1 || errors.length > 0 || fragmentText !== null || !isCanonicalUuid(codes[0])) return invalid;
    return { kind: 'code', code: codes[0] };
  }
  if (errors.length === 0) return invalid;
  const errorCodes = [...(query.get('error_code') ?? []), ...(fragment?.get('error_code') ?? [])];
  if (new Set(errors).size !== 1 || new Set(errorCodes).size > 1) return invalid;
  if (errorCodes[0] === 'signup_disabled') return { kind: 'error', code: 'not_registered' };
  if (errors[0] === 'access_denied' && errorCodes.length === 0) return { kind: 'error', code: 'cancelled' };
  return { kind: 'error', code: 'provider_refused' };
}
