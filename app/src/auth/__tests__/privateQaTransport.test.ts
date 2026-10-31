// The private QA transport (createPrivateQaFetch) is the fetch the Auth SDK and the account API client get in a private
// QA build. These tests pin its contract before it exists: a bad binding, hash, deadline, origin, credential, fragment,
// cookie or body is refused before the bridge sees anything; an accepted request reaches the bridge exactly once, as
// asked; a 302 is handed back unfollowed; a reply from another URL or over 2 MiB is refused; the caller's abort and the
// deadline settle at once, cancel the native call and adopt nothing that comes later. The global fetch is replaced by a
// spy that must never run. The bridge is an in-memory fixture, the only I/O the transport has: it proves nothing about
// the native CA or hostname checks, which belong to the native module. No device, network, certificate or account.
import { PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN } from '@/account/privateQa';
import * as transport from '@/auth/privateQaTransport';
import type {
  CreatePrivateQaFetch,
  PrivateQaBinding,
  PrivateQaBridge,
  PrivateQaFetchOptions,
  PrivateQaNativeReply,
  PrivateQaNativeRequest,
  PrivateQaTransportError,
  PrivateQaTransportFacade,
  PrivateQaTransportFailure,
} from '@/auth/privateQaTransport';

/** Fixture digests: 64 lowercase hex characters each, of no real certificate. */
const CA_SHA256 = '0123456789abcdef'.repeat(4);
const OTHER_SHA256 = 'fedcba9876543210'.repeat(4);

const BINDING: PrivateQaBinding = { enabled: true, apiOrigin: PRIVATE_QA_API_ORIGIN, authOrigin: PRIVATE_QA_AUTH_ORIGIN, caSha256: CA_SHA256 };

const ME_URL = `${PRIVATE_QA_API_ORIGIN}/v1/me`;
const TOKEN_URL = `${PRIVATE_QA_AUTH_ORIGIN}/token?grant_type=password`;
const VERIFY_URL = `${PRIVATE_QA_AUTH_ORIGIN}/verify?token=fixture-token&type=recovery&redirect_to=arabictrial%3A%2F%2Frecover`;
const MIB = 1024 * 1024;

/** The factory, asserted to exist first, so a missing implementation fails here and never passes as a refusal. */
function factory(): CreatePrivateQaFetch {
  const facade = transport as Partial<PrivateQaTransportFacade>;
  expect(typeof facade.createPrivateQaFetch).toBe('function');
  return facade.createPrivateQaFetch as CreatePrivateQaFetch;
}

interface Call {
  request: PrivateQaNativeRequest;
  resolve(reply: PrivateQaNativeReply): void;
  reject(error: unknown): void;
}

/** An in-memory bridge: it reports `binding` and holds every request until the test answers it. */
function nativeBridge(binding: () => PrivateQaBinding | null = () => BINDING) {
  const calls: Call[] = [];
  const waiters = new Map<number, (call: Call) => void>();
  const cancels: string[] = [];
  const request = jest.fn(
    (asked: PrivateQaNativeRequest) =>
      new Promise<PrivateQaNativeReply>((resolve, reject) => {
        const call = { request: asked, resolve, reject };
        calls.push(call);
        waiters.get(calls.length - 1)?.(call);
      })
  );
  const port: PrivateQaBridge = {
    binding: jest.fn(binding),
    request,
    cancel: jest.fn((id: string) => {
      cancels.push(id);
    }),
  };
  /** The `n`th request (from 0) once the bridge has received it. */
  const called = (n: number): Promise<Call> => (calls[n] ? Promise.resolve(calls[n]) : new Promise((resolve) => waiters.set(n, resolve)));
  return { port, request, calls, cancels, called };
}

const reply = (url: string, over: Partial<PrivateQaNativeReply> = {}): PrivateQaNativeReply => ({
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
  url,
  ...over,
});

const header = (headers: Record<string, string>, name: string): string | undefined =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

/** Starts `run` now and gives its rejection; the test fails if it resolves. */
function failure(run: () => Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve) => resolve(run())).then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );
}

function expectTransportError(error: unknown, code: PrivateQaTransportFailure) {
  expect(error).toBeInstanceOf(Error);
  expect((error as PrivateQaTransportError).code).toBe(code);
}

/** Whether `promise` has settled yet, and how. */
function track(promise: Promise<unknown>) {
  const state = { settled: false, error: undefined as unknown };
  promise.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    }
  );
  return state;
}

let realFetch: typeof globalThis.fetch;
let globalFetch: jest.Mock;

beforeEach(() => {
  realFetch = globalThis.fetch;
  globalFetch = jest.fn(async () => {
    throw new Error('the global fetch was called; the private QA transport has no fallback');
  });
  globalThis.fetch = globalFetch as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
  expect(globalFetch).not.toHaveBeenCalled();
});

describe('the module', () => {
  it('loads without any native package and exposes createPrivateQaFetch', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-modules-core', () => {
        throw new Error('the private QA transport loaded expo-modules-core');
      });
      jest.doMock('expo', () => {
        throw new Error('the private QA transport loaded expo');
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require('@/auth/privateQaTransport') as Partial<PrivateQaTransportFacade>;
      expect(typeof loaded.createPrivateQaFetch).toBe('function');
    });
    jest.dontMock('expo-modules-core');
    jest.dontMock('expo');
  });
});

describe('refused before the bridge', () => {
  const BAD_BINDINGS: [string, () => PrivateQaBinding | null][] = [
    ['no binding', () => null],
    ['disabled', () => ({ ...BINDING, enabled: false }) as unknown as PrivateQaBinding],
    ['another API port', () => ({ ...BINDING, apiOrigin: 'https://localhost:58446' })],
    ['another Auth host', () => ({ ...BINDING, authOrigin: 'https://127.0.0.1:58445' })],
    ['swapped origins', () => ({ ...BINDING, apiOrigin: PRIVATE_QA_AUTH_ORIGIN, authOrigin: PRIVATE_QA_API_ORIGIN })],
    ['another CA', () => ({ ...BINDING, caSha256: OTHER_SHA256 })],
    ['the CA hash in upper case', () => ({ ...BINDING, caSha256: CA_SHA256.toUpperCase() })],
    ['no CA hash', () => ({ ...BINDING, caSha256: undefined }) as unknown as PrivateQaBinding],
    ['a binding that throws', () => {
      throw new Error('native module missing');
    }],
  ];

  it.each(BAD_BINDINGS)('a bad binding (%s) is refused as binding', async (_name, binding) => {
    const create = factory();
    const bridge = nativeBridge(binding);

    expectTransportError(await failure(() => create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 })(ME_URL)), 'binding');
    expect(bridge.request).not.toHaveBeenCalled();
  });

  const BAD_OPTIONS: [string, Omit<PrivateQaFetchOptions, 'bridge'>][] = [
    ['an upper-case expected hash', { expectedCaSha256: CA_SHA256.toUpperCase() }],
    ['a short expected hash', { expectedCaSha256: CA_SHA256.slice(1) }],
    ['a long expected hash', { expectedCaSha256: `${CA_SHA256}0` }],
    ['an empty expected hash', { expectedCaSha256: '' }],
    ['a deadline over 10000 ms', { expectedCaSha256: CA_SHA256, timeoutMs: 10_001 }],
    ['a zero deadline', { expectedCaSha256: CA_SHA256, timeoutMs: 0 }],
    ['a fractional deadline', { expectedCaSha256: CA_SHA256, timeoutMs: 1.5 }],
    ['a NaN deadline', { expectedCaSha256: CA_SHA256, timeoutMs: Number.NaN }],
  ];

  it.each(BAD_OPTIONS)('%s is refused as options, even when the binding agrees with it', async (_name, options) => {
    const create = factory();
    // The binding mirrors the expected hash, so only the options themselves can be the reason.
    const bridge = nativeBridge(() => ({ ...BINDING, caSha256: options.expectedCaSha256 }));

    expectTransportError(await failure(() => create({ bridge: bridge.port, ...options })(ME_URL)), 'options');
    expect(bridge.request).not.toHaveBeenCalled();
  });

  const BAD_URLS = [
    'http://localhost:58444/v1/me',
    'https://localhost:58446/v1/me',
    'https://localhost/v1/me',
    'https://localhost:058444/v1/me',
    'https://127.0.0.1:58444/v1/me',
    'https://LOCALHOST:58444/v1/me',
    'https://localhost:58444.example.test/v1/me',
    'https://qa@localhost:58444/v1/me',
    'https://qa:pw@localhost:58445/token',
    'https://localhost:58444/v1/me#fragment',
    'https://localhost:58445/verify?type=recovery#access_token=x',
    '/v1/me',
  ];

  it.each(BAD_URLS)('%s is refused as request', async (url) => {
    const create = factory();
    const bridge = nativeBridge();

    expectTransportError(await failure(() => create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 })(url)), 'request');
    expect(bridge.request).not.toHaveBeenCalled();
  });

  const BAD_INITS: [string, RequestInit][] = [
    ["credentials 'include'", { credentials: 'include' }],
    ["credentials 'same-origin'", { credentials: 'same-origin' }],
    ['a Cookie header', { headers: { cookie: 'sb-access-token=x' } }],
    ['a form body', { method: 'POST', body: new URLSearchParams({ grant_type: 'password' }) }],
    ['a body that is not JSON', { method: 'POST', body: 'grant_type=password' }],
  ];

  it.each(BAD_INITS)('%s is refused as request', async (_name, init) => {
    const create = factory();
    const bridge = nativeBridge();

    expectTransportError(await failure(() => create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 })(TOKEN_URL, init)), 'request');
    expect(bridge.request).not.toHaveBeenCalled();
  });
});

describe('an accepted request', () => {
  it('reaches the bridge once, exactly as asked, and comes back as a fetch-like reply', async () => {
    const create = factory();
    const bridge = nativeBridge();
    const privateFetch = create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 });
    const json = JSON.stringify({ email: 'fixture@example.test', password: 'fixture' });

    const me = privateFetch(ME_URL, { headers: { Accept: 'application/json', Authorization: 'Bearer fixture-token' }, credentials: 'omit' });
    const token = privateFetch(TOKEN_URL, { method: 'post', headers: { 'Content-Type': 'application/json', apikey: 'fixture-anon' }, body: json });
    const [first, second] = [await bridge.called(0), await bridge.called(1)];

    expect(first.request).toMatchObject({ url: ME_URL, method: 'GET', body: null });
    expect(header(first.request.headers, 'authorization')).toBe('Bearer fixture-token');
    expect(second.request).toMatchObject({ url: TOKEN_URL, method: 'POST', body: json });
    expect(header(second.request.headers, 'content-type')).toBe('application/json');
    for (const { request } of [first, second]) {
      expect(typeof request.id).toBe('string');
      expect(request.id).not.toBe('');
      expect(header(request.headers, 'cookie')).toBeUndefined();
    }
    expect(first.request.id).not.toBe(second.request.id);

    first.resolve(reply(ME_URL, { headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'r1' }, body: '{"account_id":"a"}' }));
    second.resolve(reply(TOKEN_URL, { status: 400, body: '{"error":"invalid_grant"}' }));
    const [meReply, tokenReply] = [await me, await token];

    expect(meReply).toMatchObject({ status: 200, ok: true, url: ME_URL, redirected: false });
    expect(meReply.headers.get('x-request-id')).toBe('r1');
    expect(meReply.headers.get('CONTENT-TYPE')).toBe('application/json');
    expect(await meReply.text()).toBe('{"account_id":"a"}');
    expect(tokenReply).toMatchObject({ status: 400, ok: false, url: TOKEN_URL });
    expect(await tokenReply.json()).toEqual({ error: 'invalid_grant' });
    expect(bridge.request).toHaveBeenCalledTimes(2);
    expect(bridge.cancels).toEqual([]);
  });

  it('hands a 302 from the bounded /verify query back unfollowed, for the recovery resolver to read', async () => {
    const create = factory();
    const bridge = nativeBridge();
    const pending = create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 })(VERIFY_URL);
    const call = await bridge.called(0);
    expect(call.request).toMatchObject({ url: VERIFY_URL, method: 'GET', body: null });

    call.resolve(reply(VERIFY_URL, { status: 302, headers: { Location: 'arabictrial://recover?code=fixture-code' }, body: '' }));
    const answer = await pending;

    expect(answer).toMatchObject({ status: 302, ok: false, url: VERIFY_URL, redirected: false });
    expect(answer.headers.get('location')).toBe('arabictrial://recover?code=fixture-code');
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });
});

describe('a reply that is not the one asked for', () => {
  it.each([
    ['another path', `${PRIVATE_QA_API_ORIGIN}/v1/elsewhere`],
    ['another origin', `${PRIVATE_QA_AUTH_ORIGIN}/v1/me`],
    ['a followed redirect', 'arabictrial://recover?code=fixture-code'],
    ['no URL', ''],
  ])('from %s is refused as reply', async (_name, answeredUrl) => {
    const create = factory();
    const bridge = nativeBridge();
    const pending = failure(() => create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 })(ME_URL));

    (await bridge.called(0)).resolve(reply(answeredUrl));

    expectTransportError(await pending, 'reply');
  });

  it('accepts a body of exactly 2 MiB and refuses one UTF-8 byte more, counted in bytes rather than characters', async () => {
    const create = factory();
    const bridge = nativeBridge();
    const privateFetch = create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 });
    const exact = 'x'.repeat(2 * MIB);

    const fits = privateFetch(ME_URL);
    (await bridge.called(0)).resolve(reply(ME_URL, { headers: { 'Content-Type': 'text/plain' }, body: exact }));
    expect((await (await fits).text()).length).toBe(2 * MIB);

    const over = failure(() => privateFetch(ME_URL));
    (await bridge.called(1)).resolve(reply(ME_URL, { headers: { 'Content-Type': 'text/plain' }, body: `${exact}x` }));
    expectTransportError(await over, 'reply');

    // 1 MiB + 1 two-byte characters: fewer characters than the limit, more bytes.
    const wide = failure(() => privateFetch(ME_URL));
    (await bridge.called(2)).resolve(reply(ME_URL, { headers: { 'Content-Type': 'text/plain' }, body: 'é'.repeat(MIB + 1) }));
    expectTransportError(await wide, 'reply');
  });

  it('a bridge failure is refused as bridge, with no fallback anywhere', async () => {
    const create = factory();
    const bridge = nativeBridge();
    const pending = failure(() => create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 })(ME_URL));

    (await bridge.called(0)).reject(new Error('native TLS evaluation failed'));

    expectTransportError(await pending, 'bridge');
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });
});

describe('settling', () => {
  it("the caller's abort rejects at once as an AbortError, cancels the native call and adopts nothing later", async () => {
    jest.useFakeTimers();
    const create = factory();
    const bridge = nativeBridge();
    const privateFetch = create({ bridge: bridge.port, expectedCaSha256: CA_SHA256 });

    const already = new AbortController();
    already.abort();
    expectTransportError(await failure(() => privateFetch(ME_URL, { signal: already.signal })), 'aborted');
    expect(bridge.request).not.toHaveBeenCalled();

    const controller = new AbortController();
    const pending = failure(() => privateFetch(ME_URL, { signal: controller.signal }));
    const call = await bridge.called(0);
    // No timer is advanced and the bridge never answers: only the abort itself can settle this.
    controller.abort();
    const error = await pending;

    expectTransportError(error, 'aborted');
    expect((error as Error).name).toBe('AbortError');
    expect(bridge.cancels).toEqual([call.request.id]);
    call.resolve(reply(ME_URL));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(bridge.cancels).toEqual([call.request.id]);
    expect(bridge.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the default 10000 ms deadline', undefined, 10_000],
    ['a 2500 ms deadline', 2_500, 2_500],
  ])('%s rejects as deadline from the start of the call, cancels the native call, and a late failure goes unheard', async (_name, timeoutMs, deadline) => {
    jest.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const create = factory();
      const bridge = nativeBridge();
      const options: PrivateQaFetchOptions = { bridge: bridge.port, expectedCaSha256: CA_SHA256, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
      const pending = create(options)(ME_URL);
      const state = track(pending);
      const call = await bridge.called(0);

      await jest.advanceTimersByTimeAsync(deadline - 1);
      expect(state.settled).toBe(false);
      expect(bridge.cancels).toEqual([]);

      await jest.advanceTimersByTimeAsync(1);
      expect(state.settled).toBe(true);
      expectTransportError(state.error, 'deadline');
      expect(bridge.cancels).toEqual([call.request.id]);

      call.reject(new Error('late native failure'));
      jest.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(bridge.cancels).toEqual([call.request.id]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
