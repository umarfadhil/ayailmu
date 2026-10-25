// Registration with required email confirmation against a standalone Supabase Auth server (GoTrue) at its root, never a
// hosted /auth/v1 prefix, in a local or staging build only (never production), for synthetic .test addresses only. It
// goes through the maintained SDK (@supabase/auth-js AuthClient), one fresh in-memory client per call (no persistence, no
// URL detection, no debug output, no background refresh, no API key, implicit flow), which reaches the Auth root only
// through a bounded transport: its one operation path (/signup, /verify or /resend) once, without any credential, and
// /logout only with the bearer token of the session that very client was just given. Registration never keeps a session:
// sign-up must answer without one (email confirmation stays required), and the session a confirmed code gives is retired
// at once through the SDK's own local sign-out, never adopted or handed out; the learner then signs in with the password.
// The latest call wins; cancel and dispose settle the call under way at once, and its client is stopped. Every request,
// its reply body included, every SDK call and every cleanup is bounded by the same deadline, whatever the SDK or fetch
// underneath does. Nothing is stored, logged or put in a URL, and outcomes and errors carry stable codes only.
import {
  AuthClient,
  isAuthApiError,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
  type GoTrueClient,
  type GoTrueClientOptions,
} from '@supabase/auth-js';
import { isCanonicalUuid } from '@/account/ids';
import { accountApiOrigin } from '@/account/staging';
import { accountAuthOrigin, LOCAL_SUPABASE, type EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { AUTH_REQUEST_TIMEOUT_MS } from '@/auth/supabaseAuth';

/** The SDK client's maintained public methods registration uses, and nothing else: never a password sign-in. */
export type RegistrationSdkClient = Pick<GoTrueClient, 'signUp' | 'verifyOtp' | 'resend' | 'signOut' | 'stopAutoRefresh'>;

export type RegistrationErrorCode =
  /** The address is not a synthetic local-demo address (a .test domain); nothing was built or sent. */
  | 'not_synthetic'
  /** The code is not 6 to 10 digits (nothing was sent), or the Auth server refused it (wrong, used or expired). */
  | 'invalid_code'
  | 'weak_password'
  | 'rate_limited'
  /** The Auth server was unreachable, or the call outlasted its deadline. */
  | 'network'
  /** Sign-up answered with a session (confirmation off on the server): refused, and that session retired. */
  | 'auto_confirm_refused'
  | 'provider_refused'
  | 'bad_response'
  /** cancel() came first; the result was dropped. */
  | 'cancelled'
  /** A newer call came first; the result was dropped. */
  | 'superseded'
  /** dispose() came first, or this registration is disposed. */
  | 'disposed';

export class RegistrationError extends Error {
  constructor(readonly code: RegistrationErrorCode) {
    super(`Account registration problem: ${code}`);
    this.name = 'RegistrationError';
  }
}

export interface RegistrationOptions {
  config: EnabledSupabaseConfig;
  /** Builds each SDK client; the app's default is `new AuthClient(options)`. Tests inject a fake SDK here. */
  createClient?: (options: GoTrueClientOptions) => RegistrationSdkClient;
  /** The fetch under the SDK's bounded transport; the global fetch by default. */
  fetch?: typeof fetch;
  /** Accepted as the sign-in adapter's is; registration keeps nothing that depends on the time. */
  now?: () => number;
  /** A shorter deadline than AUTH_REQUEST_TIMEOUT_MS for each request, SDK call and cleanup; a longer or invalid one is refused. */
  timeoutMs?: number;
}

export interface Registration {
  /** Signs the address up; resolves once the Auth server waits for its confirmation code. */
  register(email: string, password: string): Promise<{ status: 'confirmation_required' }>;
  /** Confirms the address with its code. The learner must then sign in with the password: no session is kept. */
  confirm(email: string, code: string): Promise<{ status: 'confirmed'; signInRequired: true }>;
  /** Asks the Auth server for a new code; never a claim that an email was delivered. */
  resend(email: string): Promise<{ status: 'resent' }>;
  /** Drops the call under way (cancelled); the registration stays usable. */
  cancel(): Promise<void>;
  /** Drops the call under way (disposed) and refuses every later call. */
  dispose(): Promise<void>;
}

/** The one path each call may send to, below the Auth root. */
type OperationPath = '/signup' | '/verify' | '/resend';

/** The SDK's local sign-out, as GoTrue's logout takes it. */
const LOGOUT_PATH = '/logout?scope=local';

/** The same rule as sign-in's: a .test domain (reserved, never deliverable), matched whole, so no trimming happens here. */
const SYNTHETIC_ADDRESS = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+test$/i;
const isSyntheticAddress = (email: unknown): email is string =>
  typeof email === 'string' && email.length <= 254 && SYNTHETIC_ADDRESS.test(email);

/** A confirmation code: 6 to 10 ASCII digits and nothing else. */
const CONFIRMATION_CODE = /^[0-9]{6,10}$/;

const RATE_LIMITS = new Set(['over_email_send_rate_limit', 'over_request_rate_limit', 'over_sms_send_rate_limit']);

/** One SDK client, for one call. Once its call has ended, it never sends that call's request again. */
interface Client {
  sdk: RegistrationSdkClient;
  path: OperationPath;
  /** Whether its one operation request has gone. */
  sent: boolean;
  /** Aborted when its call ends: an operation request still on its way is aborted, and none may start. */
  live: AbortController;
  /** The access token of the session this client was given, until its one logout takes it. Never anywhere else. */
  logoutToken: string | null;
  stopped: Promise<void> | null;
  retired: Promise<void> | null;
}

/** The call under way. */
interface Run {
  client: Client;
  dropped: 'cancelled' | 'superseded' | 'disposed' | null;
  /** Rejects with the drop's code once the run is dropped; never resolves. */
  fenced: Promise<never>;
  fence: (error: RegistrationError) => void;
}

/** The SDK's answer as its public methods give it: { data, error }. */
interface SdkReply {
  data: { user?: unknown; session?: unknown } | null;
  error: unknown;
}

const isReply = (reply: unknown): reply is SdkReply =>
  typeof reply === 'object' && reply !== null && 'data' in reply && 'error' in reply;

/** The session in the reply, if any appeared (well formed or not). */
const sessionIn = (reply: unknown): unknown => (isReply(reply) && typeof reply.data === 'object' && reply.data !== null ? reply.data.session ?? null : null);

const accessTokenOf = (session: unknown): string | null => {
  const token = typeof session === 'object' && session !== null ? (session as { access_token?: unknown }).access_token : null;
  return typeof token === 'string' && token !== '' ? token : null;
};

/** A user for `email`: a canonical UUID id and that very address, up to the provider's lower-casing. Nothing else is read. */
const isUserFor = (user: unknown, email: string): user is { id: string; email: string } => {
  if (typeof user !== 'object' || user === null) return false;
  const { id, email: address } = user as { id?: unknown; email?: unknown };
  return isCanonicalUuid(id) && typeof address === 'string' && address.toLowerCase() === email.toLowerCase();
};

/** A usable session for `email`: both tokens, non-empty strings, and a user for `email`. */
const isSessionFor = (session: unknown, email: string): session is { user: { id: string; email: string } } => {
  if (typeof session !== 'object' || session === null) return false;
  const { access_token, refresh_token, user } = session as { access_token?: unknown; refresh_token?: unknown; user?: unknown };
  return typeof access_token === 'string' && access_token !== '' && typeof refresh_token === 'string' && refresh_token !== '' && isUserFor(user, email);
};

/** A refusal as a stable code, from the SDK error's class, status and code only: never its text. */
function refusal(error: unknown, verifying: boolean): RegistrationErrorCode {
  if (isAuthRetryableFetchError(error)) return 'network';
  const status = isAuthError(error) ? error.status : undefined;
  const code = isAuthError(error) ? error.code : undefined;
  if (status === 429 || (typeof code === 'string' && RATE_LIMITS.has(code))) return 'rate_limited';
  if (isAuthWeakPasswordError(error) || code === 'weak_password') return 'weak_password';
  if (verifying && (code === 'otp_expired' || (isAuthApiError(error) && error.status >= 400 && error.status < 500))) return 'invalid_code';
  if (isAuthApiError(error)) return 'provider_refused';
  return 'bad_response';
}

/** The request's headers by lower-case name, whatever form the SDK gave them in. */
function headersOf(init: RequestInit | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  const raw = init?.headers;
  if (!raw) return headers;
  const put = (name: string, value: string) => headers.set(String(name).toLowerCase(), String(value));
  if (Array.isArray(raw)) for (const [name, value] of raw) put(name, value);
  else if (typeof (raw as Headers).forEach === 'function') (raw as Headers).forEach((value, name) => put(name, value));
  else for (const [name, value] of Object.entries(raw)) put(name, value);
  return headers;
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

const REFUSED = 'The registration transport refused this request; nothing was sent.';
const UNREACHABLE = 'The Auth server could not be reached.';

/**
 * One client's transport. It takes exactly two requests, each a POST, and refuses anything else before calling the fetch
 * underneath: the client's operation path, once and while its call lasts, carrying no Authorization, API key or cookie;
 * and the SDK's local logout, once, carrying exactly the bearer token of the session this client was given (and no API
 * key or cookie). No cookies go or come, and redirects are refused, even by a fetch that ignores redirect: 'error'. The
 * request and its whole reply body race one deadline and the call's cancellation: whichever comes first aborts the fetch
 * underneath and settles at once, even when that fetch or body never cooperates. Failures carry no request or reply text.
 */
function boundTransport(origin: string, client: Client, base: () => typeof fetch, timeoutMs: number): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input !== 'string' || init?.method !== 'POST') throw new Error(REFUSED);
    const headers = headersOf(init);
    if (headers.has('apikey') || headers.has('cookie')) throw new Error(REFUSED);
    let operation: boolean;
    if (input === `${origin}${client.path}`) {
      if (client.sent || client.live.signal.aborted || headers.has('authorization')) throw new Error(REFUSED);
      client.sent = true;
      operation = true;
    } else if (input === `${origin}${LOGOUT_PATH}`) {
      const token = client.logoutToken;
      if (token === null || headers.get('authorization') !== `Bearer ${token}`) throw new Error(REFUSED);
      client.logoutToken = null;
      operation = false;
    } else {
      throw new Error(REFUSED);
    }
    // A logout runs after its call has ended, so only the deadline (and the SDK's own signal) bounds it.
    const signals = [init.signal, operation ? client.live.signal : null];
    const controller = new AbortController();
    return new Promise<Response>((resolve, reject) => {
      let done = false;
      const listeners: (() => void)[] = [];
      const settle = (reply: Response | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const unlisten of listeners) unlisten();
        if (reply) resolve(reply);
        else {
          controller.abort();
          reject(new Error(UNREACHABLE));
        }
      };
      const timer = setTimeout(() => settle(null), timeoutMs);
      for (const signal of signals) {
        if (!signal) continue;
        if (signal.aborted) return settle(null);
        const onAbort = () => settle(null);
        signal.addEventListener('abort', onAbort);
        listeners.push(() => signal.removeEventListener('abort', onAbort));
      }
      (async () => {
        const reply = await base()(input, { ...init, credentials: 'omit', redirect: 'error', signal: controller.signal });
        const elsewhere = typeof reply.url === 'string' && reply.url !== '' && reply.url !== input;
        if (reply.redirected === true || reply.type === 'opaqueredirect' || (reply.status >= 300 && reply.status < 400) || elsewhere) {
          throw new Error(REFUSED);
        }
        return buffered(reply, await reply.text());
      })().then(settle, () => settle(null));
    });
  };
}

const createAuthClient = (options: GoTrueClientOptions): RegistrationSdkClient => new AuthClient(options);

/** Numbers the clients built in this realm; with a nonce, each storage key (and so each SDK lock name) is its own. Not a secret. */
let clientsBuilt = 0;
function storageKey(): string {
  clientsBuilt += 1;
  let nonce: string;
  try {
    nonce = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    nonce = Math.random().toString(36).slice(2, 12);
  }
  return `ayailmu-registration-${clientsBuilt}-${nonce}`;
}

export function createRegistration(options: RegistrationOptions): Registration {
  // Revalidated here, once: a missing, disabled, legacy or unknown-profile configuration, the production profile in any
  // form, or an API or Auth address that is not exactly its profile's (local, or staging root origins; so Auth is always
  // at its root) builds no client and sends nothing. The Auth root validated here is kept; the caller's configuration is
  // never read again.
  const { enabled, provider, environment, productionAccounts, apiBaseUrl, authUrl: configuredAuthUrl } = options?.config ?? ({} as Partial<EnabledSupabaseConfig>);
  const safeProfile = enabled === true && provider === LOCAL_SUPABASE && environment !== 'production' && productionAccounts === undefined;
  const apiOrigin = safeProfile ? accountApiOrigin(apiBaseUrl, environment) : null;
  const authUrl = apiOrigin !== null ? accountAuthOrigin(configuredAuthUrl, environment) : null;
  if (!authUrl) throw new Error('createRegistration needs a local or staging Supabase Auth configuration; nothing was sent.');
  const timeoutMs = options.timeoutMs === undefined ? AUTH_REQUEST_TIMEOUT_MS : options.timeoutMs;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > AUTH_REQUEST_TIMEOUT_MS) {
    throw new Error(`createRegistration takes a deadline of at most ${AUTH_REQUEST_TIMEOUT_MS} ms; nothing was sent.`);
  }
  const createClient = options.createClient ?? createAuthClient;
  const injected = options.fetch;

  let current: Run | null = null;
  let disposed = false;

  /** Waits for `work` at most the deadline, and never rejects: cleanup can never keep an outcome or a cancel waiting. */
  const bounded = (work: () => unknown): Promise<void> =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      let running: Promise<unknown>;
      try {
        running = Promise.resolve(work());
      } catch {
        running = Promise.resolve();
      }
      running.then(done, done);
    });

  /** Stops a client's background work at once (autoRefreshToken is off; this lets go of the SDK's page listeners). */
  const halt = (client: Client): Promise<void> => {
    if (!client.stopped) client.stopped = bounded(() => client.sdk.stopAutoRefresh());
    return client.stopped;
  };

  /**
   * Retires the session a client was given, whenever it came, through the SDK's own local sign-out (which drops it from
   * the client's memory and asks the Auth server to revoke it for this device only), then stops the client. Bounded and
   * never rejects; the token goes once its logout has been sent or the deadline passed.
   */
  const retire = (client: Client, session: unknown): Promise<void> => {
    if (!client.retired) {
      client.logoutToken = accessTokenOf(session);
      client.retired = bounded(async () => {
        try {
          await client.sdk.signOut({ scope: 'local' });
        } finally {
          await client.sdk.stopAutoRefresh();
        }
      }).then(() => {
        client.logoutToken = null;
      });
    }
    return client.retired;
  };

  const build = (path: OperationPath): Client => {
    const client: Client = { sdk: undefined as unknown as RegistrationSdkClient, path, sent: false, live: new AbortController(), logoutToken: null, stopped: null, retired: null };
    client.sdk = createClient({
      url: authUrl,
      storageKey: storageKey(),
      flowType: 'implicit',
      persistSession: false,
      detectSessionInUrl: false,
      autoRefreshToken: false,
      debug: false,
      fetch: boundTransport(authUrl, client, () => injected ?? globalThis.fetch, timeoutMs),
    });
    return client;
  };

  /** Drops the run under way with `code`: it settles at once, its requests are aborted and its client is stopped. */
  const drop = (run: Run, code: NonNullable<Run['dropped']>) => {
    if (run.dropped) return;
    run.dropped = code;
    if (current === run) current = null;
    run.client.live.abort();
    run.fence(new RegistrationError(code));
    void halt(run.client);
  };

  /**
   * One call on a fresh client: the latest wins, so a call still under way is superseded first. The SDK call races the
   * deadline and the run's fence; a throw or a missed deadline is a lost connection. Any session the SDK gives, however
   * late, is retired (registration never keeps one); a reply in time waits for that, bounded, before `decide` reads it.
   */
  const operate = async <T>(path: OperationPath, call: (sdk: RegistrationSdkClient) => Promise<unknown>, verifying: boolean, decide: (reply: SdkReply) => T): Promise<T> => {
    if (current) drop(current, 'superseded');
    let client: Client;
    try {
      client = build(path);
    } catch {
      throw new RegistrationError('bad_response');
    }
    let fence!: (error: RegistrationError) => void;
    const fenced = new Promise<never>((_, reject) => (fence = reject));
    fenced.catch(() => undefined);
    const run: Run = { client, dropped: null, fenced, fence };
    current = run;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let sdkCall: Promise<unknown>;
      try {
        sdkCall = Promise.resolve(call(client.sdk));
      } catch (error) {
        sdkCall = Promise.reject(error);
      }
      const retiring = sdkCall.then(
        (reply) => {
          const session = sessionIn(reply);
          return session ? retire(client, session) : undefined;
        },
        () => undefined
      );
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RegistrationError('network')), timeoutMs);
      });
      const answered = sdkCall.then(
        (reply) => reply,
        () => {
          throw new RegistrationError('network');
        }
      );
      const reply = await Promise.race([answered, expired, fenced]);
      clearTimeout(timer);
      if (sessionIn(reply)) await Promise.race([retiring, fenced]);
      if (!isReply(reply)) throw new RegistrationError('bad_response');
      if (reply.error) throw new RegistrationError(refusal(reply.error, verifying));
      return decide(reply);
    } finally {
      clearTimeout(timer);
      if (current === run) current = null;
      client.live.abort();
      void halt(client);
    }
  };

  const usable = () => {
    if (disposed) throw new RegistrationError('disposed');
  };

  return {
    async register(email, password) {
      usable();
      if (!isSyntheticAddress(email)) throw new RegistrationError('not_synthetic');
      if (typeof password !== 'string' || password === '') throw new RegistrationError('weak_password');
      return operate('/signup', (sdk) => sdk.signUp({ email, password }), false, ({ data }) => {
        // A session here means the server confirmed the address itself: refused (and already retired), never signed in.
        if (data?.session) throw new RegistrationError('auto_confirm_refused');
        // A repeated sign-up's obfuscated user still has a canonical id and the address; its role and identities aren't read.
        if (!isUserFor(data?.user, email)) throw new RegistrationError('bad_response');
        return { status: 'confirmation_required' as const };
      });
    },

    async confirm(email, code) {
      usable();
      if (!isSyntheticAddress(email)) throw new RegistrationError('not_synthetic');
      if (typeof code !== 'string' || !CONFIRMATION_CODE.test(code)) throw new RegistrationError('invalid_code');
      return operate('/verify', (sdk) => sdk.verifyOtp({ email, token: code, type: 'signup' }), true, ({ data }) => {
        // GoTrue answers a signup verification with a session, so a user-only reply is never one. The session (well formed
        // or not) is already retired; nothing of it, its user included, is handed out.
        const session = data?.session;
        if (!isSessionFor(session, email)) throw new RegistrationError('bad_response');
        const user = data?.user;
        if (user !== undefined && user !== null && (!isUserFor(user, email) || user.id !== session.user.id)) throw new RegistrationError('bad_response');
        return { status: 'confirmed' as const, signInRequired: true as const };
      });
    },

    async resend(email) {
      usable();
      if (!isSyntheticAddress(email)) throw new RegistrationError('not_synthetic');
      return operate('/resend', (sdk) => sdk.resend({ email, type: 'signup' }), false, () => ({ status: 'resent' as const }));
    },

    async cancel() {
      const run = current;
      if (!run) return;
      drop(run, 'cancelled');
      await halt(run.client);
    },

    async dispose() {
      disposed = true;
      const run = current;
      if (!run) return;
      drop(run, 'disposed');
      await halt(run.client);
    },
  };
}
