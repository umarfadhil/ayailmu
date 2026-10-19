// Provider-neutral account sign-in: the error codes, identity, status and port that sign-in adapters share and that
// the account session and sync rely on. Tokens never appear in these values; only authorized calls receive one.
// (The legacy Firebase emulator pilot, emulatorAuth.ts, re-exports these, so every provider shares one AuthError.)

export type AuthErrorCode =
  /** The address is not a synthetic local-demo address (a .test domain). */
  | 'not_synthetic'
  | 'invalid_credentials'
  /** Legacy emulator sign-up only: the address is already registered. */
  | 'email_exists'
  /** Legacy emulator sign-up only: the emulator refused the password. */
  | 'weak_password'
  | 'bad_response'
  | 'network'
  /** The token expired, the API answered 401 or the provider refused a refresh: refresh, or sign in again. Local data is kept. */
  | 'expired'
  /** The API needs a recent password sign-in for this request (a step-up); the session stays signed in. */
  | 'reauthentication_required'
  /** The session ended before this settled; its result was dropped. */
  | 'signed_out'
  /** A newer sign-in replaced this one; its result was dropped. */
  | 'superseded'
  /** Google: the learner closed the browser or declined at Google. Nothing was adopted. */
  | 'cancelled'
  /** Google: not the pending attempt's exact callback, a used or expired one, or a code the Auth server refused. */
  | 'bad_callback'
  /** Google: the Auth server has sign-up off and does not know this Google account. */
  | 'not_registered'
  /** Google: Google or the Auth server refused the sign-in for another reason. */
  | 'provider_refused'
  /** Google: this platform cannot run the flow safely (no secure WebCrypto, or no place for the attempt's record). */
  | 'unavailable';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(`Account sign-in problem: ${code}`);
    this.name = 'AuthError';
  }
}

export interface AuthIdentity {
  /** The provider's account ID: a canonical UUID for local Supabase Auth. */
  uid: string;
  email: string;
  /** When the access token expires (ms since the epoch), or null when the provider gave no expiry. */
  expiresAt: number | null;
}

export type AuthStatus =
  | { state: 'signed-out' }
  /** session numbers each sign-in, password or Google (a refresh keeps it), so later work can tell sessions apart. */
  | { state: 'signed-in'; identity: AuthIdentity; session: number }
  | { state: 'expired'; identity: AuthIdentity };

/** What signing out achieved beyond this device; on the device itself the session always ends at once. */
export interface SignOutOutcome {
  /** True when the provider confirmed it revoked the session; false when that request failed or was refused. */
  revoked: boolean;
}

/** An app's account sign-in. Tokens stay inside: only authorized calls receive the current access token. */
export interface AccountAuth {
  /** A password sign-in. The latest one wins: an older sign-in still on its way settles as superseded. */
  signIn(email: string, password: string): Promise<AuthIdentity>;
  /**
   * Renews the access token through the provider, keeping the identity and the session number; an expired session
   * recovers this way. Rejects with network when the provider was unreachable (the session stays and may retry), and
   * with expired when the provider refused (the session ends: sign in again).
   */
  refresh(): Promise<AuthIdentity>;
  /**
   * Ends the session at once: its calls are aborted and their results dropped, and no token is handed out again.
   * Then asks the provider to revoke it for this device only; the outcome says whether the provider confirmed that.
   */
  signOut(): Promise<SignOutOutcome>;
  status(): AuthStatus;
  /**
   * Runs call with the current access token and an abort signal. Rejects with expired when the token has expired or
   * the API answered a plain 401 (that session's authorization ends); with reauthentication_required on the API's
   * step-up 401 (the session stays); with signed_out or superseded when the session ended or was replaced first.
   */
  authorized<T>(call: (token: string, signal: AbortSignal) => Promise<T>): Promise<T>;
}

/** What verifying the account and syncing need of a sign-in, whichever provider: its status and its authorized calls. */
export type SessionAuth = Pick<AccountAuth, 'status' | 'authorized'>;

/**
 * A sign-in as a sync connection carries it, whichever provider: its session calls and its lifecycle. Signing out
 * always ends the session on the device at once; AccountAuth's also reports what the provider confirmed.
 */
export interface ConnectionAuth extends SessionAuth {
  signIn(email: string, password: string): Promise<AuthIdentity>;
  signOut(): void | Promise<SignOutOutcome>;
}
