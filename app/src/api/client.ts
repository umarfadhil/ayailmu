// Client of the local account API (backend/docs/Backend_Local_Contract.md in the backend worktree). The
// bearer token travels only in the Authorization header: no cookies (credentials: 'omit'), no redirects,
// nothing in URLs. Errors carry the HTTP status and the API's stable problem code, never response text or
// the token.
import { localPilotOrigin, PILOT_API_PORT } from '@/account/config';
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

/** A fetch reply, as far as it is read here. */
interface Reply {
  ok: boolean;
  status: number;
  url?: string;
  redirected?: boolean;
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

export function createApiClient(options: { baseUrl: string; fetch?: typeof fetch }): ApiClient {
  // Revalidated here too: an address other than the local pilot API never receives a token.
  const base = localPilotOrigin(options?.baseUrl, PILOT_API_PORT);
  if (!base) throw new Error('createApiClient needs the local pilot API address; nothing was sent.');
  const injected = options.fetch;

  /** One authenticated GET. Every failure becomes an ApiError with a stable code. */
  const get = async (path: string, token: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> => {
    if (typeof token !== 'string' || !BEARER_TOKEN.test(token)) throw new ApiError(0, 'unexpected');
    const url = `${base}${path}`;
    const init: RequestInit = {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'omit',
      redirect: 'error',
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
    let body: unknown;
    let readable = true;
    try {
      body = JSON.parse(text);
    } catch {
      readable = false;
    }
    if (reply.ok !== true) {
      // Only the problem's stable code is kept: never its title, detail or any other reply text.
      const code = readable && isRecord(body) && typeof body.code === 'string' && PROBLEM_CODE.test(body.code) ? body.code : 'unexpected';
      throw new ApiError(status, code);
    }
    if (!readable) throw new ApiError(status, 'bad_response');
    return { status, body };
  };

  return {
    async me(token, signal) {
      const { status, body } = await get('/v1/me', token, signal);
      const account = verifiedAccount(body);
      if (!account) throw new ApiError(status, 'bad_response');
      return account;
    },

    async request(_req) {
      throw new Error('ApiClient.request is not implemented yet');
    },
  };
}
