// The local account API adapter (GET /v1/me), written before its implementation. The network is an injected
// transport that records each request exactly as sent and answers with the replies a device can meet. The
// bearer token may appear only in the Authorization header, and nothing is stored or logged.
import { ApiError, createApiClient } from '@/api/client';

const BASE = 'http://127.0.0.1:8092';
const TOKEN = 'id-token-ani-5c1e';
const ACCOUNT_ID = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const PROFILE_ID = 'c2e4a6b8-1d3f-4e5a-8b7c-9d0e1f2a3b4c';
const PROBLEM = 'application/problem+json';

interface FetchInit {
  method?: string;
  headers?: unknown;
  body?: unknown;
  credentials?: string;
  redirect?: string;
  signal?: unknown;
}
type Reply = { status: number; body: unknown; type?: string; redirected?: boolean; url?: string } | { fail: Error };

/** The API behind the injected fetch: records each request as sent and answers with `reply`. */
function transport(reply: Reply) {
  const sent: { url: string; init: FetchInit }[] = [];
  const calls = jest.fn(async (input: unknown, init: FetchInit = {}) => {
    sent.push({ url: String(input), init });
    if ('fail' in reply) throw reply.fail;
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      redirected: reply.redirected ?? false,
      url: reply.url ?? `${BASE}/v1/me`,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (reply.type ?? 'application/json') : null) },
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    };
  });
  return { fetch: calls as unknown as typeof fetch, sent };
}

/** The request headers as lower-case name → value, whichever form fetch was given. */
function headerMap(headers: unknown): Record<string, string> {
  const pairs: [string, string][] = [];
  if (Array.isArray(headers)) pairs.push(...(headers as [string, string][]));
  else if (headers && typeof (headers as Headers).forEach === 'function') (headers as Headers).forEach((value, name) => pairs.push([name, value]));
  else if (headers) pairs.push(...Object.entries(headers as Record<string, string>));
  return Object.fromEntries(pairs.map(([name, value]) => [name.toLowerCase(), String(value)]));
}

/** Replaces a global for one test; returns the undo. */
function replaceGlobal(name: 'localStorage' | 'sessionStorage', value: unknown): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(globalThis, name, before);
    else Reflect.deleteProperty(globalThis, name);
  };
}

/** Starts `run` now and gives its rejection (a synchronous throw counts); the test fails if it resolves. */
function failure(run: () => Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve) => resolve(run())).then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );
}

describe('GET /v1/me adapter', () => {
  const fakeWebStorage = () => ({ length: 0, key: jest.fn(() => null), getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn() });
  let web = { local: fakeWebStorage(), session: fakeWebStorage() };
  let undo: (() => void)[] = [];
  let logs: jest.SpyInstance[] = [];
  beforeEach(() => {
    web = { local: fakeWebStorage(), session: fakeWebStorage() };
    undo = [replaceGlobal('localStorage', web.local), replaceGlobal('sessionStorage', web.session)];
    logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  });
  afterEach(() => {
    undo.forEach((restore) => restore());
    const logged = logs.map((spy) => spy.mock.calls.length);
    logs.forEach((spy) => spy.mockRestore());
    // Nothing about the account, the token or the reply is stored or logged.
    for (const storage of [web.local, web.session]) expect(storage.setItem).not.toHaveBeenCalled();
    expect(logged).toEqual([0, 0, 0, 0, 0]);
  });

  it('asks the loopback API who is signed in: Bearer token in the Authorization header only, no cookies, no redirects; returns the verified account', async () => {
    const net = transport({ status: 200, body: { account_id: ACCOUNT_ID, profiles: [{ profile_id: PROFILE_ID, revision: 3, high_seq: 12 }] } });
    const api = createApiClient({ baseUrl: BASE, fetch: net.fetch });
    const controller = new AbortController();

    await expect(api.me(TOKEN, controller.signal)).resolves.toEqual({
      accountId: ACCOUNT_ID,
      profiles: [{ profileId: PROFILE_ID, revision: 3, highSeq: 12 }],
    });

    expect(net.sent).toHaveLength(1);
    const [{ url, init }] = net.sent;
    expect(url).toBe(`${BASE}/v1/me`);
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body ?? null).toBeNull();
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toMatch(/^(error|manual)$/);
    expect(init.signal).toBe(controller.signal);
    const headers = headerMap(init.headers);
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.cookie).toBeUndefined();
    // The token is in that one header and nowhere else in the request.
    const elsewhere = Object.entries(headers).filter(([name]) => name !== 'authorization');
    expect(JSON.stringify([url, elsewhere])).not.toContain(TOKEN);

    // An address other than the local pilot API is refused before anything is sent.
    for (const baseUrl of ['http://api.example.com:8092', 'http://127.0.0.1:8092@evil.test:8092', 'https://127.0.0.1:8092', 'http://127.0.0.1:8085']) {
      expect(() => createApiClient({ baseUrl, fetch: net.fetch })).toThrow();
    }
    expect(net.sent).toHaveLength(1);
  });

  const FAILURES: { case: string; reply: Reply; status?: number; code: string; hidden: string[] }[] = [
    {
      case: 'an API 401',
      reply: { status: 401, type: PROBLEM, body: { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'unauthenticated', detail: `bearer ${TOKEN} was rejected` } },
      status: 401,
      code: 'unauthenticated',
      hidden: ['was rejected', 'Unauthorized'],
    },
    {
      case: 'a server error whose detail names internals',
      reply: { status: 500, type: PROBLEM, body: { title: 'Internal Server Error', status: 500, code: 'internal_error', detail: 'pgx: password authentication failed for user aya_rn' } },
      status: 500,
      code: 'internal_error',
      hidden: ['password authentication', 'aya_rn'],
    },
    {
      case: 'an HTML error page from something in between',
      reply: { status: 502, type: 'text/html', body: '<html>bad gateway: upstream 10.0.0.7</html>' },
      status: 502,
      code: 'unexpected',
      hidden: ['bad gateway', '10.0.0.7'],
    },
    {
      case: 'a success reply that is not JSON',
      reply: { status: 200, type: 'text/html', body: '<html>captive portal login</html>' },
      status: 200,
      code: 'bad_response',
      hidden: ['captive portal'],
    },
    {
      case: 'an account ID that is an e-mail address',
      reply: { status: 200, body: { account_id: 'ani@ayailmu.test', profiles: [] } },
      status: 200,
      code: 'bad_response',
      hidden: ['ani@ayailmu.test'],
    },
    {
      case: 'an account ID that is a local learner ID',
      reply: { status: 200, body: { account_id: 'lrn-guest-1', profiles: [] } },
      status: 200,
      code: 'bad_response',
      hidden: ['lrn-guest-1'],
    },
    {
      case: 'a malformed profile summary',
      reply: { status: 200, body: { account_id: ACCOUNT_ID, profiles: [{ profile_id: '../guest', revision: 0, high_seq: -1 }] } },
      status: 200,
      code: 'bad_response',
      hidden: ['../guest'],
    },
    {
      case: 'a redirect that was followed anyway',
      reply: { status: 200, redirected: true, url: 'http://evil.test/v1/me', body: { account_id: ACCOUNT_ID, profiles: [] } },
      code: 'bad_response',
      hidden: ['evil.test'],
    },
    { case: 'an unreachable API', reply: { fail: new TypeError('Network request failed') }, status: 0, code: 'network', hidden: ['Network request failed'] },
    {
      case: 'an aborted request',
      reply: { fail: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }) },
      status: 0,
      code: 'aborted',
      hidden: ['operation was aborted'],
    },
  ];
  it.each(FAILURES)('$case gives a typed ApiError ($code), never server text or the token', async ({ reply, status, code, hidden }) => {
    const net = transport(reply);

    const error = await failure(() => createApiClient({ baseUrl: BASE, fetch: net.fetch }).me(TOKEN));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject(status === undefined ? { code } : { code, status });
    const shown = `${String(error)} ${JSON.stringify(error)}`;
    for (const secret of [TOKEN, ...hidden]) expect(shown).not.toContain(secret);
  });
});
