// Sign-in against a standalone Supabase Auth server (GoTrue) at its root, never a hosted /auth/v1 prefix: the local one by
// default, the staging one in a staging build and the production one in an explicit production build, always through its
// maintained SDK (@supabase/auth-js AuthClient). A password sign-in takes the prepared synthetic .test identities only in a
// local or staging build, and identities whose address has a conventional email format (by its format alone, never a
// claim that it is deliverable) in an explicit production build; sign-up is off in every build. Where the build turns it
// on, Continue with Google goes through the Auth server's authorization code + PKCE flow. The transport origins and the
// profile that chooses the email policy are validated once, when the adapter is built, and kept: the caller's
// configuration is never read again for them. Each sign-in gets its own SDK client, kept in
// memory only (no persistence, no URL detection, no debug output, no background refresh, no API key), which reaches the
// Auth root only through a bounded transport without cookies or redirects. The latest sign-in wins; a client that loses
// or is replaced is retired through the SDK's own local sign-out and never used again (a Google session's refresh hands
// it on to a fresh client of its own, and the earlier one is let go without a sign-out). Tokens stay inside: only
// authorized calls receive the current access token, and nothing is stored, logged or put in a URL. The one exception
// needs the remember option, a secure session vault: there, auth.remembered keeps a password session's refresh token
// (never an access token or a password) in one record bound to this installation, Auth server, API, profile, user and
// verified account, so that a later run can restore that session through one refresh grant.
import {
  AuthClient,
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type AuthResponse,
  type AuthTokenResponse,
  type AuthTokenResponsePassword,
  type GoTrueClient,
  type GoTrueClientOptions,
  type Session as SdkSession,
  type SupportedStorage,
  type UserResponse,
} from '@supabase/auth-js';
import { isSafeGoogleConfig } from '@/account/googleConfig';
import { LEARNING_BETA } from '@/account/learningBeta';
import { isPrivateQaRecipient, PRIVATE_QA } from '@/account/privateQa';
import { accountApiOrigin, STAGING } from '@/account/staging';
import { isCanonicalUuid } from '@/account/ids';
import { accountAuthOrigin, LOCAL_SUPABASE, type EnabledSupabaseConfig } from '@/account/supabaseConfig';
import {
  attemptRecord,
  GOOGLE_ATTEMPT_TTL_MS,
  GOOGLE_SCOPES,
  isGoogleAuthorizeUrl,
  missingWebCrypto,
  PKCE_FLOW_ID,
  PKCE_VERIFIER,
  readGoogleCallback,
  type GoogleAttempt,
  type GoogleAttemptRecord,
  type GoogleAuthOptions,
  type GoogleSdkClient,
  type GoogleSignIn,
} from '@/auth/google';
import {
  isSafeRecoveryConfig,
  readRecoveryCallback,
  readWrappedRecoveryCallback,
  RECOVERY_ATTEMPT_TTL_MS,
  RECOVERY_CLOCK_SKEW_MS,
  RECOVERY_COOLDOWN_MS,
  recoveryAttemptRecord,
  recoveryFlow,
  type PasswordRecovery,
  type RecoveryAttemptRecord,
  type RecoveryOptions,
  type RecoverySdkClient,
} from '@/auth/recovery';
import { asciiBytes, base64Url, hex, isRecoveryCrypto, secureBytes, sha256Bytes, type RecoveryCrypto } from '@/auth/recoveryCrypto';
import {
  AuthError,
  type AccountAuth,
  type AuthErrorCode,
  type AuthIdentity,
  type AuthStatus,
  type SessionVault,
  type SignOutOutcome,
} from '@/auth/types';

/** How long one request to the Auth server, its reply body included, may take before the transport aborts it. */
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;

/** The SDK client's maintained public methods used here, and nothing else: no private fields, no subclass. */
export type SdkClient = Pick<GoTrueClient, 'signInWithPassword' | 'getSession' | 'refreshSession' | 'signOut' | 'stopAutoRefresh'>;

/** Builds one SDK client from its constructor options; the app's default is `new AuthClient(options)`. */
export type CreateSdkClient = (options: GoTrueClientOptions) => SdkClient;

export interface SupabaseAuthOptions {
  config: EnabledSupabaseConfig;
  /** Builds each SDK client; tests inject a fake SDK here. */
  createClient?: CreateSdkClient;
  /** The fetch under the SDK's bounded transport; the global fetch by default. */
  fetch?: typeof fetch;
  now?: () => number;
  /** Continue with Google: its configuration and the short-lived store of its pending attempt. Absent: no Google sign-in. */
  google?: GoogleAuthOptions;
  /** Remembering a password sign-in on this device, in this secure session vault. Absent: no vault is read or written. */
  remember?: { vault: SessionVault };
  /** Email password recovery: its configuration, the store of its pending attempt and its own SDK clients. Absent: no recovery. */
  recovery?: RecoveryOptions;
}

/**
 * A password session remembered on this device (auth.remembered, only with remember: { vault }). Google sessions are
 * never remembered. Signing out clears the record at once. So does a newer password sign-in or Google sign-in, which is
 * refused (not_forgotten) before anything is sent when the vault will not clear it. A record is at most 2048 UTF-8 bytes.
 */
export interface RememberedSessions {
  /**
   * Remembers the current password session for `accountId`, as the account API verified it. The record is written at
   * once and stamped with the time of this choice, which is never renewed. False when nothing was saved: no current
   * password session, an account ID that is not one, a record that would be over 2048 UTF-8 bytes, or a vault that
   * refused. Whatever the vault may hold of it is then cleared as far as the vault allows; the sign-in stays in RAM.
   */
  save(accountId: string): Promise<boolean>;
  /**
   * A new run presents the remembered session once, through a fresh client's single refresh grant. The session is
   * adopted only when the provider answers for the record's own user and the rotated token has been written back.
   * - Null, with nothing sent and the record cleared, when there is nothing valid to restore: over 2048 UTF-8 bytes;
   *   another installation, Auth server, API, profile, version or kind; saved over 30 days ago; or no record.
   * - Rejects with network when the provider was unreachable or its reply was lost; the record stays.
   * - Rejects with expired when the provider refused the token; the record is cleared.
   * - Rejects with bad_response for another user or a token that could not be written back; the record is cleared and the session revoked.
   * - Rejects with signed_out or superseded when a sign-out or a newer sign-in came first; the late session is revoked
   *   and never written back.
   */
  restore(): Promise<{ identity: AuthIdentity; accountId: string } | null>;
  /**
   * Leaves this run, and leaves the vault as it is:
   * - a sign-in still on its way is dropped;
   * - a remembered session is let go without a logout, so its record restores it next time;
   * - any other session is signed out as by signOut.
   */
  release(): Promise<void>;
}

/** The local Supabase Auth sign-in, with Continue with Google and a remembered password session where the build turns them on. */
export type SupabaseAuth = AccountAuth & { google?: GoogleSignIn; remembered?: RememberedSessions; recovery?: PasswordRecovery };

const createAuthClient: CreateSdkClient = (options) => new AuthClient(options);
const createGoogleAuthClient = (options: GoTrueClientOptions): GoogleSdkClient => new AuthClient(options);
const createRecoveryAuthClient = (options: GoTrueClientOptions): RecoverySdkClient => new AuthClient(options);

/** Numbers the SDK clients built, so that each has its own storage key (and so its own SDK lock in a browser). */
let clientsBuilt = 0;

/** A synthetic local-demo address: a .test domain (reserved, never deliverable), as for the emulator pilot. */
const SYNTHETIC_ADDRESS = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+test$/i;
const isSyntheticAddress = (email: unknown): email is string =>
  typeof email === 'string' && email.length <= 254 && SYNTHETIC_ADDRESS.test(email);

/**
 * A conventional address, by its format only (never a claim that it is deliverable): ASCII, at most 254 characters, a
 * local part of at most 64 letters, digits and . _ % + - (no leading, trailing or repeated dot), then one @ and a DNS
 * name of at least two labels, each 1 to 63 letters, digits or inner hyphens, the last starting with a letter. Matched
 * whole, so whitespace, a control character, another @, an empty or oversized label or an IP literal never matches.
 */
const CONVENTIONAL_ADDRESS = /^([a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*)@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const isConventionalAddress = (email: unknown): email is string => {
  if (typeof email !== 'string' || email.length > 254) return false;
  const match = CONVENTIONAL_ADDRESS.exec(email);
  return match !== null && match[1].length <= 64;
};

/**
 * Why the profile `profile` refuses `email` for a password sign-in, or null when it takes it: a production build takes a
 * conventional address (its format only); a learning-beta build the same; a private QA build a conventional one that is
 * exactly the approved recipient; local and staging builds synthetic .test ones only.
 */
function signInAddressRefusal(email: unknown, profile: RememberedRecord['profile']): AuthErrorCode | null {
  if (profile === PRIVATE_QA) return !isConventionalAddress(email) ? 'invalid_email' : isPrivateQaRecipient(email) ? null : 'private_recipient';
  if (profile === 'production') return isConventionalAddress(email) ? null : 'invalid_email';
  if (profile === LEARNING_BETA) return isConventionalAddress(email) ? null : 'invalid_email';
  return isSyntheticAddress(email) ? null : 'not_synthetic';
}

/** How far a Google attempt's record may claim to start in the future (a clock that moved) and still count. */
const RECORD_CLOCK_SKEW_MS = 60_000;

/** How long a remembered record counts after the choice to remember it: 30 days, never renewed. */
const REMEMBERED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** How far a remembered record's save time may lie in the future (a clock that moved) and still count. */
const REMEMBERED_CLOCK_SKEW_MS = 5 * 60_000;
/** The most the whole remembered record may take in the vault, in UTF-8 bytes, as read and as written. */
const REMEMBERED_MAX_BYTES = 2048;

/** The one remembered record (version 1), with exactly these keys: never an access token or a password. */
interface RememberedRecord {
  v: 1;
  kind: 'password';
  installation: string;
  auth: string;
  api: string;
  profile: 'local' | 'staging' | 'production' | typeof PRIVATE_QA | typeof LEARNING_BETA;
  uid: string;
  email: string;
  accountId: string;
  refreshToken: string;
  savedAt: string;
}
const RECORD_KEYS = ['v', 'kind', 'installation', 'auth', 'api', 'profile', 'uid', 'email', 'accountId', 'refreshToken', 'savedAt'];

/** What a remembered record must be bound to here: this installation, Auth server, account API and profile. */
type RecordBinding = Pick<RememberedRecord, 'installation' | 'auth' | 'api' | 'profile'>;

/**
 * Whether `text` takes at most REMEMBERED_MAX_BYTES in UTF-8. The bytes are counted from its UTF-16 code units, without
 * TextEncoder or Buffer (React Native need not have either); a lone surrogate counts as the three bytes of its U+FFFD.
 */
function fitsVault(text: unknown): boolean {
  // UTF-8 never takes fewer bytes than UTF-16 code units, so a longer text is over before any counting.
  if (typeof text !== 'string' || text.length > REMEMBERED_MAX_BYTES) return false;
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit < 0xdc00 && next >= 0xdc00 && next < 0xe000) {
      // A surrogate pair: one code point beyond the BMP, in four bytes.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes <= REMEMBERED_MAX_BYTES;
}

/** The vault's text for `record`. Throws, so that nothing is written, when it would be over REMEMBERED_MAX_BYTES. */
function recordText(record: RememberedRecord): string {
  const text = JSON.stringify(record);
  if (!fitsVault(text)) throw new Error('The remembered record would not fit the vault.');
  return text;
}

/**
 * The remembered record in `text`, or null unless all of these hold:
 * - it is at most 2048 UTF-8 bytes, checked before it is parsed;
 * - it has exactly its keys, at this version and kind;
 * - it is bound to `binding`;
 * - its IDs are canonical, and its address is conventional under the production and learning-beta profiles (by its format
 *   only), exactly the approved recipient under the private QA profile, synthetic otherwise;
 * - it was saved at most 30 days before `at`, and no later than a moved clock allows.
 */
function rememberedRecord(text: string, binding: RecordBinding, at: number): RememberedRecord | null {
  if (!fitsVault(text)) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((key) => keys.includes(key))) return null;
  if (r.v !== 1 || r.kind !== 'password') return null;
  if (typeof binding.installation !== 'string' || binding.installation === '' || r.installation !== binding.installation) return null;
  if (r.auth !== binding.auth || r.api !== binding.api || r.profile !== binding.profile) return null;
  if (!isCanonicalUuid(r.uid) || !isCanonicalUuid(r.accountId)) return null;
  if (signInAddressRefusal(r.email, binding.profile) !== null) return null;
  if (typeof r.refreshToken !== 'string' || r.refreshToken === '' || typeof r.savedAt !== 'string') return null;
  const savedAt = Date.parse(r.savedAt);
  if (!Number.isFinite(savedAt) || new Date(savedAt).toISOString() !== r.savedAt) return null;
  const age = at - savedAt;
  return age >= -REMEMBERED_CLOCK_SKEW_MS && age <= REMEMBERED_TTL_MS ? (r as unknown as RememberedRecord) : null;
}

type Dropped = 'signed_out' | 'superseded';

/** What one client's transport saw: how many requests it sent, and the HTTP status of its logout once one was answered. */
interface Seen {
  requests: number;
  logoutStatus: number | null;
}

/** What a session needs of its SDK client, whichever sign-in built it. */
type SessionSdk = Pick<GoTrueClient, 'refreshSession' | 'signOut' | 'stopAutoRefresh'>;

/**
 * One SDK client, for one sign-in and the session it gives (a Google session's refresh hands that session on to a fresh
 * client of its own). Once retired, or let go, it is never used again.
 */
interface Client {
  sdk: SessionSdk;
  seen: Seen;
  /** Its local sign-out and that outcome, once retired; once let go without a sign-out, no revocation. */
  retired: Promise<SignOutOutcome> | null;
  /**
   * A Google client's own RAM storage (all the SDK keeps), the key under which the SDK keeps its session there, and its
   * teardown: emptied and disposed once retired or let go.
   */
  google: { memory: Map<string, string>; storageKey: string; dispose: () => Promise<void> } | null;
}

interface Session {
  number: number;
  client: Client;
  identity: AuthIdentity;
  /** The access token while the session can use it; emptied once the session has ended or expired. */
  token: string;
  expired: boolean;
  /** Why the session ended, once it has. */
  ended: Dropped | null;
  /** Cancels each running call: aborts it and settles it with the code, dropping its late result. */
  calls: Set<(code: Dropped) => void>;
  /** A Google session's refresh on its way, which every refresh asked for meanwhile shares. */
  renewing: Promise<AuthIdentity> | null;
  /** With remember only: a password session's refresh token as its latest grant gave it, kept in RAM. Otherwise null. */
  refreshToken: string | null;
  /** The record this password session is remembered under, while it is; rewritten with each rotated refresh token. */
  remembered: RememberedRecord | null;
}

/** One sign-in on its way: a password sign-in, or a Google attempt from its start to its callback's exchange. */
interface Attempt {
  dropped: Dropped | 'cancelled' | null;
}

/** A Google attempt: its PKCE flow, and whether a callback was already taken for it (it is never completed twice). */
interface GoogleRun extends Attempt {
  flowId: string;
  used: boolean;
}

/** A password recovery under way: its exchange, then the recovery session it holds privately (never the signed-in one). */
interface RecoveryRun {
  dropped: Dropped | 'cancelled' | null;
  /** The dedicated client holding the recovery session, once the exchange succeeded; retired when the run ends. */
  candidate: Client | null;
  /** That session, ready for a password update: its client, its user, and until when it may be used (ms since the epoch). */
  held: { sdk: RecoverySdkClient; identity: AuthIdentity; until: number } | null;
  /** A password update through it is on its way: no other may start meanwhile. */
  updating: boolean;
  /** Private QA only: aborts its own request on its way (the recovery request or the link's verification), if any. */
  abort: (() => void) | null;
}

/** The SDK's session reduced to the identity and the access token; null when anything needed is missing or malformed. */
function signedInAs(reply: SdkSession | null | undefined): { identity: AuthIdentity; token: string } | null {
  if (!reply?.user || typeof reply.access_token !== 'string' || reply.access_token === '') return null;
  const { id, email } = reply.user;
  if (!isCanonicalUuid(id) || typeof email !== 'string' || email === '') return null;
  let expiresAt: number | null = null;
  if (reply.expires_at !== undefined) {
    if (!Number.isFinite(reply.expires_at) || reply.expires_at <= 0) return null;
    expiresAt = reply.expires_at * 1000;
  }
  return { identity: { uid: id, email, expiresAt }, token: reply.access_token };
}

/** The refresh token of the SDK's session, or null without one. */
const refreshTokenOf = (reply: SdkSession | null | undefined): string | null =>
  typeof reply?.refresh_token === 'string' && reply.refresh_token !== '' ? reply.refresh_token : null;

/** A refused password sign-in as a stable code. The SDK's error, and the server text in it, are never kept. */
function signInRefusal(error: unknown): AuthErrorCode {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isAuthApiError(error) && error.code === 'invalid_credentials') return 'invalid_credentials';
  return 'bad_response';
}

/**
 * A refused Google code exchange as a stable code: unreachable is a lost connection; the Auth server refusing this code
 * with this verifier (unknown, used, expired, or another attempt's) is a bad callback. Never the server's text.
 */
function exchangeRefusal(error: unknown): AuthErrorCode {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isAuthApiError(error) && error.status >= 400 && error.status < 500) return 'bad_callback';
  return 'bad_response';
}

/** A failed recovery request as a stable code: unreachable, refused by the Auth server, or no usable reply. Never the server's text. */
function requestRefusal(error: unknown): AuthErrorCode {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isAuthApiError(error)) return 'provider_refused';
  return 'bad_response';
}

/** The reply as the SDK reads it, with its body already in hand: status, URL and headers as they came. */
function buffered(reply: Response, body: string): Response {
  return {
    ok: reply.ok,
    status: reply.status,
    statusText: reply.statusText,
    url: reply.url,
    redirected: reply.redirected,
    headers: reply.headers,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

/**
 * The SDK's transport: requests for addresses under the Auth root only, without cookies or redirects. Each request must
 * finish within AUTH_REQUEST_TIMEOUT_MS, its reply body included: the body is read here under the same deadline, and
 * the SDK is handed the reply with that body in hand (React Native's fetch already has it). A request or body that
 * outlasts the deadline is aborted and fails as a lost connection. A reply from anywhere else is refused, and failures
 * carry no request or reply text. It notes the HTTP status of a logout it read in full, since the SDK reports no error
 * when the provider refuses one with 401, 403 or 404.
 */
function boundTransport(origin: string, base: () => typeof fetch, seen: Seen): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Matched with the root slash, so another host, port or look-alike, the API and the issuer never match.
    if (typeof input !== 'string' || !input.startsWith(`${origin}/`)) {
      throw new Error('The Auth transport refused an address outside the local Auth server; nothing was sent.');
    }
    const logout = input.startsWith(`${origin}/logout`);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const outer = init?.signal;
    if (outer?.aborted) abort();
    else outer?.addEventListener('abort', abort);
    const timer = setTimeout(abort, AUTH_REQUEST_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', abort);
    };
    seen.requests += 1;
    let reply: Response;
    try {
      reply = await base()(input, { ...init, credentials: 'omit', redirect: 'error', signal: controller.signal });
    } catch {
      finish();
      throw new Error('The local Auth server could not be reached.');
    }
    // Where redirect: 'error' is not honoured (React Native's fetch), a reply from another origin is refused.
    if (reply.redirected === true || (typeof reply.url === 'string' && reply.url !== '' && !reply.url.startsWith(`${origin}/`))) {
      abort();
      finish();
      throw new Error('The Auth transport refused a reply from outside the local Auth server.');
    }
    let body: string;
    try {
      body = await reply.text();
    } catch {
      abort();
      throw new Error('The local Auth server could not be reached.');
    } finally {
      finish();
    }
    if (logout) seen.logoutStatus = reply.status;
    return buffered(reply, body);
  };
}

/**
 * Retires a client for good through the SDK's own local sign-out, which drops the SDK's session and asks the provider
 * to revoke it for this device only. Revoked only when the transport saw the provider accept that logout; a client
 * whose transport never ran (an injected SDK) is taken at its word. A Google client's RAM storage is then emptied and
 * the client disposed. Never rejects.
 */
function retire(client: Client): Promise<SignOutOutcome> {
  if (!client.retired) {
    client.retired = (async () => {
      let revoked = false;
      try {
        const { error } = await client.sdk.signOut({ scope: 'local' });
        const status = client.seen.logoutStatus;
        revoked = !error && (client.seen.requests === 0 || (status !== null && status >= 200 && status < 300));
      } catch {
        revoked = false;
      }
      try {
        // Nothing runs in the background (autoRefreshToken is off); this lets go of the SDK's page listeners.
        await client.sdk.stopAutoRefresh();
      } catch {
        // Already retired either way.
      }
      if (client.google) {
        // Nothing of a Google client's session, user or code verifier stays in its RAM storage; its page channel closes.
        client.google.memory.clear();
        try {
          await client.google.dispose();
        } catch {
          // Already retired either way.
        }
      }
      return { revoked };
    })();
  }
  return client.retired;
}

/**
 * Lets go of a Google client without a sign-out: one whose session a refresh handed on to a fresh client (a sign-out
 * would revoke that very session at the Auth server), or a fresh client that was given none. Its page listeners stop,
 * its RAM storage is emptied and it is disposed; it is never used again, and a later retire signs nothing out.
 */
function discard(client: Client): Promise<SignOutOutcome> {
  if (!client.retired) {
    client.retired = (async () => {
      try {
        await client.sdk.stopAutoRefresh();
      } catch {
        // Let go either way.
      }
      if (client.google) {
        client.google.memory.clear();
        try {
          await client.google.dispose();
        } catch {
          // Let go either way.
        }
      }
      return { revoked: false };
    })();
  }
  return client.retired;
}

/** The refresh token of the session a Google client holds, as the SDK keeps that session in the client's own RAM; null without one. */
function heldRefreshToken(google: { memory: Map<string, string>; storageKey: string }): string | null {
  const stored = google.memory.get(google.storageKey);
  if (stored === undefined) return null;
  try {
    const held: unknown = JSON.parse(stored);
    const token = typeof held === 'object' && held !== null ? (held as { refresh_token?: unknown }).refresh_token : null;
    return typeof token === 'string' && token !== '' ? token : null;
  } catch {
    return null;
  }
}

/** One Google client's whole SDK storage: RAM only (the SDK takes a storage only with persistSession; nothing persists). */
function ramStorage(memory: Map<string, string>): SupportedStorage {
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

export function createSupabaseAuth(options: SupabaseAuthOptions): SupabaseAuth {
  // Revalidated here too, once, under the configuration's own profile: an unsafe or legacy configuration, an unknown
  // profile, the production profile without its exact capability, an API or Auth address that is not exactly that
  // profile's (local; under the staging profile a staging root origin; under the production profile a public root origin,
  // Auth's distinct from the API's; so Auth is always at its root), or a Google web callback of another profile builds no
  // client and sends nothing. The private QA profile needs its exact capability, exactly its two fixed roots and an
  // injected fetch (it never falls back to the global one), and takes no Google sign-in; it takes password recovery only
  // with the native callback, its capability and a native crypto port. The learning-beta profile needs its exact capability
  // (learningBeta: true, beside neither of the others) and two distinct public root origins, and takes neither Google
  // sign-in nor password recovery. Each field of the configuration is read once, here;
  // the origins and the profile validated here (which also chooses the email policy) are kept, and the caller's
  // configuration is never read again.
  const config = options?.config;
  const supabase = config?.enabled === true && config.provider === LOCAL_SUPABASE;
  const environment = supabase ? config.environment : undefined;
  const productionAccounts = supabase ? config.productionAccounts : undefined;
  const privateQa = supabase ? config.privateQa : undefined;
  const learningBeta = supabase ? config.learningBeta : undefined;
  const apiOrigin = supabase ? accountApiOrigin(config.apiBaseUrl, environment, productionAccounts, privateQa, learningBeta) : null;
  const authUrl = supabase && apiOrigin !== null ? accountAuthOrigin(config.authUrl, environment, productionAccounts, privateQa, learningBeta) : null;
  const twoRoots = environment === 'production' || environment === PRIVATE_QA || environment === LEARNING_BETA;
  if (!authUrl || !apiOrigin || (twoRoots && authUrl === apiOrigin)) {
    throw new Error('createSupabaseAuth needs a local or staging Supabase Auth configuration; nothing was sent.');
  }
  const injected = options.fetch;
  if (environment === PRIVATE_QA && typeof injected !== 'function') {
    throw new Error('createSupabaseAuth needs an injected fetch for the private QA profile; nothing was sent.');
  }
  const googleOptions = options.google;
  if (googleOptions !== undefined && (environment === PRIVATE_QA || !isSafeGoogleConfig(googleOptions.config, environment) || !googleOptions.store)) {
    throw new Error('createSupabaseAuth needs a safe Google sign-in configuration; nothing was sent.');
  }
  const vault = options.remember?.vault ?? null;
  if (
    options.remember !== undefined &&
    (!vault || typeof vault.installation !== 'function' || typeof vault.read !== 'function' || typeof vault.write !== 'function' || typeof vault.clear !== 'function')
  ) {
    throw new Error('createSupabaseAuth needs a session vault to remember a sign-in; nothing was sent.');
  }
  const recoveryOptions = options.recovery;
  const recoveryCrypto = recoveryOptions?.nativeCrypto;
  if (
    recoveryOptions !== undefined &&
    (!isSafeRecoveryConfig(recoveryOptions.config, environment, productionAccounts, privateQa) ||
      !recoveryOptions.store ||
      (environment === PRIVATE_QA && !isRecoveryCrypto(recoveryCrypto)))
  ) {
    throw new Error('createSupabaseAuth needs a safe password recovery configuration; nothing was sent.');
  }
  /** The private QA profile's native crypto port, kept as given here; null in every other profile, which never uses it. */
  const privateCrypto: RecoveryCrypto | null = environment === PRIVATE_QA && isRecoveryCrypto(recoveryCrypto) ? recoveryCrypto : null;
  /** The profile a remembered record is bound to: the configuration's own, never a guess from an address. */
  const profile: RememberedRecord['profile'] =
    environment === 'production'
      ? 'production'
      : environment === PRIVATE_QA
        ? PRIVATE_QA
        : environment === LEARNING_BETA
          ? LEARNING_BETA
          : environment === STAGING
            ? 'staging'
            : 'local';
  const createClient = options.createClient ?? createAuthClient;
  const now = options.now ?? Date.now;

  let session: Session | null = null;
  let pending: Attempt | null = null;
  let sessions = 0;
  /** With recovery only: the recovery under way, apart from `pending` and `session`. */
  let recovering: RecoveryRun | null = null;

  const build = (): Client & { sdk: SdkClient } => {
    clientsBuilt += 1;
    const seen: Seen = { requests: 0, logoutStatus: null };
    const sdk = createClient({
      url: authUrl,
      storageKey: `ayailmu-local-auth-${clientsBuilt}`,
      persistSession: false,
      detectSessionInUrl: false,
      autoRefreshToken: false,
      debug: false,
      fetch: boundTransport(authUrl, () => injected ?? globalThis.fetch, seen),
    });
    return { sdk, seen, retired: null, google: null };
  };

  const createGoogle = googleOptions?.createClient ?? createGoogleAuthClient;
  /** One Google SDK client: PKCE over a RAM storage of its own (all the SDK keeps), through the bounded transport. */
  const buildGoogle = (storageKey: string, memory: Map<string, string>): { sdk: GoogleSdkClient; client: Client } => {
    const seen: Seen = { requests: 0, logoutStatus: null };
    const sdk = createGoogle({
      url: authUrl,
      storageKey,
      flowType: 'pkce',
      // The SDK uses a given storage only with persistSession; this one is the client's own RAM, so nothing persists.
      persistSession: true,
      storage: ramStorage(memory),
      detectSessionInUrl: false,
      autoRefreshToken: false,
      debug: false,
      fetch: boundTransport(authUrl, () => injected ?? globalThis.fetch, seen),
    });
    return { sdk, client: { sdk, seen, retired: null, google: { memory, storageKey, dispose: () => sdk.dispose() } } };
  };

  /** Has the session passed its expiry (or had a plain 401)? An expired session lets go of its token until a refresh. */
  const isExpired = (s: Session): boolean => {
    if (!s.expired && s.identity.expiresAt !== null && now() >= s.identity.expiresAt) s.expired = true;
    if (s.expired) s.token = '';
    return s.expired;
  };

  /** Ends a session: its running calls are aborted and settle with `code`; its token is let go. */
  const end = (s: Session, code: Dropped) => {
    s.ended = code;
    s.token = '';
    const cancels = [...s.calls];
    s.calls.clear();
    for (const cancel of cancels) cancel(code);
  };

  /**
   * Forgets the remembered record at once, before anything else can run: for a sign-out, or a record that can no longer
   * follow its session. The session in use is no longer remembered whatever the vault does, so no later refresh writes it
   * back, and the vault's record is overwritten. True without a vault. False when the vault refused, so the record may
   * still be there. (A newer sign-in uses forgetBeforeSignIn instead.)
   */
  const forget = (): boolean => {
    if (session) session.remembered = null;
    if (!vault) return true;
    try {
      vault.clear();
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Before a newer sign-in: the vault's record is cleared first, and only then is the session in use no longer
   * remembered. True without a vault. False when the vault refused: that sign-in is then refused (not_forgotten) before it
   * drops, builds or sends anything, and the record, the session in use and its remembered record all stay exactly as
   * they were, so the record still follows that session's refreshes.
   */
  const forgetBeforeSignIn = (): boolean => {
    if (!vault) return true;
    try {
      vault.clear();
    } catch {
      return false;
    }
    if (session) session.remembered = null;
    return true;
  };

  /** Signs the session out here at once, then retires its client. A remembered session is forgotten first. */
  const close = (s: Session): Promise<SignOutOutcome> => {
    if (session === s) session = null;
    if (s.remembered) {
      s.remembered = null;
      forget();
    }
    end(s, 'signed_out');
    return retire(s.client);
  };

  /**
   * A sign-in succeeded: its session replaces the one in use, whose running calls are superseded and whose client is
   * retired. With remember, the new session keeps its refresh token in RAM, so that it can be remembered if chosen.
   */
  const adopt = (client: Client, signedIn: { identity: AuthIdentity; token: string }, refreshToken: string | null = null): Session => {
    const previous = session;
    sessions += 1;
    const next: Session = {
      number: sessions,
      client,
      identity: signedIn.identity,
      token: signedIn.token,
      expired: false,
      ended: null,
      calls: new Set(),
      renewing: null,
      refreshToken: vault ? refreshToken : null,
      remembered: null,
    };
    session = next;
    if (previous) {
      previous.remembered = null;
      end(previous, 'superseded');
      retire(previous.client);
    }
    return next;
  };

  /**
   * A password session's refresh rotated its refresh token, which is kept in RAM. For a remembered session it is also
   * written into the record at once, synchronously after this check that the session is still current, not ended and
   * still remembered. Its save time stays the first one. If the record would not fit or the vault will not take it, the
   * record is spent: it is cleared as far as the vault allows, and the session is no longer remembered.
   */
  const keepRotated = (s: Session, refreshToken: string | null) => {
    s.refreshToken = refreshToken;
    const record = s.remembered;
    if (!record || !vault || session !== s || s.ended) return;
    try {
      if (!refreshToken) throw new Error('No refresh token to remember.');
      const next: RememberedRecord = { ...record, refreshToken };
      vault.write(recordText(next));
      s.remembered = next;
    } catch {
      forget();
    }
  };

  /** Forgets a recorded Google attempt, if any: after a newer sign-in or a sign-out it can never complete. */
  const forgetGoogleAttempt = () => {
    try {
      googleOptions?.store.clear();
    } catch {
      // Nothing kept to remove.
    }
  };

  /**
   * Ends the recovery under way, if any, with `code`: an exchange still on its way settles with it and keeps nothing, and
   * a recovery session already held is retired through its own client's local sign-out. Touches nothing else.
   */
  const fenceRecovery = (code: Dropped | 'cancelled'): Promise<SignOutOutcome> | null => {
    const run = recovering;
    recovering = null;
    if (!run) return null;
    run.dropped = code;
    run.held = null;
    const abort = run.abort;
    run.abort = null;
    abort?.();
    const candidate = run.candidate;
    run.candidate = null;
    return candidate ? retire(candidate) : null;
  };

  /** Forgets a pending recovery attempt, if any: after a newer sign-in or a sign-out its link can never be resumed. */
  const forgetRecoveryAttempt = () => {
    try {
      recoveryOptions?.store.clear();
    } catch {
      // Nothing kept to remove.
    }
  };

  /**
   * A newer sign-in or a sign-out: the sign-in on its way is dropped with `code`, any recorded Google attempt goes, any
   * password recovery under way ends (its recovery session, if any, signed out on this device only), and any pending
   * recovery attempt goes, all before the newer sign-in sends anything.
   */
  const drop = (code: Dropped) => {
    if (pending) pending.dropped = code;
    pending = null;
    forgetGoogleAttempt();
    void fenceRecovery(code);
    forgetRecoveryAttempt();
  };

  /**
   * Refreshes Google session `s` through a fresh SDK client of its own, given nothing but the refresh token its holder
   * keeps. The SDK refreshes a stored session that has expired (or is about to) as it loads it, before the refresh asked
   * for, so the holder of an expired session would send two refresh grants; the fresh client, holding nothing, sends one.
   * Renewed: the fresh client holds the rotated session from then on, under the same session number, and the earlier
   * holder is let go without a sign-out (which would revoke the very session just renewed). Unreachable: the holder keeps
   * the session as it was, and the refresh may be tried again. Refused, missing or not this account's: the session ends,
   * nothing is adopted, and the earlier holder, whose refresh token was just refused or spent, is let go without
   * presenting it again. Ended or replaced meanwhile: nothing is adopted, and whatever the fresh client got is revoked.
   */
  const renewGoogle = async (s: Session): Promise<AuthIdentity> => {
    const holder = s.client;
    const refreshToken = holder.google ? heldRefreshToken(holder.google) : null;
    let fresh: Client | null = null;
    let reply: AuthResponse | null = null;
    if (holder.google && refreshToken) {
      clientsBuilt += 1;
      // Keyed by the session's own lineage (the exchange key's random flow id, an earlier refresh's count dropped) and
      // this realm's count: a count alone starts again in every tab, whose clients would then share a BroadcastChannel.
      fresh = buildGoogle(`${holder.google.storageKey.replace(/-session-\d+$/, '')}-session-${clientsBuilt}`, new Map<string, string>()).client;
      try {
        reply = await fresh.sdk.refreshSession({ refresh_token: refreshToken });
      } catch {
        // An SDK that throws instead of answering gave no usable reply.
      }
    }
    // Ended or replaced meanwhile: the holder is already retired; a session the fresh client got is revoked.
    if (s.ended) {
      if (fresh) void retire(fresh);
      throw new AuthError(s.ended);
    }
    // Unreachable: the session stays with its holder as it was, and may retry; the fresh client got nothing.
    if (reply?.error && isAuthRetryableFetchError(reply.error)) {
      if (fresh) void discard(fresh);
      throw new AuthError('network');
    }
    const renewed = reply && !reply.error ? signedInAs(reply.data.session) : null;
    if (!fresh || !renewed || renewed.identity.uid !== s.identity.uid || renewed.identity.email !== s.identity.email) {
      // The session ends with the fresh client as its holder, which is retired with it (revoking whatever it got).
      if (fresh) {
        s.client = fresh;
        void discard(holder);
      }
      close(s);
      const refused = !refreshToken || (reply?.error && (isAuthApiError(reply.error) || isAuthSessionMissingError(reply.error)));
      throw new AuthError(refused ? 'expired' : 'bad_response');
    }
    s.client = fresh;
    void discard(holder);
    s.identity = renewed.identity;
    s.token = renewed.token;
    s.expired = false;
    return { ...s.identity };
  };

  /**
   * Continue with Google through the Auth server's authorization code + PKCE flow, on this adapter's sessions. Starting
   * sends nothing: a short-lived SDK client prepares the PKCE pair and the authorize URL (checked here, its S256
   * challenge recomputed), and only the flow id and verifier are recorded. A callback is accepted only for the pending
   * attempt (or, on a fresh web page, the recorded one), only at the exact callback, and only once; its code is
   * exchanged by a new SDK client given nothing but that verifier, through the bounded transport. Every Google client
   * keeps its storage in RAM and is emptied and disposed once retired; a session that arrives too late is revoked.
   */
  const continueWithGoogle = (google: GoogleAuthOptions): GoogleSignIn => {
    const callbackUrl = google.config.callbackUrl;

    /** The PKCE pair and authorize URL of a new attempt, from a client that is retired at once and never holds a session. */
    const prepare = async (): Promise<{ url: string; flowId: string; verifier: string }> => {
      // Only with the runtime's own secure entropy and SHA-256: the SDK would otherwise use Math.random and a plain challenge.
      if (missingWebCrypto() !== null) throw new Error('No WebCrypto: Google sign-in cannot start.');
      clientsBuilt += 1;
      const storageKey = `ayailmu-google-start-${clientsBuilt}`;
      const memory = new Map<string, string>();
      const { sdk, client } = buildGoogle(storageKey, memory);
      try {
        const reply = await sdk.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: callbackUrl, scopes: GOOGLE_SCOPES, queryParams: { prompt: 'select_account' }, skipBrowserRedirect: true },
        });
        const { url, flowId } = reply.data;
        if (reply.error || typeof url !== 'string' || typeof flowId !== 'string' || !PKCE_FLOW_ID.test(flowId)) throw new Error('No authorize URL.');
        const stored = memory.get(`${storageKey}-flow-${flowId}-code-verifier`);
        const verifier: unknown = stored === undefined ? null : JSON.parse(stored);
        if (typeof verifier !== 'string' || !PKCE_VERIFIER.test(verifier)) throw new Error('No code verifier.');
        if (!(await isGoogleAuthorizeUrl(url, { authUrl, callbackUrl, verifier }))) throw new Error('Not the expected authorize URL.');
        return { url, flowId, verifier };
      } finally {
        // Its own local sign-out holds no session (so nothing is sent); then its RAM is emptied and it is disposed.
        await retire(client);
      }
    };

    /** The recorded attempt, removed at once (single use); null unless it is whole, for this callback and still fresh. */
    const takeRecord = (): GoogleAttemptRecord | null => {
      let taken: unknown = null;
      try {
        taken = google.store.take();
      } catch {
        taken = null;
      }
      const record = attemptRecord(taken);
      if (!record || record.callbackUrl !== callbackUrl) return null;
      const age = now() - record.createdAt;
      return age >= -RECORD_CLOCK_SKEW_MS && age <= GOOGLE_ATTEMPT_TTL_MS ? record : null;
    };

    /** The callback of `run`, whose record is in hand: refused unless it carries one valid code, which is exchanged once. */
    const exchange = async (run: GoogleRun, record: GoogleAttemptRecord, url: string): Promise<AuthIdentity> => {
      const callback = readGoogleCallback(url, callbackUrl);
      if (callback.kind !== 'code') {
        if (pending === run) pending = null;
        throw new AuthError(callback.kind === 'error' ? callback.code : 'bad_callback');
      }
      const storageKey = `ayailmu-google-${record.flowId}`;
      // The new client is given nothing but this attempt's verifier, in the slot the SDK reads for its flow id.
      const memory = new Map<string, string>([[`${storageKey}-flow-${record.flowId}-code-verifier`, JSON.stringify(record.verifier)]]);
      const { sdk, client } = buildGoogle(storageKey, memory);
      let reply: AuthTokenResponse | null = null;
      try {
        reply = await sdk.exchangeCodeForSession(callback.code, { flowId: record.flowId });
      } catch {
        // An SDK that throws instead of answering gave no usable reply.
      }
      if (pending === run) pending = null;
      const signedIn = reply && !reply.error ? signedInAs(reply.data.session) : null;
      if (run.dropped || !signedIn) {
        // Too late, or refused: nothing is adopted, and a session the Auth server made meanwhile is revoked.
        void retire(client);
        if (run.dropped) throw new AuthError(run.dropped);
        throw new AuthError(reply?.error ? exchangeRefusal(reply.error) : 'bad_response');
      }
      adopt(client, signedIn);
      return { ...signedIn.identity };
    };

    const attemptOf = (run: GoogleRun, url: string): GoogleAttempt => ({
      url,
      callbackUrl,
      complete(callback) {
        // Checked at once: a dropped, used or replaced attempt sends nothing and leaves any newer record alone.
        if (run.dropped) return Promise.reject(new AuthError(run.dropped));
        if (run.used || pending !== run) return Promise.reject(new AuthError('bad_callback'));
        run.used = true;
        const record = takeRecord();
        if (!record || record.flowId !== run.flowId) {
          if (pending === run) pending = null;
          return Promise.reject(new AuthError('bad_callback'));
        }
        return exchange(run, record, callback);
      },
      cancel() {
        if (run.used || run.dropped) return;
        run.dropped = 'cancelled';
        if (pending === run) pending = null;
        forgetGoogleAttempt();
      },
    });

    return {
      async start() {
        // A Google sign-in is never remembered, and any remembered password session goes first, at once. One whose record
        // cannot be cleared refuses this start before any client, PKCE pair or attempt record is made.
        if (!forgetBeforeSignIn()) throw new AuthError('not_forgotten');
        drop('superseded');
        const run: GoogleRun = { dropped: null, flowId: '', used: false };
        pending = run;
        let prepared: { url: string; flowId: string; verifier: string } | null = null;
        try {
          prepared = await prepare();
        } catch {
          prepared = null;
        }
        if (run.dropped) throw new AuthError(run.dropped);
        if (!prepared) {
          if (pending === run) pending = null;
          throw new AuthError('unavailable');
        }
        try {
          google.store.save({ v: 1, flowId: prepared.flowId, verifier: prepared.verifier, callbackUrl, createdAt: now() });
        } catch {
          if (pending === run) pending = null;
          throw new AuthError('unavailable');
        }
        run.flowId = prepared.flowId;
        return attemptOf(run, prepared.url);
      },

      resume(launchUrl) {
        // Taken at once, whatever follows: the record is single use.
        const record = takeRecord();
        if (launchUrl === null) return Promise.resolve(null);
        if (!record) return Promise.reject(new AuthError('bad_callback'));
        // As at a start: a remembered record that cannot be cleared refuses this exchange before its client is built.
        if (!forgetBeforeSignIn()) return Promise.reject(new AuthError('not_forgotten'));
        drop('superseded');
        const run: GoogleRun = { dropped: null, flowId: record.flowId, used: true };
        pending = run;
        return exchange(run, record, launchUrl);
      },
    };
  };

  const createRecovery = recoveryOptions?.createClient ?? createRecoveryAuthClient;

  /**
   * Email password recovery's callback, on dedicated SDK clients of its own: never the normal or Google sign-in's
   * clients, store or pending attempt. A callback is checked before anything is taken, built or sent; then the pending
   * attempt is taken (single use) and checked, and its code is exchanged once by a new client given nothing but that
   * attempt's verifier. The recovery session it gets is held privately, only to change the password: it never becomes
   * the signed-in session, and its token is never handed to authorized calls. A sign-out, a newer sign-in, a newer
   * recovery or cancel ends it, and a recovery session is then retired through its own client's local sign-out only.
   */
  const passwordRecovery = (recovery: RecoveryOptions): PasswordRecovery => {
    const callbackUrl = recovery.config.callbackUrl;
    /**
     * When this adapter last sent a request: set as it goes, before its reply, and kept whatever the reply. For
     * RECOVERY_COOLDOWN_MS after it, another request sends nothing.
     */
    let lastSent: number | null = null;

    /**
     * A storage key no other client, realm or copied attempt shares, so neither does the SDK's lock or page channel named
     * after it: this realm's count and a nonce from the runtime's secure entropy (the native port's in the private QA
     * profile). Throws without that entropy; there is no weaker stand-in.
     */
    const ownStorageKey = (prefix: string): string => {
      const nonce = privateCrypto
        ? hex(secureBytes(privateCrypto, 16))
        : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      clientsBuilt += 1;
      return `${prefix}-${clientsBuilt}-${nonce}`;
    };

    /** The pending attempt, removed at once (single use); null unless it is whole, bound to this Auth origin, profile and callback, and fresh. */
    const takeRecord = (): RecoveryAttemptRecord | null => {
      let taken: unknown = null;
      try {
        taken = recovery.store.take();
      } catch {
        taken = null;
      }
      const record = recoveryAttemptRecord(taken);
      if (!record || record.callbackUrl !== callbackUrl || record.auth !== authUrl || record.profile !== profile) return null;
      const age = now() - record.createdAt;
      return age >= -RECOVERY_CLOCK_SKEW_MS && age <= RECOVERY_ATTEMPT_TTL_MS ? record : null;
    };

    /** One recovery client: PKCE over a RAM storage of its own (all the SDK keeps), through the bounded transport. */
    const buildRecovery = (storageKey: string, memory: Map<string, string>): { sdk: RecoverySdkClient; client: Client } => {
      const seen: Seen = { requests: 0, logoutStatus: null };
      const sdk = createRecovery({
        url: authUrl,
        storageKey,
        flowType: 'pkce',
        // The SDK uses a given storage only with persistSession; this one is the client's own RAM, so nothing persists.
        persistSession: true,
        storage: ramStorage(memory),
        detectSessionInUrl: false,
        autoRefreshToken: false,
        debug: false,
        fetch: boundTransport(authUrl, () => injected ?? globalThis.fetch, seen),
      });
      // Torn down as a Google client is once retired: its RAM emptied, then disposed. It never becomes a session.
      return { sdk, client: { sdk, seen, retired: null, google: { memory, storageKey, dispose: () => sdk.dispose() } } };
    };

    const newRun = (): RecoveryRun => ({ dropped: null, candidate: null, held: null, updating: false, abort: null });

    /** Native hashing cannot be aborted by Expo: fence this wait itself and ignore any late digest. */
    const privateDigest = (run: RecoveryRun, port: RecoveryCrypto, data: Uint8Array): Promise<Uint8Array> =>
      new Promise<Uint8Array>((resolve, reject) => {
        let done = false;
        const settle = (digest: Uint8Array | null) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (run.abort === stop) run.abort = null;
          if (digest !== null) resolve(digest);
          else reject(new AuthError('unavailable'));
        };
        const stop = () => settle(null);
        const timer = setTimeout(stop, AUTH_REQUEST_TIMEOUT_MS);
        if (run.dropped) return stop();
        // Installed before invoking native crypto, including a port that never answers.
        run.abort = stop;
        sha256Bytes(port, data).then((digest) => settle(digest), stop);
      });

    /**
     * Private QA only: one request of `run` to an address this adapter built under its Auth root, through the injected
     * bound fetch, without credentials, cookies or redirects followed. It settles within AUTH_REQUEST_TIMEOUT_MS, or at
     * once when the run is fenced, whether or not the fetch underneath honours its abort. Its reply body is never read.
     */
    const privateCall = (run: RecoveryRun, url: string, init: RequestInit): Promise<Response> => {
      const base = injected as typeof fetch;
      const controller = new AbortController();
      return new Promise<Response>((resolve, reject) => {
        let done = false;
        const settle = (reply: Response | null) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (run.abort === stop) run.abort = null;
          if (reply) resolve(reply);
          else {
            controller.abort();
            reject(new Error('The private Auth server could not be reached.'));
          }
        };
        const stop = () => settle(null);
        const timer = setTimeout(stop, AUTH_REQUEST_TIMEOUT_MS);
        if (run.dropped) return stop();
        run.abort = stop;
        let sent: Promise<Response>;
        try {
          sent = Promise.resolve(base(url, { ...init, credentials: 'omit', redirect: 'manual', signal: controller.signal }));
        } catch {
          sent = Promise.reject(new Error('No reply.'));
        }
        sent.then(
          (reply) => {
            if (done) return;
            try {
              // Nothing of the body is wanted: it is let go unread where the fetch underneath allows.
              void (reply as { body?: { cancel?: () => Promise<void> } | null }).body?.cancel?.()?.catch?.(() => undefined);
            } catch {
              // Let go either way.
            }
            settle(typeof reply?.status === 'number' ? reply : null);
          },
          () => settle(null)
        );
      });
    };

    /**
     * Private QA only: a request through the native port and the bound fetch, never the SDK's own (WebCrypto) PKCE. The
     * address is exactly the approved recipient, or private_recipient before anything else. Within the cooldown the same
     * result, nothing sent. Otherwise the older attempt goes first, this run is established, a fresh flow ID and verifier
     * come from the port's entropy and the verifier (as is, never suffixed) is hashed; a cancel, sign-out or newer intent
     * meanwhile settles it before anything is sent or saved. One POST to /recover with the exact callback carries the
     * address and the S256 challenge; on a 2xx only the seven-key attempt is saved.
     */
    const requestPrivate = async (port: RecoveryCrypto, email: string): Promise<{ requested: true }> => {
      const refused = signInAddressRefusal(email, profile);
      if (refused !== null) throw new AuthError(refused);
      const at = now();
      if (lastSent !== null && Math.abs(at - lastSent) < RECOVERY_COOLDOWN_MS) return { requested: true };
      try {
        recovery.store.clear();
      } catch {
        throw new AuthError('unavailable');
      }
      void fenceRecovery('superseded');
      const run = newRun();
      recovering = run;
      const leave = () => {
        if (recovering === run) recovering = null;
      };
      let record: RecoveryAttemptRecord | null = null;
      let challenge: string | null = null;
      try {
        const flowId = hex(secureBytes(port, 16));
        const verifier = hex(secureBytes(port, 32));
        record = recoveryAttemptRecord({ v: 1, flowId, verifier, callbackUrl, createdAt: at, auth: authUrl, profile });
        if (record) challenge = base64Url(await privateDigest(run, port, asciiBytes(record.verifier)));
      } catch {
        challenge = null;
      }
      if (run.dropped) throw new AuthError(run.dropped);
      if (!record || !challenge) {
        leave();
        throw new AuthError('unavailable');
      }
      // Native hashing may have waited: bind the lifetime and cooldown to actual egress.
      const sentAt = now();
      record = { ...record, createdAt: sentAt };
      lastSent = sentAt;
      let reply: Response | null = null;
      try {
        reply = await privateCall(run, `${authUrl}/recover?redirect_to=${encodeURIComponent(callbackUrl)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
          body: JSON.stringify({ email, code_challenge: challenge, code_challenge_method: 's256' }),
        });
      } catch {
        reply = null;
      }
      leave();
      if (run.dropped) throw new AuthError(run.dropped);
      if (!reply) throw new AuthError('network');
      if (reply.status < 200 || reply.status >= 300) throw new AuthError('provider_refused');
      try {
        recovery.store.save(record);
      } catch {
        throw new AuthError('unavailable');
      }
      return { requested: true };
    };

    /**
     * Exchanges `code` once for `run`, on a new client given nothing but `record`'s verifier in the slot the SDK keeps for a
     * recovery flow. The recovery session it gets is held, never adopted; in the private QA profile only when it is the
     * approved recipient's.
     */
    const exchangeOnce = async (run: RecoveryRun, record: RecoveryAttemptRecord, code: string, storageKey: string): Promise<{ ready: true }> => {
      // Given nothing but this attempt's verifier, in the slot and form the SDK keeps for a recovery flow.
      const memory = new Map<string, string>([[`${storageKey}-flow-${record.flowId}-code-verifier`, JSON.stringify(`${record.verifier}/recovery`)]]);
      let built: { sdk: RecoverySdkClient; client: Client };
      try {
        built = buildRecovery(storageKey, memory);
      } catch {
        if (recovering === run) recovering = null;
        throw new AuthError('unavailable');
      }
      let reply: AuthTokenResponse | null = null;
      try {
        reply = await built.sdk.exchangeCodeForSession(code, { flowId: record.flowId });
      } catch {
        // An SDK that throws instead of answering gave no usable reply.
      }
      const signedIn = reply && !reply.error ? signedInAs(reply.data.session) : null;
      const held = signedIn && (!privateCrypto || isPrivateQaRecipient(signedIn.identity.email)) ? signedIn : null;
      if (run.dropped || !held) {
        if (recovering === run) recovering = null;
        // Too late, refused or not the approved owner's: nothing is kept, and a recovery session the Auth server made
        // meanwhile is revoked, through this client's own local sign-out, before this settles.
        await retire(built.client);
        if (run.dropped) throw new AuthError(run.dropped);
        throw new AuthError(reply?.error ? exchangeRefusal(reply.error) : 'bad_response');
      }
      run.candidate = built.client;
      // Usable no longer than its link's lifetime, and never past the recovery session's own expiry.
      const until = Math.min(record.createdAt + RECOVERY_ATTEMPT_TTL_MS, held.identity.expiresAt ?? Number.POSITIVE_INFINITY);
      if (privateCrypto && now() >= until) {
        if (recovering === run) recovering = null;
        run.candidate = null;
        await retire(built.client);
        throw new AuthError('expired');
      }
      run.held = { sdk: built.sdk, identity: held.identity, until };
      return { ready: true };
    };

    /**
     * Private QA only: a wrapped link's verification, `verifyUrl` as readWrappedRecoveryCallback rebuilt it. The pending
     * attempt is taken (single use) before anything is sent; then one GET, bounded and without credentials, must answer
     * exactly 303 with a Location that is exactly the callback with one canonical code (an error redirect is no success),
     * which is exchanged once. A cancel, sign-out or newer intent meanwhile fences the late reply and the exchange.
     */
    const resumeWrapped = async (verifyUrl: string): Promise<{ ready: true }> => {
      const record = takeRecord();
      if (!record) throw new AuthError('bad_callback');
      let storageKey: string;
      try {
        storageKey = ownStorageKey('ayailmu-recovery');
      } catch {
        throw new AuthError('unavailable');
      }
      void fenceRecovery('superseded');
      const run = newRun();
      recovering = run;
      let reply: Response | null = null;
      try {
        reply = await privateCall(run, verifyUrl, { method: 'GET' });
      } catch {
        reply = null;
      }
      if (run.dropped) throw new AuthError(run.dropped);
      const location = reply?.status === 303 && typeof reply.headers?.get === 'function' ? reply.headers.get('location') : null;
      const code = readRecoveryCallback(location, callbackUrl);
      if (code === null) {
        if (recovering === run) recovering = null;
        throw new AuthError(reply ? 'bad_callback' : 'network');
      }
      return exchangeOnce(run, record, code, storageKey);
    };

    return {
      async request(email) {
        if (privateCrypto) return requestPrivate(privateCrypto, email);
        // As for sign-in, the profile validated when this adapter was built chooses: a production build takes a
        // conventional address (its format only); local and staging builds, synthetic .test ones only.
        if (profile === 'production' && !isConventionalAddress(email)) throw new AuthError('invalid_email');
        if (profile !== 'production' && !isSyntheticAddress(email)) throw new AuthError('not_synthetic');
        // Only with the runtime's own secure entropy and SHA-256: the SDK would otherwise use Math.random and a plain challenge.
        if (missingWebCrypto() !== null) throw new AuthError('unavailable');
        const at = now();
        // Within the cooldown, even while that request is still on its way: the same result, nothing sent, and the
        // attempt pending (or still to come) kept.
        if (lastSent !== null && Math.abs(at - lastSent) < RECOVERY_COOLDOWN_MS) return { requested: true };
        let storageKey: string;
        try {
          storageKey = ownStorageKey('ayailmu-recovery-request');
        } catch {
          throw new AuthError('unavailable');
        }
        // The older attempt goes before anything is sent, so its link never resumes whatever this request meets. A store
        // that will not clear refuses this request instead, unsent.
        try {
          recovery.store.clear();
        } catch {
          throw new AuthError('unavailable');
        }
        // A newer recovery replaces one under way, whose recovery session, if any, is retired.
        void fenceRecovery('superseded');
        const run = newRun();
        recovering = run;
        const memory = new Map<string, string>();
        let built: { sdk: RecoverySdkClient; client: Client };
        try {
          built = buildRecovery(storageKey, memory);
        } catch {
          if (recovering === run) recovering = null;
          throw new AuthError('unavailable');
        }
        // The cooldown starts as the request goes, and stays if it fails.
        lastSent = at;
        let error: unknown = null;
        try {
          ({ error } = await built.sdk.resetPasswordForEmail(email, { redirectTo: callbackUrl }));
        } catch {
          error = new Error('No usable reply.');
        }
        // The flow this request made, read before the client is torn down: it never held a session, so nothing is signed out.
        const flow = recoveryFlow(memory, storageKey);
        await discard(built.client);
        if (recovering === run) recovering = null;
        // Cancelled, signed out or overtaken meanwhile: nothing is saved.
        if (run.dropped) throw new AuthError(run.dropped);
        if (error) throw new AuthError(requestRefusal(error));
        const record = flow ? recoveryAttemptRecord({ v: 1, ...flow, callbackUrl, createdAt: at, auth: authUrl, profile }) : null;
        if (!record) throw new AuthError('bad_response');
        try {
          recovery.store.save(record);
        } catch {
          throw new AuthError('unavailable');
        }
        return { requested: true };
      },

      async resume(url) {
        // The private QA profile also takes its wrapped link; anything else goes on to the exact code callback's check.
        const verifyUrl = privateCrypto ? readWrappedRecoveryCallback(url, callbackUrl, authUrl) : null;
        if (verifyUrl !== null) return resumeWrapped(verifyUrl);
        const code = readRecoveryCallback(url, callbackUrl);
        if (code === null) throw new AuthError('bad_callback');
        const record = takeRecord();
        if (!record) throw new AuthError('bad_callback');
        let storageKey: string;
        try {
          storageKey = ownStorageKey('ayailmu-recovery');
        } catch {
          throw new AuthError('unavailable');
        }
        // A newer recovery replaces one under way, whose recovery session, if any, is retired.
        void fenceRecovery('superseded');
        const run = newRun();
        recovering = run;
        return exchangeOnce(run, record, code, storageKey);
      },

      async update(password) {
        const run = recovering;
        const ready = run?.held;
        // Checked at once: no ready recovery session, or an update already on its way through it, sends nothing.
        if (!run || !ready || run.dropped || run.updating) throw new AuthError('bad_callback');
        /** Ends this run, if it is still the one under way: its recovery session is retired on this device only. */
        const end = async () => {
          const retiring = recovering === run ? fenceRecovery('cancelled') : null;
          if (retiring) await retiring;
        };
        if (now() >= ready.until) {
          await end();
          throw new AuthError('expired');
        }
        run.updating = true;
        let reply: UserResponse | null = null;
        try {
          reply = await ready.sdk.updateUser({ password });
        } catch {
          // An SDK that throws instead of answering gave no usable reply.
        }
        run.updating = false;
        // Cancelled, signed out or overtaken meanwhile: its recovery session is already retired, and nothing is claimed.
        if (run.dropped) throw new AuthError(run.dropped);
        const error = reply?.error ?? null;
        // Refused as weak: the same recovery session stays ready for a corrected try.
        if (error?.code === 'weak_password') throw new AuthError('weak_password');
        // Unreachable: the session stays; whether the password changed is unknown, so nothing is claimed.
        if (error && isAuthRetryableFetchError(error)) throw new AuthError('network');
        if (error) {
          await end();
          const spent = isAuthSessionMissingError(error) || (isAuthApiError(error) && (error.status === 401 || error.status === 403));
          throw new AuthError(spent ? 'expired' : 'provider_refused');
        }
        if (reply?.data.user?.id !== ready.identity.uid) {
          await end();
          throw new AuthError('bad_response');
        }
        // Done: its authority to update goes at once, so no other update can go through it. The run stays the one under
        // way while its recovery session is retired, so a cancel, sign-out or newer sign-in or recovery meanwhile still
        // overtakes it; then this settles with that code, never a stale success (the password may have changed all the same).
        run.held = null;
        const candidate = run.candidate;
        run.candidate = null;
        const { revoked } = candidate ? await retire(candidate) : { revoked: false };
        if (run.dropped) throw new AuthError(run.dropped);
        if (recovering === run) recovering = null;
        return { updated: true, revoked };
      },

      async cancel() {
        const retiring = fenceRecovery('cancelled');
        try {
          recovery.store.clear();
        } catch {
          // Nothing kept to remove.
        }
        if (retiring) await retiring;
      },
    };
  };

  const auth: SupabaseAuth = {
    /**
     * The latest sign-in wins: one still on its way is dropped as superseded, and sign-out drops it as signed out.
     * A dropped attempt settles with that code whatever its reply was, and its client is retired, so its session can
     * replace neither the identity nor the SDK session in use. Only a successful latest attempt replaces the session
     * (whose running calls are superseded and whose client is retired).
     */
    async signIn(email, password) {
      // The profile validated when this adapter was built, never the caller's configuration as it is now, chooses: a
      // production build takes a conventional address (its format only); a private QA build exactly its approved recipient
      // (any other well-formed one is private_recipient); local and staging builds, synthetic .test ones only. A refused
      // address builds no client and sends nothing.
      const refused = signInAddressRefusal(email, profile);
      if (refused !== null) throw new AuthError(refused);
      // A newer sign-in: any remembered session goes first, at once. One whose record cannot be cleared refuses this
      // sign-in before anything is dropped, built or sent. This one is remembered only if the learner chooses so again.
      if (!forgetBeforeSignIn()) throw new AuthError('not_forgotten');
      drop('superseded');
      const attempt: Attempt = { dropped: null };
      pending = attempt;
      let client: (Client & { sdk: SdkClient }) | null = null;
      let reply: AuthTokenResponsePassword | null = null;
      try {
        client = build();
        reply = await client.sdk.signInWithPassword({ email, password });
      } catch {
        // An SDK that throws instead of answering gave no usable reply.
      }
      if (pending === attempt) pending = null;
      const signedIn = reply && !reply.error ? signedInAs(reply.data.session) : null;
      // The reply must be for the address asked for: case-insensitively, except that a private QA build takes exactly its
      // approved recipient as written (a case variant is not that recipient, and is retired before it is adopted).
      if (
        attempt.dropped ||
        !client ||
        !signedIn ||
        signedIn.identity.email.toLowerCase() !== email.toLowerCase() ||
        (profile === PRIVATE_QA && !isPrivateQaRecipient(signedIn.identity.email))
      ) {
        if (client) retire(client);
        if (attempt.dropped) throw new AuthError(attempt.dropped);
        throw new AuthError(reply?.error ? signInRefusal(reply.error) : 'bad_response');
      }
      adopt(client, signedIn, refreshTokenOf(reply?.data.session));
      return { ...signedIn.identity };
    },

    async refresh() {
      const s = session;
      if (!s) throw new AuthError('signed_out');
      // A Google session is refreshed through a fresh client of its own (renewGoogle), one refresh at a time.
      if (s.client.google) {
        const renewing =
          s.renewing ??
          (s.renewing = renewGoogle(s).finally(() => {
            s.renewing = null;
          }));
        return { ...(await renewing) };
      }
      let reply: AuthResponse | null = null;
      try {
        reply = await s.client.sdk.refreshSession();
      } catch {
        // An SDK that throws instead of answering gave no usable reply.
      }
      // Ended or replaced meanwhile: whatever came back is dropped (its client is already retired).
      if (s.ended) throw new AuthError(s.ended);
      // Unreachable: the session and the SDK's session stay, and may retry.
      if (reply?.error && isAuthRetryableFetchError(reply.error)) throw new AuthError('network');
      const renewed = reply && !reply.error ? signedInAs(reply.data.session) : null;
      if (!renewed || renewed.identity.uid !== s.identity.uid || renewed.identity.email !== s.identity.email) {
        // Refused, or a reply that is not this account's: the session ends, and nothing in the reply is adopted.
        close(s);
        const refused = reply?.error && (isAuthApiError(reply.error) || isAuthSessionMissingError(reply.error));
        throw new AuthError(refused ? 'expired' : 'bad_response');
      }
      s.identity = renewed.identity;
      s.token = renewed.token;
      s.expired = false;
      if (vault) keepRotated(s, refreshTokenOf(reply?.data.session));
      return { ...s.identity };
    },

    signOut() {
      drop('signed_out');
      const forgotten = forget();
      const s = session;
      const signedOut: Promise<SignOutOutcome> = s ? close(s) : Promise.resolve({ revoked: false });
      // Only a vault that refused is reported: its record may still be there, so it is never claimed forgotten.
      return forgotten ? signedOut : signedOut.then(({ revoked }) => ({ revoked, forgotten: false }));
    },

    status(): AuthStatus {
      const s = session;
      if (!s) return { state: 'signed-out' };
      const identity = { ...s.identity };
      return isExpired(s) ? { state: 'expired', identity } : { state: 'signed-in', identity, session: s.number };
    },

    authorized<T>(call: (token: string, signal: AbortSignal) => Promise<T>): Promise<T> {
      const s = session;
      if (!s) return Promise.reject(new AuthError('signed_out'));
      if (isExpired(s)) return Promise.reject(new AuthError('expired'));
      const token = s.token;
      return new Promise<T>((resolve, reject) => {
        const controller = new AbortController();
        let settled = false;
        const cancel = (code: Dropped) => {
          if (settled) return;
          settled = true;
          controller.abort();
          reject(new AuthError(code));
        };
        s.calls.add(cancel);
        /**
         * Settles once; after a cancel, the call's late result or error changes nothing. Once it has settled, the call's
         * signal is aborted (the session has let go of the call first, and `settled` guards re-entry), so work still
         * running on it, such as a request the API client stopped waiting for at its deadline, is cancelled wherever
         * fetch honours that.
         */
        const finish = (settle: () => void) => {
          s.calls.delete(cancel);
          if (settled) return;
          settled = true;
          settle();
          controller.abort();
        };
        let running: Promise<T>;
        try {
          running = Promise.resolve(call(token, controller.signal));
        } catch (error) {
          running = Promise.reject(error);
        }
        running.then(
          (value) => finish(() => resolve(value)),
          (error: unknown) =>
            finish(() => {
              const answer = (typeof error === 'object' && error !== null ? error : {}) as { status?: unknown; code?: unknown };
              if (answer.status !== 401) {
                reject(error);
              } else if (answer.code === 'reauthentication_required') {
                // The API's step-up: this request needs a recent password sign-in. The session stays as it is.
                reject(new AuthError('reauthentication_required'));
              } else {
                // A plain 401: the API refused this token, so the session's authorization ends until a refresh.
                if (s.token === token) {
                  s.expired = true;
                  s.token = '';
                }
                reject(new AuthError('expired'));
              }
            })
        );
      });
    },
  };

  /**
   * Clears the record read as `text`, unless the vault holds another one by now. That check and the clear run together
   * synchronously, so a clear here never erases a newer saved record.
   */
  const forgetRead = (store: SessionVault, text: string) => {
    try {
      if (store.read() !== text) return;
    } catch {
      // Unreadable now: cleared all the same.
    }
    try {
      store.clear();
    } catch {
      // Left behind: the next run meets the same answer.
    }
  };

  /** auth.remembered over `store`. */
  const rememberedSessions = (store: SessionVault): RememberedSessions => ({
    async save(accountId) {
      const s = session;
      if (!s || s.ended || s.client.google || !s.refreshToken || !isCanonicalUuid(accountId) || isExpired(s)) return false;
      try {
        const record: RememberedRecord = {
          v: 1,
          kind: 'password',
          installation: store.installation(),
          auth: authUrl,
          api: apiOrigin,
          profile,
          uid: s.identity.uid,
          email: s.identity.email,
          accountId,
          refreshToken: s.refreshToken,
          // The time of the learner's choice: the session is remembered for at most 30 days from it.
          savedAt: new Date(now()).toISOString(),
        };
        if (typeof record.installation !== 'string' || record.installation === '') throw new Error('No installation marker.');
        store.write(recordText(record));
        s.remembered = record;
        return true;
      } catch {
        // Not saved, and not remembered: whatever the vault may hold of it is cleared, as far as it allows.
        s.remembered = null;
        try {
          store.clear();
        } catch {
          // Nothing more can be done here.
        }
        return false;
      }
    },

    async restore() {
      // Read and checked at once, before anything is sent. A record that is not valid here (or cannot be read) is cleared, unsent.
      let text: string | null = null;
      let record: RememberedRecord | null = null;
      try {
        text = store.read();
        if (text === null) return null;
        record = rememberedRecord(text, { installation: store.installation(), auth: authUrl, api: apiOrigin, profile }, now());
      } catch {
        record = null;
      }
      if (!record || text === null) {
        try {
          store.clear();
        } catch {
          // Left behind: it never restores.
        }
        return null;
      }
      // A sign-in like any other: the latest wins.
      drop('superseded');
      const attempt: Attempt = { dropped: null };
      pending = attempt;
      let client: (Client & { sdk: SdkClient }) | null = null;
      let reply: AuthResponse | null = null;
      try {
        client = build();
        // Presented once, to a fresh client holding nothing, so exactly one refresh grant is sent.
        reply = await client.sdk.refreshSession({ refresh_token: record.refreshToken });
      } catch {
        // An SDK that throws instead of answering gave no usable reply.
      }
      if (pending === attempt) pending = null;
      // Signed out, or overtaken by a newer sign-in, meanwhile: nothing is adopted or written back, and whatever the
      // fresh client got is revoked.
      if (attempt.dropped) {
        if (client) void retire(client);
        throw new AuthError(attempt.dropped);
      }
      if (!client) throw new AuthError('bad_response');
      // Unreachable, or the reply was lost: nothing is adopted, and the record stays. A token the server rotated without
      // a reply is refused next time, and that refusal clears the record.
      if (reply?.error && isAuthRetryableFetchError(reply.error)) {
        void discard(client);
        throw new AuthError('network');
      }
      const given = reply && !reply.error ? reply.data.session : null;
      const signedIn = signedInAs(given);
      const refreshToken = refreshTokenOf(given);
      if (!signedIn || !refreshToken || signedIn.identity.uid !== record.uid || signedIn.identity.email !== record.email) {
        // Refused, or not the record's own user: the record goes, and whatever the fresh client got is revoked.
        forgetRead(store, text);
        void retire(client);
        const refused = reply?.error && (isAuthApiError(reply.error) || isAuthSessionMissingError(reply.error));
        throw new AuthError(refused ? 'expired' : 'bad_response');
      }
      // The rotated token is written back at once, every other field (its save time included) unchanged. If it would not
      // fit or the vault will not take it, the record left behind is spent: it goes, and nothing is adopted.
      const rotated: RememberedRecord = { ...record, refreshToken };
      try {
        store.write(recordText(rotated));
      } catch {
        forgetRead(store, text);
        void retire(client);
        throw new AuthError('bad_response');
      }
      adopt(client, signedIn, refreshToken).remembered = rotated;
      return { identity: { ...signedIn.identity }, accountId: record.accountId };
    },

    release() {
      // Leaving this run: a sign-in on its way is dropped, and whatever it gets is revoked.
      drop('signed_out');
      const s = session;
      if (!s) return Promise.resolve();
      if (!s.remembered) return close(s).then(() => undefined);
      // Let go here without a logout, which would revoke the very session the record keeps.
      session = null;
      end(s, 'signed_out');
      return discard(s.client).then(() => undefined);
    },
  });

  if (googleOptions) auth.google = continueWithGoogle(googleOptions);
  if (vault) auth.remembered = rememberedSessions(vault);
  if (recoveryOptions) auth.recovery = passwordRecovery(recoveryOptions);
  return auth;
}
