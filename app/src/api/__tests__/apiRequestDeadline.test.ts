// The account API client's whole-request deadline (C2 in app/docs/plans/2026-10-20-correctness.md), written before the
// fix. Today me() and request() await fetch and then the reply body without any bound: a reply whose headers never come,
// or whose body stalls after them, leaves the call pending for good, and with it the sign-in check, a profile link or a
// sync. Each call must settle within one deadline of 60 s from its start, headers and body together (the headers never
// restart it), as a lost connection does (ApiError 0 network), with no reply text. A caller's AbortSignal still reaches
// fetch as that very object (accountApi.test.ts) and the client never aborts it: on its own deadline it only stops
// waiting. Without a caller signal the client gives fetch one of its own and aborts it at the deadline, best effort. A
// caller's abort settles the call at once as aborted, and an already aborted signal sends nothing. The injected transport
// ignores every abort, as a stuck fetch may, so only the client can bound what its caller sees. A late reply is neither
// read nor returned, every settled call leaves no timer and no abort listener behind, and a 16 MiB import answered inside
// the deadline goes out and comes back whole. Time is Jest's fake clock; nothing waits in real time.
import { ApiError, createApiClient, type ApiClient, type ApiReply, type ApiRequest } from '@/api/client';
import { SERVER_LIMITS } from '@/sync/journal';

const BASE = 'http://127.0.0.1:8092';
const TOKEN = 'id-token-ani-deadline-3c9f';
const ACCOUNT_ID = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const T = Date.UTC(2026, 9, 20, 3, 0, 0);
const SECOND = 1_000;
/** The planned default (API_REQUEST_TIMEOUT_MS once the client exports it): one deadline for headers and body together. */
const DEADLINE_MS = 60_000;
const IMPORT_TEXT = '{"import_id":"imp-deadline-1"}';
const RECEIPT = '{"import_id":"imp-deadline-1","replayed":false,"stored":1,"identical":0}';
const PROBLEM = '{"type":"about:blank","title":"Conflict","status":409,"code":"import_id_reused","detail":"import imp-deadline-1 was used"}';
const ME = JSON.stringify({ account_id: ACCOUNT_ID, profiles: [] });
/** Nothing of these may show in an error: the token, the account, the transport's own text or any reply text. */
const HIDDEN = [TOKEN, ACCOUNT_ID, 'Network request failed', 'import_id_reused', 'imp-deadline'];

const ignore = () => undefined;

/** A promise settled from outside. A rejection nobody awaits any more is not reported as unhandled. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(ignore);
  return { promise, resolve, reject };
}

interface ReplyHead {
  status: number;
  etag?: string | null;
  /** A redirect that was followed anyway (React Native's fetch does not honour redirect: 'error'). */
  redirected?: boolean;
}

/** One request as the transport saw it. Its reply comes only when the test sends it, the headers and the body apart. */
interface Exchange {
  url: string;
  init: RequestInit;
  /** The signal fetch was given, or null. The transport never acts on it, as a stuck fetch may not. */
  signal: AbortSignal | null;
  /** Whether the client asked for the reply body. */
  bodyRead: boolean;
  /** The status line and headers arrive: fetch resolves. */
  respond(head: ReplyHead): void;
  /** The body arrives in full: text() resolves. */
  deliver(text: string): void;
  /** The connection drops: whatever is still awaited, fetch or the body, fails as fetch does. */
  drop(): void;
}

/** The account API behind the injected fetch: records each request and answers only when told; it ignores every abort. */
function stallingNetwork() {
  const exchanges: Exchange[] = [];
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const head = deferred<Response>();
    const body = deferred<string>();
    const exchange: Exchange = {
      url,
      init,
      signal: init.signal ?? null,
      bodyRead: false,
      respond: ({ status, etag = null, redirected = false }) => {
        const headers: Record<string, string | null> = { 'content-type': 'application/json', etag };
        head.resolve({
          ok: status >= 200 && status < 300,
          status,
          url,
          redirected,
          headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
          text: () => {
            exchange.bodyRead = true;
            return body.promise;
          },
        } as unknown as Response);
      },
      deliver: (text) => body.resolve(text),
      drop: () => {
        head.reject(new TypeError('Network request failed'));
        body.reject(new TypeError('Network request failed'));
      },
    };
    exchanges.push(exchange);
    return head.promise;
  };
  return {
    fetch,
    exchanges,
    /** The end of a test: every reply still outstanding fails, so no call outlives it. */
    close: () => exchanges.forEach((exchange) => exchange.drop()),
  };
}

interface Tracked<T> {
  settled: boolean;
  /** When it settled, on Jest's clock. */
  at: number | null;
  value?: T;
  error?: unknown;
}

/** Follows a promise without awaiting it: whether it settled, when and how. A call that never settles never holds the test. */
function track<T>(promise: Promise<T>): Tracked<T> {
  const state: Tracked<T> = { settled: false, at: null };
  promise.then(
    (value) => Object.assign(state, { settled: true, at: Date.now(), value }),
    (error: unknown) => Object.assign(state, { settled: true, at: Date.now(), error })
  );
  return state;
}

/** Lets queued promise callbacks run; Jest's clock stays where it is. */
async function flush() {
  for (let i = 0; i < 20; i += 1) await jest.advanceTimersByTimeAsync(0);
}

/** Moves Jest's clock on by `ms`, running whatever falls due, then lets promise callbacks run. */
async function wait(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
  await flush();
}

/** A typed ApiError with this status and code, showing nothing of HIDDEN. */
function expectApiError(error: unknown, status: number, code: string) {
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status, code });
  const shown = `${String(error)} ${JSON.stringify(error)}`;
  for (const secret of HIDDEN) expect(shown).not.toContain(secret);
}

/** A caller's own signal, as the auth layer passes one; the abort listeners put on it and not taken off again are counted. */
function callerSignal() {
  const controller = new AbortController();
  const added = jest.spyOn(controller.signal, 'addEventListener');
  const removed = jest.spyOn(controller.signal, 'removeEventListener');
  const abortListeners = (calls: readonly (readonly unknown[])[]) => calls.filter((call) => call[0] === 'abort').map((call) => call[1]);
  return {
    controller,
    signal: controller.signal,
    /** The abort listeners still attached. */
    attached: () => {
      const off = abortListeners(removed.mock.calls);
      return abortListeners(added.mock.calls).filter((listener) => !off.includes(listener));
    },
  };
}

const importRequest = (signal?: AbortSignal, body = IMPORT_TEXT): ApiRequest => ({
  method: 'POST',
  path: '/v1/imports',
  token: TOKEN,
  signal,
  body,
  contentType: 'application/json',
});

let net = stallingNetwork();
let api: ApiClient = createApiClient({ baseUrl: BASE, fetch: net.fetch });

beforeEach(() => {
  jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'queueMicrotask'] });
  net = stallingNetwork();
  api = createApiClient({ baseUrl: BASE, fetch: net.fetch });
});

afterEach(async () => {
  // Every reply still outstanding fails, so no call outlives its test; then the real clock and the signals come back.
  net.close();
  await flush();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the account API client: one deadline for the whole request, headers and body together', () => {
  it('control: a stored import, an API refusal, a refused redirect and a lost connection settle as today; fetch gets the caller signal itself, and nothing is left behind', async () => {
    const answers: [string, (exchange: Exchange) => void][] = [
      [
        'stored',
        (e) => {
          e.respond({ status: 201, etag: '"r1"' });
          e.deliver(RECEIPT);
        },
      ],
      [
        'refused by the API',
        (e) => {
          e.respond({ status: 409 });
          e.deliver(PROBLEM);
        },
      ],
      ['redirected', (e) => e.respond({ status: 200, redirected: true })],
      ['lost', (e) => e.drop()],
    ];
    const results = new Map<string, Tracked<ApiReply>>();
    for (const [what, answer] of answers) {
      const caller = callerSignal();
      const pending = track(api.request(importRequest(caller.signal)));
      await flush();
      const exchange = net.exchanges[net.exchanges.length - 1];
      expect({ what, sameSignal: exchange.signal === caller.signal }).toEqual({ what, sameSignal: true });
      answer(exchange);
      await flush();
      // Settled, with no deadline timer and no abort listener left, and the caller's signal as it was.
      expect({ what, settled: pending.settled, timers: jest.getTimerCount(), listeners: caller.attached().length, aborted: caller.signal.aborted }).toEqual({
        what,
        settled: true,
        timers: 0,
        listeners: 0,
        aborted: false,
      });
      results.set(what, pending);
    }
    expect(results.get('stored')?.value).toEqual({ status: 201, text: RECEIPT, etag: '"r1"' });
    expect(results.get('refused by the API')?.value).toEqual({ status: 409, text: PROBLEM, etag: null });
    expectApiError(results.get('redirected')?.error, 200, 'bad_response');
    expectApiError(results.get('lost')?.error, 0, 'network');
  });

  it.each([
    { entry: 'me()', path: '/v1/me', call: (signal: AbortSignal): Promise<unknown> => api.me(TOKEN, signal) },
    { entry: 'request()', path: '/v1/imports', call: (signal: AbortSignal): Promise<unknown> => api.request(importRequest(signal)) },
  ])('$entry: a reply whose headers never come settles at the deadline as a lost connection; the caller signal stays untouched and a late reply is never read', async ({ path, call }) => {
    const caller = callerSignal();
    const pending = track(call(caller.signal));
    await flush();
    expect(net.exchanges.map((e) => e.url)).toEqual([`${BASE}${path}`]);
    const [exchange] = net.exchanges;
    expect(exchange.signal).toBe(caller.signal);

    await wait(DEADLINE_MS - 1);
    expect(pending.settled).toBe(false);
    await wait(1);

    expect(pending.settled).toBe(true);
    expect(pending.at).toBe(T + DEADLINE_MS);
    expectApiError(pending.error, 0, 'network');
    // The client cannot abort a signal it does not own, and does not try: it stops waiting and lets go of the signal.
    expect(caller.signal.aborted).toBe(false);
    expect(caller.attached()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);

    // The reply arriving afterwards is neither read nor returned.
    exchange.respond({ status: 200 });
    exchange.deliver(ME);
    await flush();
    expect(exchange.bodyRead).toBe(false);
    expectApiError(pending.error, 0, 'network');
  });

  it('a body that stalls after its headers settles at the same deadline, counted from the start: the headers do not restart it', async () => {
    const caller = callerSignal();
    const pending = track(api.request(importRequest(caller.signal)));
    await flush();
    const [exchange] = net.exchanges;

    // The headers take 40 s; then the body stalls.
    await wait(40 * SECOND);
    exchange.respond({ status: 201 });
    await flush();
    expect(exchange.bodyRead).toBe(true);
    await wait(DEADLINE_MS - 40 * SECOND - 1);
    expect(pending.settled).toBe(false);
    await wait(1);

    expect(pending.settled).toBe(true);
    expect(pending.at).toBe(T + DEADLINE_MS);
    expectApiError(pending.error, 0, 'network');
    expect(caller.signal.aborted).toBe(false);
    expect(caller.attached()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);

    // The body arriving afterwards is not returned.
    exchange.deliver(RECEIPT);
    await flush();
    expectApiError(pending.error, 0, 'network');
  });

  it('without a caller signal the client gives fetch its own and aborts it at the deadline, best effort; the call settles though the transport ignores the abort', async () => {
    const pending = track(api.request(importRequest()));
    await flush();
    const [exchange] = net.exchanges;
    expect(exchange.signal).not.toBeNull();
    expect(exchange.signal?.aborted).toBe(false);
    // The headers come at once; then the body stalls.
    exchange.respond({ status: 201 });
    await flush();
    await wait(DEADLINE_MS - 1);
    expect(pending.settled).toBe(false);
    expect(exchange.signal?.aborted).toBe(false);
    await wait(1);

    expect(exchange.signal?.aborted).toBe(true);
    expect(pending.settled).toBe(true);
    expect(pending.at).toBe(T + DEADLINE_MS);
    expectApiError(pending.error, 0, 'network');
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['headers', 'body'] as const)('a caller abort while waiting for the %s settles the call at once as aborted, though the transport ignores it; nothing comes of a late reply', async (phase) => {
    const caller = callerSignal();
    const pending = track(api.request(importRequest(caller.signal)));
    await flush();
    const [exchange] = net.exchanges;
    if (phase === 'body') {
      exchange.respond({ status: 201 });
      await flush();
    }
    await wait(5 * SECOND);
    expect(pending.settled).toBe(false);

    caller.controller.abort();
    await flush();

    expect(pending.settled).toBe(true);
    expect(pending.at).toBe(T + 5 * SECOND);
    expectApiError(pending.error, 0, 'aborted');
    expect(jest.getTimerCount()).toBe(0);

    // Whatever the transport does later changes nothing, and a reply that comes after the abort is not read.
    exchange.respond({ status: 201 });
    exchange.deliver(RECEIPT);
    await flush();
    expect(exchange.bodyRead).toBe(phase === 'body');
    expectApiError(pending.error, 0, 'aborted');
  });

  it('an already aborted caller signal sends nothing and settles as aborted', async () => {
    const caller = callerSignal();
    caller.controller.abort();
    const pending = track(api.request(importRequest(caller.signal)));
    await flush();

    expect(net.exchanges.map((e) => e.url)).toEqual([]);
    expect(pending.settled).toBe(true);
    expectApiError(pending.error, 0, 'aborted');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a 16 MiB import answered 1 ms before the deadline is sent byte for byte and its receipt returned whole: no smaller cap, nothing left behind', async () => {
    const opening = '{"import_id":"imp-deadline-large","events":["';
    const closing = '"]}';
    const large = `${opening}${'x'.repeat(SERVER_LIMITS.importBytes - opening.length - closing.length)}${closing}`;
    expect(large.length).toBe(SERVER_LIMITS.importBytes);
    const caller = callerSignal();
    const pending = track(api.request(importRequest(caller.signal, large)));
    await flush();
    const [exchange] = net.exchanges;
    // Compared as one value, so a failure never prints 16 MiB.
    expect(exchange.init.body === large).toBe(true);

    // A slow link: the headers after 30 s, the receipt 1 ms before the deadline.
    await wait(30 * SECOND);
    exchange.respond({ status: 201 });
    await wait(DEADLINE_MS - 30 * SECOND - 1);
    exchange.deliver(RECEIPT);
    await flush();

    expect(pending.settled).toBe(true);
    expect(pending.at).toBe(T + DEADLINE_MS - 1);
    expect(pending.value).toEqual({ status: 201, text: RECEIPT, etag: null });
    expect(caller.signal.aborted).toBe(false);
    expect(caller.attached()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });
});
