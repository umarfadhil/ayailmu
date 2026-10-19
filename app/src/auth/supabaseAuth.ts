// Sign-in against the local Supabase Auth server (in a staging build, the standalone staging one, also at its root)
// through its maintained SDK (@supabase/auth-js AuthClient): a password sign-in for the prepared synthetic .test
// identities only (sign-up is off), and, where the build turns it on, Continue
// with Google through the Auth server's authorization code + PKCE flow. Each sign-in gets its own SDK client, kept in
// memory only (no persistence, no URL detection, no debug output, no background refresh, no API key), which reaches the
// Auth root only through a bounded transport without cookies or redirects. The latest sign-in wins; a client that loses
// or is replaced is retired through the SDK's own local sign-out and never used again (a Google session's refresh hands
// it on to a fresh client of its own, and the earlier one is let go without a sign-out). Tokens stay inside: only
// authorized calls receive the current access token, and nothing is stored, logged or put in a URL.
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
} from '@supabase/auth-js';
import { isSafeGoogleConfig } from '@/account/googleConfig';
import { accountApiOrigin } from '@/account/staging';
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
import { AuthError, type AccountAuth, type AuthErrorCode, type AuthIdentity, type AuthStatus, type SignOutOutcome } from '@/auth/types';

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
}

/** The local Supabase Auth sign-in, with Continue with Google where the build turns it on. */
export type SupabaseAuth = AccountAuth & { google?: GoogleSignIn };

const createAuthClient: CreateSdkClient = (options) => new AuthClient(options);
const createGoogleAuthClient = (options: GoTrueClientOptions): GoogleSdkClient => new AuthClient(options);

/** Numbers the SDK clients built, so that each has its own storage key (and so its own SDK lock in a browser). */
let clientsBuilt = 0;

/** A synthetic local-demo address: a .test domain (reserved, never deliverable), as for the emulator pilot. */
const SYNTHETIC_ADDRESS = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+test$/i;
const isSyntheticAddress = (email: unknown): email is string =>
  typeof email === 'string' && email.length <= 254 && SYNTHETIC_ADDRESS.test(email);

/** How far a Google attempt's record may claim to start in the future (a clock that moved) and still count. */
const RECORD_CLOCK_SKEW_MS = 60_000;

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
  // Revalidated here too, under the configuration's own profile: an unsafe or legacy configuration, an unknown profile,
  // an API or Auth address that is not exactly that profile's (local, or under the staging profile a staging root origin,
  // so Auth is always at its root), or a Google web callback of the other profile builds no client and sends nothing.
  const config = options.config;
  const authUrl =
    config?.enabled === true && config.provider === LOCAL_SUPABASE && accountApiOrigin(config.apiBaseUrl, config.environment) !== null
      ? accountAuthOrigin(config.authUrl, config.environment)
      : null;
  if (!authUrl) throw new Error('createSupabaseAuth needs a local or staging Supabase Auth configuration; nothing was sent.');
  const googleOptions = options.google;
  if (googleOptions !== undefined && (!isSafeGoogleConfig(googleOptions.config, config.environment) || !googleOptions.store)) {
    throw new Error('createSupabaseAuth needs a safe Google sign-in configuration; nothing was sent.');
  }
  const createClient = options.createClient ?? createAuthClient;
  const injected = options.fetch;
  const now = options.now ?? Date.now;

  let session: Session | null = null;
  let pending: Attempt | null = null;
  let sessions = 0;

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

  /** Signs the session out here at once, then retires its client. */
  const close = (s: Session): Promise<SignOutOutcome> => {
    if (session === s) session = null;
    end(s, 'signed_out');
    return retire(s.client);
  };

  /** A sign-in succeeded: its session replaces the one in use, whose running calls are superseded and whose client is retired. */
  const adopt = (client: Client, signedIn: { identity: AuthIdentity; token: string }) => {
    const previous = session;
    sessions += 1;
    session = { number: sessions, client, identity: signedIn.identity, token: signedIn.token, expired: false, ended: null, calls: new Set(), renewing: null };
    if (previous) {
      end(previous, 'superseded');
      retire(previous.client);
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

  /** A newer sign-in or a sign-out: the sign-in on its way is dropped with `code`, and any recorded Google attempt goes. */
  const drop = (code: Dropped) => {
    if (pending) pending.dropped = code;
    pending = null;
    forgetGoogleAttempt();
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
        drop('superseded');
        const run: GoogleRun = { dropped: null, flowId: record.flowId, used: true };
        pending = run;
        return exchange(run, record, launchUrl);
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
      if (!isSyntheticAddress(email)) throw new AuthError('not_synthetic');
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
      if (attempt.dropped || !client || !signedIn || signedIn.identity.email.toLowerCase() !== email.toLowerCase()) {
        if (client) retire(client);
        if (attempt.dropped) throw new AuthError(attempt.dropped);
        throw new AuthError(reply?.error ? signInRefusal(reply.error) : 'bad_response');
      }
      adopt(client, signedIn);
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
      return { ...s.identity };
    },

    signOut() {
      drop('signed_out');
      const s = session;
      return s ? close(s) : Promise.resolve({ revoked: false });
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
        /** Settles once; after a cancel, the call's late result or error changes nothing. */
        const finish = (settle: () => void) => {
          s.calls.delete(cancel);
          if (settled) return;
          settled = true;
          settle();
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

  if (googleOptions) auth.google = continueWithGoogle(googleOptions);
  return auth;
}
