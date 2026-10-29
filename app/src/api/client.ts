// Client of the local account API (backend/docs/Backend_Local_Contract.md in the backend worktree), or, under the
// explicit staging profile, of the staging API at its root origin. The bearer token travels only in the Authorization
// header: no cookies (credentials: 'omit'), no redirects, nothing in URLs. Every request settles within one deadline
// that covers its reply body too, or at once when its caller aborts. Errors carry the HTTP status and the API's stable
// problem code, never response text or the token.
import { PRIVATE_QA } from '@/account/privateQa';
import { accountApiOrigin } from '@/account/staging';
import { isCanonicalUuid } from '@/account/ids';

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when no response arrived. */
    readonly status: number,
    /** The API's stable problem code, or network (also a missed deadline), aborted, bad_response or unexpected. */
    readonly code: string
  ) {
    super(`Account service request failed (${status || 'no response'}: ${code})`);
    this.name = 'ApiError';
  }
}

/**
 * How long one request to the account API may take, its reply body included, before it fails as a lost connection. One
 * deadline from the start: the reply's headers do not restart it. A full 16 MiB import needs about 2.3 Mbit/s sustained
 * within it; a slower link times out, and the journal resends the same import byte for byte.
 */
export const API_REQUEST_TIMEOUT_MS = 60_000;

export interface ProfileSummary {
  profileId: string;
  revision: number;
  highSeq: number;
}

/** The verified server account (GET /v1/me). */
export interface AccountMe {
  accountId: string;
  profiles: ProfileSummary[];
}

/** One raw request to the account API, sent with its exact body. */
export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH';
  /** A path under /v1/ with its query string; never a full URL. */
  path: string;
  token: string;
  /** The caller's own signal: passed to fetch as it is and only listened to. Its abort settles the request at once. */
  signal?: AbortSignal;
  /** The exact request bytes. */
  body?: string;
  contentType?: 'application/json' | 'application/merge-patch+json';
  /** An If-Match value such as "r3". */
  ifMatch?: string;
}

/** A raw reply: its status, its exact text and its ETag. HTTP error statuses are replies here, never thrown. */
export interface ApiReply {
  status: number;
  text: string;
  etag: string | null;
}

export interface ApiClient {
  /** GET /v1/me with the given token. */
  me(token: string, signal?: AbortSignal): Promise<AccountMe>;
  /**
   * Sends one request with exactly `body`, under the same rules as me(): the token in the Authorization header only,
   * no cookies, no redirects, within API_REQUEST_TIMEOUT_MS. Only a transport failure, a missed deadline, the caller's
   * abort or a refused reply (redirect, other origin) throws an ApiError.
   */
  request(req: ApiRequest): Promise<ApiReply>;
}

/** A problem code as the API spells them; anything else is reported as unexpected. */
const PROBLEM_CODE = /^[a-z][a-z0-9_]{0,63}$/;
/** An RFC 6750 bearer token. Anything else is never put in a header. */
const BEARER_TOKEN = /^[A-Za-z0-9._~+/-]+=*$/;

/** A path under /v1/ with an optional plain query: no scheme, host, dot segments or empty segments. */
const API_PATH = /^\/v1(\/[A-Za-z0-9._~-]+)+(\?[A-Za-z0-9._~&=-]*)?$/;

/** A fetch reply, as far as it is read here. */
interface Reply {
  ok: boolean;
  status: number;
  url?: string;
  redirected?: boolean;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const isAbort = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';

/** The /v1/me document, checked: canonical account and profile UUIDs, revisions from 1, sequence numbers from 0. */
function verifiedAccount(body: unknown): AccountMe | null {
  if (!isRecord(body) || !Array.isArray(body.profiles)) return null;
  const accountId = body.account_id;
  if (!isCanonicalUuid(accountId)) return null;
  const profiles: ProfileSummary[] = [];
  for (const entry of body.profiles) {
    if (!isRecord(entry)) return null;
    const { profile_id: profileId, revision, high_seq: highSeq } = entry;
    if (!isCanonicalUuid(profileId) || !isCount(revision, 1) || !isCount(highSeq, 0)) return null;
    profiles.push({ profileId, revision, highSeq });
  }
  return { accountId, profiles };
}

export function createApiClient(options: {
  baseUrl: string;
  /** The account profile: absent for the local pilot API; exactly "staging" for the staging API's root origin. */
  environment?: string;
  /** The explicit production capability: exactly true, beside exactly "production", for the production API's root origin. */
  productionAccounts?: boolean;
  /** The explicit private QA capability: exactly true, beside exactly "private-qa", for the private QA API root. */
  privateQa?: boolean;
  /** The explicit learning-beta capability: exactly true, beside exactly "learning-beta" alone, for its API root origin. */
  learningBeta?: boolean;
  /** The fetch underneath; the global fetch by default. Required under the private QA profile, which has no fallback. */
  fetch?: typeof fetch;
}): ApiClient {
  // Revalidated here too, with its profile, read once: an address other than that profile's API (the local pilot API, a
  // staging root origin under exactly the staging profile, the private QA root under exactly the private profile with
  // its capability, or a public root origin under exactly the learning-beta profile with its capability alone), or an
  // unknown profile, never receives a token. The private profile also needs an injected fetch.
  const environment = options?.environment;
  const injected = options?.fetch;
  const base = accountApiOrigin(options?.baseUrl, environment, options?.productionAccounts, options?.privateQa, options?.learningBeta);
  if (!base) throw new Error("createApiClient needs its profile's account API address; nothing was sent.");
  if (environment === PRIVATE_QA && typeof injected !== 'function') throw new Error('createApiClient needs an injected fetch for the private QA profile; nothing was sent.');

  /**
   * One authenticated request with exactly `body`: the token in the Authorization header only, no cookies, no
   * redirects. A transport failure or a reply from anywhere else becomes an ApiError; any HTTP status is returned. It
   * settles once: within API_REQUEST_TIMEOUT_MS of its start, reply body included, as a lost connection (network); or at
   * once when the caller aborts (aborted), whether or not fetch honours the abort. A caller that has already aborted
   * sends nothing. The caller's signal reaches fetch as it is and is only listened to; without one, fetch gets the
   * client's own, aborted at the deadline (best effort). Once settled, the timer and the listener are gone, and a reply
   * that comes later is never read.
   */
  const send = async (req: ApiRequest): Promise<ApiReply & { ok: boolean }> => {
    const { method, path, token, signal, body, contentType, ifMatch } = req;
    if (typeof token !== 'string' || !BEARER_TOKEN.test(token)) throw new ApiError(0, 'unexpected');
    if (typeof path !== 'string' || !API_PATH.test(path) || path.split('?')[0].split('/').some((s) => s === '.' || s === '..')) {
      throw new ApiError(0, 'unexpected');
    }
    if (signal?.aborted) throw new ApiError(0, 'aborted');
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = contentType ?? 'application/json';
    if (ifMatch !== undefined) headers['If-Match'] = ifMatch;
    const url = `${base}${path}`;
    const owned = signal ? null : new AbortController();
    const init: RequestInit = {
      method,
      headers,
      credentials: 'omit',
      redirect: 'error',
      ...(body !== undefined ? { body } : {}),
      signal: signal ?? owned?.signal,
    };
    const failed = (error: unknown) => new ApiError(0, isAbort(error) || signal?.aborted === true ? 'aborted' : 'network');
    return new Promise<ApiReply & { ok: boolean }>((resolve, reject) => {
      let settled = false;
      let release: () => void = () => undefined;
      /** Settles once: the deadline and the caller's signal are let go first; nothing later changes the outcome. */
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        release();
        settle();
      };
      const onAbort = () => finish(() => reject(new ApiError(0, 'aborted')));
      const timer = setTimeout(() => {
        finish(() => reject(new ApiError(0, 'network')));
        owned?.abort();
      }, API_REQUEST_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort);
      release = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };

      /** The reply's headers, then its whole body; null for a reply that came after the call settled, which is never read. */
      const exchange = async (): Promise<(ApiReply & { ok: boolean }) | null> => {
        let reply: Reply;
        try {
          reply = (await (injected ? injected(url, init) : globalThis.fetch(url, init))) as unknown as Reply;
        } catch (error) {
          throw failed(error);
        }
        if (settled) return null;
        const status = typeof reply.status === 'number' ? reply.status : 0;
        // Where redirect: 'error' is not honoured (React Native's fetch), a reply from anywhere else is refused.
        if (reply.redirected === true || (typeof reply.url === 'string' && reply.url !== '' && !reply.url.startsWith(`${base}/`))) {
          throw new ApiError(status, 'bad_response');
        }
        let text: string;
        try {
          text = await reply.text();
        } catch (error) {
          throw failed(error);
        }
        const etag = typeof reply.headers?.get === 'function' ? reply.headers.get('etag') : null;
        return { ok: reply.ok === true, status, text, etag };
      };
      exchange().then(
        (reply) => {
          if (reply) finish(() => resolve(reply));
        },
        (error: unknown) => finish(() => reject(error))
      );
    });
  };

  return {
    async me(token, signal) {
      const reply = await send({ method: 'GET', path: '/v1/me', token, signal });
      let body: unknown;
      let readable = true;
      try {
        body = JSON.parse(reply.text);
      } catch {
        readable = false;
      }
      if (!reply.ok) {
        // Only the problem's stable code is kept: never its title, detail or any other reply text.
        const code = readable && isRecord(body) && typeof body.code === 'string' && PROBLEM_CODE.test(body.code) ? body.code : 'unexpected';
        throw new ApiError(reply.status, code);
      }
      const account = readable ? verifiedAccount(body) : null;
      if (!account) throw new ApiError(reply.status, 'bad_response');
      return account;
    },

    async request(req) {
      const { status, text, etag } = await send(req);
      return { status, text, etag };
    },
  };
}

/** The stable problem code of an error reply (RFC 9457 `code`), or null. Never its title, detail or other text. */
export function problemCode(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text);
    return isRecord(body) && typeof body.code === 'string' && PROBLEM_CODE.test(body.code) ? body.code : null;
  } catch {
    return null;
  }
}

/** Whether `body` is a server export of the account `accountId`: its format, that same account and a profiles array. */
function isOwnExport(body: unknown, accountId: string): boolean {
  if (!isRecord(body) || body.format !== 'ayailmu-server-export-1' || !Array.isArray(body.profiles)) return false;
  return isRecord(body.account) && body.account.account_id === accountId;
}

/**
 * The server's proof of the signed-in account's deletion (GET and POST /v1/me/deletion), exactly as it was sent, with the
 * API's own field names. The account's server data is erased at once; the deletion stays identity_deletion_pending until
 * the identity provider has deleted the sign-in too, and only then is completed. not_deleted lists what the server keeps,
 * and why.
 */
export type AccountDeletion = {
  deletion_id: string;
  account_id: string;
  requested_at: string;
  server_data: { status: 'erased'; erased_at: string; profiles: number; device_links: number; events: number; imports: number };
  not_deleted: { what: string; why: string }[];
} & (
  | { status: 'identity_deletion_pending'; identity_provider: { status: 'pending'; attempts: number } }
  | { status: 'completed'; completed_at: string; identity_provider: { status: 'deleted'; attempts: number; deleted_at: string } }
);

/** An RFC 3339 timestamp as the API writes them (2026-10-22T15:15:00Z): seconds, an optional fraction, Z or an offset (+07:00). */
const TIMESTAMP = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Whether `value` is such a timestamp on a real calendar day: no 31 April, no 29 February outside leap years. */
function isTimestamp(value: unknown): value is string {
  const match = typeof value === 'string' ? TIMESTAMP.exec(value) : null;
  if (!match) return false;
  const year = Number(match[1]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(match[2]) - 1];
  return Number(match[3]) <= days;
}

/**
 * Whether `body` proves the deletion of the account `accountId`: a canonical deletion ID, that same account, valid times,
 * the erased server data's counts, the identity provider's attempts, what is kept and why, and one consistent state.
 * Pending: the provider's deletion still pending, with no completed_at or deleted_at. Completed: completed_at, and the
 * provider's deletion done at deleted_at. The order of the times is the server's; it is not checked here.
 */
function isOwnDeletion(body: unknown, accountId: string): body is AccountDeletion {
  if (!isRecord(body) || !isCanonicalUuid(body.deletion_id) || body.account_id !== accountId || !isTimestamp(body.requested_at)) return false;
  const { server_data: serverData, identity_provider: provider, not_deleted: notDeleted } = body;
  if (!isRecord(serverData) || serverData.status !== 'erased' || !isTimestamp(serverData.erased_at)) return false;
  if (!['profiles', 'device_links', 'events', 'imports'].every((count) => isCount(serverData[count], 0))) return false;
  if (!isRecord(provider) || !isCount(provider.attempts, 0)) return false;
  // Each kept kind is named and explained in more than whitespace; the two the server always keeps must be among them,
  // beside any others, in any order.
  const isKept = (entry: unknown): entry is { what: string; why: string } =>
    isRecord(entry) && typeof entry.what === 'string' && entry.what.trim() !== '' && typeof entry.why === 'string' && entry.why.trim() !== '';
  if (!Array.isArray(notDeleted) || !notDeleted.every(isKept)) return false;
  if (!['deletion_record', 'device_data'].every((what) => notDeleted.some((entry) => entry.what === what))) return false;
  if (body.status === 'identity_deletion_pending') {
    return provider.status === 'pending' && body.completed_at === undefined && provider.deleted_at === undefined;
  }
  return body.status === 'completed' && isTimestamp(body.completed_at) && provider.status === 'deleted' && isTimestamp(provider.deleted_at);
}

/**
 * The deletion proof in a success `reply`, parsed and returned unchanged, when it proves the deletion of the account
 * `accountId`, in exactly the state `state` when one is given. Anything else, malformed JSON included, is bad_response.
 */
function provenDeletion(reply: ApiReply, accountId: string, state?: AccountDeletion['status']): AccountDeletion {
  let body: unknown;
  try {
    body = JSON.parse(reply.text);
  } catch {
    throw new ApiError(reply.status, 'bad_response');
  }
  if (!isOwnDeletion(body, accountId) || (state !== undefined && body.status !== state)) throw new ApiError(reply.status, 'bad_response');
  return body;
}

/** The signed-in account's own controls. Nothing here refreshes a session, retries, stores or logs anything. */
export interface AccountControls {
  /**
   * GET /v1/me/export, once: the account's server snapshot as the reply's exact text, only when it is an export of this
   * same account. It is the server's copy only; guest data and unsent records stay on the device.
   */
  exportData(token: string, signal?: AbortSignal): Promise<{ accountId: string; json: string }>;
  /**
   * GET /v1/me/deletion, once: this account's deletion proof as the server sent it, pending or completed, or null when
   * the API has no deletion to report (404 not_found). A reply that proves no deletion of this same account is
   * bad_response; any other problem keeps its status and stable code only.
   */
  deletionStatus(token: string, signal?: AbortSignal): Promise<AccountDeletion | null>;
  /**
   * POST /v1/me/deletion, once, with exactly the confirmation of this same account. The deletion proof as the server
   * sent it: 202 while the identity provider's deletion is pending, 200 once completed; a status and a proof that
   * disagree are bad_response. Problems such as 401 reauthentication_required, 503 account_deletion_failed and 500
   * internal_error keep their status and stable code only.
   */
  deleteAccount(token: string, signal?: AbortSignal): Promise<AccountDeletion>;
}

/** The controls of the verified account `accountId`, a canonical UUID as GET /v1/me returned it, over `api`. */
export function createAccountControls(api: ApiClient, accountId: string): AccountControls {
  if (!isCanonicalUuid(accountId)) throw new Error('createAccountControls needs the verified account ID; nothing was sent.');
  return {
    async exportData(token, signal) {
      const reply = await api.request({ method: 'GET', path: '/v1/me/export', token, signal });
      // Only the problem's stable code is kept: never its title, detail or any other reply text.
      if (reply.status !== 200) throw new ApiError(reply.status, problemCode(reply.text) ?? 'unexpected');
      let body: unknown;
      try {
        body = JSON.parse(reply.text);
      } catch {
        throw new ApiError(reply.status, 'bad_response');
      }
      if (!isOwnExport(body, accountId)) throw new ApiError(reply.status, 'bad_response');
      // The reply's own bytes, never re-serialized.
      return { accountId, json: reply.text };
    },

    async deletionStatus(token, signal) {
      const reply = await api.request({ method: 'GET', path: '/v1/me/deletion', token, signal });
      if (reply.status === 200) return provenDeletion(reply, accountId);
      // Only the problem's stable code is kept: never its title, detail or any other reply text.
      const code = problemCode(reply.text);
      if (reply.status === 404 && code === 'not_found') return null;
      throw new ApiError(reply.status, code ?? 'unexpected');
    },

    async deleteAccount(token, signal) {
      const body = JSON.stringify({ confirm: 'delete-account', account_id: accountId });
      const reply = await api.request({ method: 'POST', path: '/v1/me/deletion', token, signal, body, contentType: 'application/json' });
      // Each success status carries the proof of its own state only.
      if (reply.status === 202) return provenDeletion(reply, accountId, 'identity_deletion_pending');
      if (reply.status === 200) return provenDeletion(reply, accountId, 'completed');
      // Only the problem's stable code is kept: never its title, detail or any other reply text.
      throw new ApiError(reply.status, problemCode(reply.text) ?? 'unexpected');
    },
  };
}

/** Authenticated own-deletion discovery after /me410; no cached ID or local intent grants authority. */
export async function discoverOwnAccountDeletion(api: ApiClient, token: string, signal?: AbortSignal): Promise<AccountDeletion | null> {
  const reply = await api.request({ method: 'GET', path: '/v1/me/deletion', token, signal });
  if (reply.status === 404 && problemCode(reply.text) === 'not_found') return null;
  if (reply.status !== 200) throw new ApiError(reply.status, problemCode(reply.text) ?? 'unexpected');
  let body: unknown;
  try { body = JSON.parse(reply.text); } catch { throw new ApiError(reply.status, 'bad_response'); }
  if (!isRecord(body) || !isCanonicalUuid(body.account_id)) throw new ApiError(reply.status, 'bad_response');
  // This authenticated endpoint is scoped by the server to the bearer; its complete proof establishes the own ID.
  return provenDeletion(reply, body.account_id);
}
