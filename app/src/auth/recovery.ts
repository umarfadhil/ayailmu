// Email password recovery's own pieces, kept apart from the normal and Google sign-ins: its configuration, the one-use
// record of its pending attempt, and the checks of that record and of the recovery link's callback. A callback is the
// exact configured callback with one canonical code and nothing else; anything else is refused before any SDK client
// is built or anything is sent. Nothing here holds an email, a password or a session token.
import type { GoTrueClient, GoTrueClientOptions } from '@supabase/auth-js';
import { STAGING, stagingOrigin } from '@/account/staging';
import { AuthError } from '@/auth/types';

/** The one native callback of a recovery link. */
export const NATIVE_RECOVERY_CALLBACK = 'arabictrial://recover';
/** How long a pending recovery attempt counts after its request: 60 minutes. */
export const RECOVERY_ATTEMPT_TTL_MS = 60 * 60_000;
/** How far an attempt's creation time may lie in the future (a clock that moved) and still count. */
export const RECOVERY_CLOCK_SKEW_MS = 60_000;
/** After a request is sent, how long another request, for any address, sends nothing. */
export const RECOVERY_COOLDOWN_MS = 60_000;

export interface RecoveryConfig {
  enabled: true;
  platform: 'native' | 'web';
  /** Native: exactly arabictrial://recover. Web: the app's own origin with exactly the /recover path. */
  callbackUrl: string;
}

/** The one pending attempt (version 1), with exactly these keys: never an email, a password or a session token. */
export interface RecoveryAttemptRecord {
  v: 1;
  /** The SDK's PKCE flow ID, as its verifier's storage key names it. */
  flowId: string;
  /** The PKCE verifier, sent only in the one code exchange. */
  verifier: string;
  callbackUrl: string;
  /** When the request was sent, in ms since the epoch. */
  createdAt: number;
  /** The configured Auth origin the attempt was made at. */
  auth: string;
  profile: 'local' | 'staging';
}
const RECORD_KEYS = ['v', 'flowId', 'verifier', 'callbackUrl', 'createdAt', 'auth', 'profile'];
/** The most the whole serialized record may take, in UTF-8 bytes. */
const RECOVERY_RECORD_MAX_BYTES = 2048;

/**
 * Whether `text` takes at most `limit` UTF-8 bytes, counted from its UTF-16 code units without TextEncoder or Buffer
 * (React Native need not have either), as the remembered-session vault counts: a surrogate pair is four bytes, a lone
 * surrogate the three of its U+FFFD. UTF-8 never takes fewer bytes than code units, so a longer text is over at once.
 */
function fitsUtf8(text: string, limit: number): boolean {
  if (text.length > limit) return false;
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit < 0xdc00 && next >= 0xdc00 && next < 0xe000) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
    if (bytes > limit) return false;
  }
  return true;
}

/** Recovery's own short-lived store for its one pending attempt: never Google's store or the remembered-session vault. */
export interface RecoveryAttemptStore {
  save(record: RecoveryAttemptRecord): void;
  /** Removes and returns the record (single use). */
  take(): RecoveryAttemptRecord | null;
  clear(): void;
}

/** The recovery SDK client's maintained public methods used here, and nothing else. */
export type RecoverySdkClient = Pick<
  GoTrueClient,
  'resetPasswordForEmail' | 'exchangeCodeForSession' | 'updateUser' | 'refreshSession' | 'signOut' | 'stopAutoRefresh' | 'dispose'
>;

export interface RecoveryOptions {
  config: RecoveryConfig;
  store: RecoveryAttemptStore;
  /** Builds recovery's dedicated SDK client, only when an exchange needs one; the app's default is `new AuthClient(options)`. */
  createClient?: (options: GoTrueClientOptions) => RecoverySdkClient;
}

/**
 * auth.recovery, only with the recovery option. A recovery session is held privately, only to change the password; it
 * never becomes the signed-in session and is never handed to the account API.
 */
export interface PasswordRecovery {
  /**
   * Asks the Auth server for a recovery link to `email`, through the SDK's PKCE request on a dedicated client, to the
   * exact callback. The result is the same whether or not the address is registered, and never says mail was sent. Any
   * earlier pending attempt is cleared before the request is sent, and the new one (its flow and verifier, never the
   * address) is saved once the request succeeds. For RECOVERY_COOLDOWN_MS after a request was sent (from when it goes,
   * whatever its reply), another one, for any address, sends nothing and keeps that attempt. A sign-out or a newer
   * sign-in clears the pending attempt. Rejects, before any client or request, with not_synthetic for an address that is
   * not a .test one, and unavailable without secure WebCrypto or entropy or when the store will not clear; then with
   * network, provider_refused, bad_response or unavailable when the request or its attempt failed, and with cancelled,
   * signed_out or superseded when cancel, a sign-out or a newer sign-in or recovery came first (nothing is saved then).
   */
  request(email: string): Promise<{ requested: true }>;
  /**
   * Takes the recovery link's callback. Refused with bad_callback, before anything is built or sent, unless it is the
   * exact callback with one code and the pending attempt is whole, bound here, fresh and unused; the attempt is then taken
   * (single use) and its code exchanged once by a dedicated SDK client. Rejects with network, bad_callback or
   * bad_response when the exchange fails, unavailable when no client could be built, and cancelled, signed_out or
   * superseded when cancel, a sign-out or a newer sign-in came first; nothing is kept then.
   */
  resume(callbackUrl: string): Promise<{ ready: true }>;
  /**
   * Changes the password through the recovery session resume made ready, and only through it, once: on success that
   * session is retired with a sign-out on this device only, and revoked says whether the server accepted that sign-out.
   * Nothing is signed in: the learner signs in with the new password as usual. Rejects with bad_callback, sending
   * nothing, when no recovery session is ready (none yet, already used, ended, or another update on its way); with
   * weak_password when the server refused the password as weak, the session staying ready for a corrected try; with
   * network when the server could not be reached (the session stays; whether the password changed is unknown); with
   * expired once the session or its link's lifetime is spent; with provider_refused or bad_response for any other
   * refusal or reply; and with cancelled, signed_out or superseded when cancel, a sign-out or a newer sign-in or
   * recovery came first. Except for weak_password and network, the recovery session is then retired.
   */
  update(password: string): Promise<{ updated: true; revoked: boolean }>;
  /** Drops the recovery under way, if any: a recovery session it holds is signed out on this device only. */
  cancel(): Promise<void>;
}

const FLOW_ID = /^[a-zA-Z0-9_-]{8,64}$/;
/** RFC 7636's verifier: 43 to 128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_WEB_CALLBACK = /^http:\/\/(127\.0\.0\.1|localhost):([1-9]\d{0,4})\/recover$/;
const MAX_CALLBACK_LENGTH = 4096;

/** Whether `config` is a recovery configuration this profile may use: exactly the native callback, or this profile's web /recover. */
export function isSafeRecoveryConfig(config: unknown, environment: unknown): config is RecoveryConfig {
  if (typeof config !== 'object' || config === null) return false;
  const c = config as Partial<RecoveryConfig>;
  if (c.enabled !== true || typeof c.callbackUrl !== 'string') return false;
  if (c.platform === 'native') return c.callbackUrl === NATIVE_RECOVERY_CALLBACK;
  if (c.platform !== 'web') return false;
  if (environment === undefined) {
    const match = LOCAL_WEB_CALLBACK.exec(c.callbackUrl);
    return match !== null && Number(match[2]) <= 65535;
  }
  if (environment !== STAGING || !c.callbackUrl.endsWith('/recover')) return false;
  const origin = c.callbackUrl.slice(0, -'/recover'.length);
  return stagingOrigin(origin) === origin;
}

/**
 * The record in `value`, or null unless it has exactly its keys, at this version, with a valid flow and verifier, and
 * its whole serialized JSON fits RECOVERY_RECORD_MAX_BYTES of UTF-8.
 */
export function recoveryAttemptRecord(value: unknown): RecoveryAttemptRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((key) => keys.includes(key))) return null;
  const { callbackUrl, auth } = r;
  // The two free texts are bounded before any pattern or serialization runs over them; the flow ID and verifier are by their patterns.
  if (typeof callbackUrl !== 'string' || typeof auth !== 'string' || callbackUrl.length + auth.length > RECOVERY_RECORD_MAX_BYTES) return null;
  if (r.v !== 1 || typeof r.flowId !== 'string' || !FLOW_ID.test(r.flowId)) return null;
  if (typeof r.verifier !== 'string' || !VERIFIER.test(r.verifier)) return null;
  if (r.profile !== 'local' && r.profile !== 'staging') return null;
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return null;
  if (!fitsUtf8(JSON.stringify(r), RECOVERY_RECORD_MAX_BYTES)) return null;
  return r as unknown as RecoveryAttemptRecord;
}

/**
 * The one PKCE flow a request client's SDK made, as it keeps it in that client's own RAM: the flow ID its slot
 * `<storageKey>-flow-<flowId>-code-verifier` names, and the verifier from that slot's JSON '<verifier>/recovery'. Null
 * unless there is exactly one such slot holding a recovery flow. (recoveryAttemptRecord then checks both.)
 */
export function recoveryFlow(memory: ReadonlyMap<string, string>, storageKey: string): { flowId: string; verifier: string } | null {
  const prefix = `${storageKey}-flow-`;
  const suffix = '-code-verifier';
  const slots = [...memory.keys()].filter((key) => key.startsWith(prefix) && key.endsWith(suffix) && key.length > prefix.length + suffix.length);
  if (slots.length !== 1) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(memory.get(slots[0]) ?? '');
  } catch {
    return null;
  }
  if (typeof stored !== 'string' || !stored.endsWith('/recovery')) return null;
  return { flowId: slots[0].slice(prefix.length, -suffix.length), verifier: stored.slice(0, -'/recovery'.length) };
}

/**
 * The one code of a recovery callback, or null unless `url` is exactly `callbackUrl` followed by ?code=<a canonical
 * lowercase UUID> and nothing else: no fragment, no other or repeated parameter, no token. Read without a URL parser.
 */
export function readRecoveryCallback(url: unknown, callbackUrl: string): string | null {
  if (typeof url !== 'string' || url.length > MAX_CALLBACK_LENGTH || url.includes('#')) return null;
  const prefix = `${callbackUrl}?code=`;
  if (!url.startsWith(prefix)) return null;
  const code = url.slice(prefix.length);
  return CODE.test(code) ? code : null;
}

/** Whether this build turns password recovery on: EXPO_PUBLIC_PASSWORD_RECOVERY exactly "on". Read when called (Expo inlines the literal). */
export function passwordRecoveryEnabled(): boolean {
  return process.env.EXPO_PUBLIC_PASSWORD_RECOVERY === 'on';
}

/** The same-tab storage a web build gives the session store: window.sessionStorage's three methods, and nothing else. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The one key the session store keeps the pending attempt under. */
export const RECOVERY_ATTEMPT_KEY = 'ayailmu-recovery-attempt';

/** The text of `record` for a store: the exact record, checked whole. Throws unavailable for anything else. */
function attemptText(record: unknown): string {
  const valid = recoveryAttemptRecord(record);
  if (!valid) throw new AuthError('unavailable');
  return JSON.stringify(valid);
}

/** The pending attempt in this realm's RAM only: a copy of a valid record, taken once. Nothing persists. */
export function memoryRecoveryStore(): RecoveryAttemptStore {
  let held: RecoveryAttemptRecord | null = null;
  return {
    save(record) {
      held = null;
      held = JSON.parse(attemptText(record)) as RecoveryAttemptRecord;
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

/**
 * The pending attempt in `storage` (a tab's sessionStorage), under RECOVERY_ATTEMPT_KEY only: temporary verifier data
 * for this tab, never a session. A save writes a valid record only and confirms the write, else it is unavailable and
 * its key is cleared as far as the storage allows. A take removes the key and confirms that before anything is handed
 * over, so a record is used once; a text over 2048 UTF-8 bytes is never parsed, and anything that is not a valid record
 * gives nothing. A take that cannot read or remove the key gives nothing; a clear that cannot remove it is unavailable.
 * No other key is touched, and the storage is never cleared as a whole.
 */
export function sessionRecoveryStore(storage: StorageLike): RecoveryAttemptStore {
  /** Removes the key and confirms it is gone; false when it could not be. */
  const remove = (): boolean => {
    try {
      storage.removeItem(RECOVERY_ATTEMPT_KEY);
      return storage.getItem(RECOVERY_ATTEMPT_KEY) === null;
    } catch {
      return false;
    }
  };
  return {
    save(record) {
      const text = attemptText(record);
      let written = false;
      try {
        storage.setItem(RECOVERY_ATTEMPT_KEY, text);
        written = storage.getItem(RECOVERY_ATTEMPT_KEY) === text;
      } catch {
        written = false;
      }
      if (!written) {
        remove();
        throw new AuthError('unavailable');
      }
    },
    take() {
      let text: unknown = null;
      try {
        text = storage.getItem(RECOVERY_ATTEMPT_KEY);
      } catch {
        return null;
      }
      if (text === null || text === undefined) return null;
      // Gone before anything is handed over, whatever the text holds: single use.
      if (!remove() || typeof text !== 'string' || !fitsUtf8(text, RECOVERY_RECORD_MAX_BYTES)) return null;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return null;
      }
      return recoveryAttemptRecord(value);
    },
    clear() {
      if (!remove()) throw new AuthError('unavailable');
    },
  };
}
