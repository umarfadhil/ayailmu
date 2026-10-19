// Client of the local account API (backend/docs/Backend_Local_Contract.md in the backend worktree), or, under the
// explicit staging profile, of the staging API at its root origin. The bearer token travels only in the Authorization
// header: no cookies (credentials: 'omit'), no redirects, nothing in URLs. Errors carry the HTTP status and the API's
// stable problem code, never response text or the token.
import { accountApiOrigin } from '@/account/staging';
import { isCanonicalUuid } from '@/account/ids';

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when no response arrived. */
    readonly status: number,
    /** The API's stable problem code, or network, aborted, bad_response or unexpected. */
    readonly code: string
  ) {
    super(`Account service request failed (${status || 'no response'}: ${code})`);
    this.name = 'ApiError';
  }
}

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
   * no cookies, no redirects. Only a transport failure or a refused reply (redirect, other origin) throws an ApiError.
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
  fetch?: typeof fetch;
}): ApiClient {
  // Revalidated here too, with its profile: an address other than that profile's API (the local pilot API, or a staging
  // root origin under exactly the staging profile), or an unknown profile, never receives a token.
  const base = accountApiOrigin(options?.baseUrl, options?.environment);
  if (!base) throw new Error("createApiClient needs its profile's account API address; nothing was sent.");
  const injected = options.fetch;

  /**
   * One authenticated request with exactly `body`: the token in the Authorization header only, no cookies, no
   * redirects. A transport failure or a reply from anywhere else becomes an ApiError; any HTTP status is returned.
   */
  const send = async (req: ApiRequest): Promise<ApiReply & { ok: boolean }> => {
    const { method, path, token, signal, body, contentType, ifMatch } = req;
    if (typeof token !== 'string' || !BEARER_TOKEN.test(token)) throw new ApiError(0, 'unexpected');
    if (typeof path !== 'string' || !API_PATH.test(path) || path.split('?')[0].split('/').some((s) => s === '.' || s === '..')) {
      throw new ApiError(0, 'unexpected');
    }
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = contentType ?? 'application/json';
    if (ifMatch !== undefined) headers['If-Match'] = ifMatch;
    const url = `${base}${path}`;
    const init: RequestInit = {
      method,
      headers,
      credentials: 'omit',
      redirect: 'error',
      ...(body !== undefined ? { body } : {}),
      ...(signal ? { signal } : {}),
    };
    const failed = (error: unknown) => new ApiError(0, isAbort(error) || signal?.aborted === true ? 'aborted' : 'network');
    let reply: Reply;
    try {
      reply = (await (injected ? injected(url, init) : globalThis.fetch(url, init))) as unknown as Reply;
    } catch (error) {
      throw failed(error);
    }
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
