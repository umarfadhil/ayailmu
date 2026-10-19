// Sign-in against the local Firebase Auth emulator only (developer pilot): its REST password flow, and an
// emulator-only way to create a synthetic local account. Addresses must use a .test domain. The ID token,
// its expiry and the identity live in memory only; nothing here is ever stored, logged or put in a URL.
import { isDemoProjectId, localPilotOrigin, PILOT_AUTH_EMULATOR_PORT, type EnabledAccountConfig } from '@/account/config';
import { AuthError, type AuthErrorCode, type AuthIdentity, type AuthStatus } from '@/auth/types';

// The provider-neutral sign-in errors and states: one AuthError class for every provider.
export { AuthError };
export type { AuthErrorCode, AuthIdentity, AuthStatus };

/** A label for the emulator's key parameter. The emulator accepts any key; this is not a credential. */
export const EMULATOR_API_KEY = 'demo-ayailmu-local-web';

export interface EmulatorAuth {
  signIn(email: string, password: string): Promise<AuthIdentity>;
  /** Emulator only: creates a synthetic local account, then signs in as it. */
  createSyntheticAccount(email: string, password: string): Promise<AuthIdentity>;
  /** Ends the session: aborts its calls and drops their results. Local data is untouched. */
  signOut(): void;
  status(): AuthStatus;
  /**
   * Runs call with the current token and an abort signal. Rejects with AuthError expired when the token has
   * expired or the call fails with an API 401; with signed_out or superseded when the session ended or was
   * replaced before the call settled.
   */
  authorized<T>(call: (token: string, signal: AbortSignal) => Promise<T>): Promise<T>;
}

/** A synthetic local-demo address: a .test domain (reserved, never deliverable). */
const SYNTHETIC_ADDRESS = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+test$/i;
const isSyntheticAddress = (email: unknown): email is string =>
  typeof email === 'string' && email.length <= 254 && SYNTHETIC_ADDRESS.test(email);

/** The emulator's error messages («WEAK_PASSWORD : …») as stable codes. The message itself is never kept. */
const REFUSALS = new Map<string, AuthErrorCode>([
  ['INVALID_LOGIN_CREDENTIALS', 'invalid_credentials'],
  ['EMAIL_NOT_FOUND', 'invalid_credentials'],
  ['INVALID_PASSWORD', 'invalid_credentials'],
  ['MISSING_PASSWORD', 'invalid_credentials'],
  ['INVALID_EMAIL', 'invalid_credentials'],
  ['USER_DISABLED', 'invalid_credentials'],
  ['EMAIL_EXISTS', 'email_exists'],
  ['WEAK_PASSWORD', 'weak_password'],
]);

type Dropped = 'signed_out' | 'superseded';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isUnauthorized = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401;

function refusal(body: unknown): AuthErrorCode {
  const message = isRecord(body) && isRecord(body.error) ? body.error.message : undefined;
  const key = typeof message === 'string' ? /^[A-Z_]+/.exec(message)?.[0] : undefined;
  return (key === undefined ? undefined : REFUSALS.get(key)) ?? 'bad_response';
}

/** A password sign-in reply reduced to the identity and the ID token; nothing else in it (no refresh token) is kept. */
function signedInAs(body: unknown, email: string, now: number): { identity: AuthIdentity; token: string } {
  if (!isRecord(body)) throw new AuthError('bad_response');
  const { localId, idToken, expiresIn, email: replyEmail } = body;
  if (typeof localId !== 'string' || localId === '' || typeof idToken !== 'string' || idToken === '') throw new AuthError('bad_response');
  if (typeof replyEmail !== 'string' || replyEmail.toLowerCase() !== email.toLowerCase()) throw new AuthError('bad_response');
  let expiresAt: number | null = null;
  if (expiresIn !== undefined) {
    const seconds = typeof expiresIn === 'string' || typeof expiresIn === 'number' ? Number(expiresIn) : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) throw new AuthError('bad_response');
    expiresAt = now + seconds * 1000;
  }
  return { identity: { uid: localId, email: replyEmail, expiresAt }, token: idToken };
}

/** A fetch reply, as far as it is read here. */
interface Reply {
  ok: boolean;
  url?: string;
  redirected?: boolean;
  text(): Promise<string>;
}

interface Session {
  number: number;
  identity: AuthIdentity;
  /** The ID token while the session can use it; emptied once the session has ended or expired. */
  token: string;
  expired: boolean;
  ended: boolean;
  /** Cancels each running call: aborts it and settles it with the code, dropping its late result. */
  calls: Set<(code: Dropped) => void>;
}

/** One sign-in (or synthetic sign-up and sign-in) on its way. */
interface Attempt {
  controller: AbortController;
  dropped: Dropped | null;
}

export function createEmulatorAuth(options: { config: EnabledAccountConfig; fetch?: typeof fetch; now?: () => number }): EmulatorAuth {
  // Revalidated here too: an unsafe configuration never sends anything.
  const config = options.config;
  const base =
    config?.enabled === true && isDemoProjectId(config.projectId) ? localPilotOrigin(config.authEmulatorUrl, PILOT_AUTH_EMULATOR_PORT) : null;
  if (!base) throw new Error('createEmulatorAuth needs the local pilot Auth emulator configuration; nothing was sent.');
  const injected = options.fetch;
  const now = options.now ?? Date.now;

  let session: Session | null = null;
  let pending: Attempt | null = null;
  let sessions = 0;

  /** Has the session passed its expiry (or had a 401)? An expired session lets go of its token. */
  const isExpired = (s: Session): boolean => {
    if (!s.expired && s.identity.expiresAt !== null && now() >= s.identity.expiresAt) s.expired = true;
    if (s.expired) s.token = '';
    return s.expired;
  };

  /** Ends a session: its running calls are aborted and settle with `code`; its token is let go. */
  const end = (s: Session, code: Dropped) => {
    s.ended = true;
    s.token = '';
    const cancels = [...s.calls];
    s.calls.clear();
    for (const cancel of cancels) cancel(code);
  };

  const drop = (attempt: Attempt, code: Dropped) => {
    if (attempt.dropped) return;
    attempt.dropped = code;
    attempt.controller.abort();
  };

  /** One public emulator REST call: no cookies, no redirects, nothing secret in the URL; failures become codes. */
  const post = async (attempt: Attempt, method: 'signInWithPassword' | 'signUp', payload: Record<string, unknown>): Promise<unknown> => {
    const url = `${base}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(EMULATOR_API_KEY)}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      redirect: 'error',
      signal: attempt.controller.signal,
    };
    let reply: Reply;
    try {
      reply = (await (injected ? injected(url, init) : globalThis.fetch(url, init))) as unknown as Reply;
    } catch {
      throw new AuthError('network');
    }
    // Where redirect: 'error' is not honoured (React Native's fetch), a reply from another origin is refused.
    if (reply.redirected === true || (typeof reply.url === 'string' && reply.url !== '' && !reply.url.startsWith(`${base}/`))) {
      throw new AuthError('bad_response');
    }
    let text: string;
    try {
      text = await reply.text();
    } catch {
      throw new AuthError('network');
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AuthError('bad_response');
    }
    if (!reply.ok) throw new AuthError(refusal(body));
    return body;
  };

  /**
   * The latest sign-in wins: one still on its way is dropped as superseded, and sign-out drops it as signed out.
   * A dropped attempt settles with that code whatever its reply was, so it can neither replace nor expire the
   * newer session. Only a successful latest attempt replaces the session (whose running calls are superseded).
   */
  const signInWith = async (steps: (attempt: Attempt) => Promise<{ identity: AuthIdentity; token: string }>): Promise<AuthIdentity> => {
    if (pending) drop(pending, 'superseded');
    const attempt: Attempt = { controller: new AbortController(), dropped: null };
    pending = attempt;
    try {
      const result = await steps(attempt);
      if (attempt.dropped) throw new AuthError(attempt.dropped);
      pending = null;
      if (session) end(session, 'superseded');
      sessions += 1;
      session = { number: sessions, identity: result.identity, token: result.token, expired: false, ended: false, calls: new Set() };
      return { ...result.identity };
    } catch (error) {
      if (pending === attempt) pending = null;
      if (attempt.dropped) throw new AuthError(attempt.dropped);
      throw error instanceof AuthError ? error : new AuthError('network');
    }
  };

  return {
    signIn(email, password) {
      if (!isSyntheticAddress(email)) return Promise.reject(new AuthError('not_synthetic'));
      return signInWith(async (attempt) => signedInAs(await post(attempt, 'signInWithPassword', { email, password, returnSecureToken: true }), email, now()));
    },

    createSyntheticAccount(email, password) {
      if (!isSyntheticAddress(email)) return Promise.reject(new AuthError('not_synthetic'));
      return signInWith(async (attempt) => {
        await post(attempt, 'signUp', { email, password });
        if (attempt.dropped) throw new AuthError(attempt.dropped);
        return signedInAs(await post(attempt, 'signInWithPassword', { email, password, returnSecureToken: true }), email, now());
      });
    },

    signOut() {
      if (pending) drop(pending, 'signed_out');
      pending = null;
      if (session) end(session, 'signed_out');
      session = null;
    },

    status(): AuthStatus {
      const s = session;
      if (!s || s.ended) return { state: 'signed-out' };
      const identity = { ...s.identity };
      return isExpired(s) ? { state: 'expired', identity } : { state: 'signed-in', identity, session: s.number };
    },

    authorized<T>(call: (token: string, signal: AbortSignal) => Promise<T>): Promise<T> {
      const s = session;
      if (!s || s.ended) return Promise.reject(new AuthError('signed_out'));
      if (isExpired(s)) return Promise.reject(new AuthError('expired'));
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
          running = Promise.resolve(call(s.token, controller.signal));
        } catch (error) {
          running = Promise.reject(error);
        }
        running.then(
          (value) => finish(() => resolve(value)),
          (error: unknown) =>
            finish(() => {
              if (!isUnauthorized(error)) {
                reject(error);
                return;
              }
              // The API refused this session's token: it needs a new sign-in. Local data is untouched.
              s.expired = true;
              s.token = '';
              reject(new AuthError('expired'));
            })
        );
      });
    },
  };
}
