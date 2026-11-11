// Exporting the signed-in account's server snapshot, RED (regression-first). The proposed createAccountControls(api,
// accountId), in @/api/client beside the maintained transport, captures the verified account's canonical ID; its
// exportData(token, signal) asks GET /v1/me/export once, with the token in the Authorization header only, and returns
// the server's reply text exactly as it came ({ accountId, json }), only when it is a whole export of that same account.
// It is a server snapshot only: guest data and unsent records stay on the device, as its own contents say. Errors are
// ApiErrors that never quote the reply, an identity or the token, and nothing here refreshes or retries. The real
// createApiClient runs over an injected fetch: nothing is contacted, and every value is a fixture.
import * as apiClient from '@/api/client';

const { ApiError, createApiClient } = apiClient;
type ApiClient = ReturnType<typeof createApiClient>;

/** The proposed export control, typed here before the module exports it. */
interface AccountControls {
  exportData(token: string, signal?: AbortSignal): Promise<{ accountId: string; json: string }>;
}
type AccountControlsFactory = (api: ApiClient, accountId: string) => AccountControls;
const proposed = apiClient as unknown as { createAccountControls?: AccountControlsFactory };

/** The proposed factory, asserted to exist before anything is exercised. */
function controlsFactory(): AccountControlsFactory {
  const factory = proposed.createAccountControls;
  expect(typeof factory).toBe('function');
  if (typeof factory !== 'function') throw new Error('createAccountControls is not exported yet');
  return factory;
}

const BASE = 'http://127.0.0.1:8092';
const OWN = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const OTHER = '9b2d4e61-3c8a-4f17-a5e0-2d7c6b1f8e93';
const TOKEN = 'account-controls-fixture-token';

/** A server export of `accountId`, as the API answers it. */
function envelope(accountId: string) {
  return {
    format: 'ayailmu-server-export-1',
    generated_at: '2026-10-22T15:15:00Z',
    contents: {
      included: 'The account and its profiles as the server keeps them',
      not_included: [{ what: 'device_data', why: 'Guest and unsent records stay on devices' }],
    },
    account: { account_id: accountId, created_at: '2026-10-01T08:00:00Z', issuer: 'https://auth.example.org', subject: 'synthetic-user', auth_mode: 'standalone-gotrue' },
    profiles: [],
  };
}
/** The own export, pretty-printed: any re-serialization would change these bytes. */
const ORIGINAL = JSON.stringify(envelope(OWN), null, 2);

/** An API that answers every request with `status` and exactly `text`, noting each request's URL and options. */
function server(status: number, text: string) {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, init });
    return { ok: status >= 200 && status < 300, status, url, redirected: false, headers: { get: () => null }, text: async () => text } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

/** Whether `error`'s message quotes any of `values` (a boolean, so none is printed). */
const quotes = (error: unknown, values: string[]) => {
  const message = error instanceof Error ? error.message : '';
  return values.some((value) => message.includes(value));
};

it("returns the own account's server snapshot as the exact reply text, from one bearer-only GET /v1/me/export", async () => {
  // Catches: a re-serialized or partial export, another path or method, an identity in the URL, a token anywhere but
  // the Authorization header, cookies, followed redirects, a body, or the caller's abort signal not reaching fetch.
  const factory = controlsFactory();
  const net = server(200, ORIGINAL);
  const controls = factory(createApiClient({ baseUrl: BASE, fetch: net.fetch }), OWN);
  const signal = new AbortController().signal;

  await expect(controls.exportData(TOKEN, signal)).resolves.toEqual({ accountId: OWN, json: ORIGINAL });
  expect(net.sent).toHaveLength(1);
  const sent = net.sent[0];
  expect(sent?.url).toBe(`${BASE}/v1/me/export`);
  expect(sent?.init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' });
  expect(sent?.init?.signal).toBe(signal);
  expect(sent?.init?.body ?? null).toBeNull();
  const headers = (sent?.init?.headers ?? {}) as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(Object.keys(headers).some((name) => name.toLowerCase() === 'cookie')).toBe(false);
  expect((sent?.url ?? '').includes(OWN)).toBe(false);
});

it("refuses a 200 reply that is not a whole export of the own account as bad_response, quoting nothing of it", async () => {
  // Catches: handing over malformed text, another export format, another account's export or one without its profiles,
  // in whole or in part, or an error message that carries the reply, an identity or the token.
  const factory = controlsFactory();
  const bad: [string, string][] = [
    ['malformed JSON', ORIGINAL.slice(0, -1)],
    ['another format', JSON.stringify({ ...envelope(OWN), format: 'ayailmu-server-export-2' }, null, 2)],
    ['another account', JSON.stringify(envelope(OTHER), null, 2)],
    ['no profiles array', JSON.stringify({ ...envelope(OWN), profiles: undefined }, null, 2)],
  ];
  for (const [name, text] of bad) {
    const net = server(200, text);
    const controls = factory(createApiClient({ baseUrl: BASE, fetch: net.fetch }), OWN);
    const error = await controls.exportData(TOKEN).then(
      () => null,
      (e: unknown) => e
    );
    expect({ name, error }).toMatchObject({ name, error: { status: 200, code: 'bad_response' } });
    expect(error).toBeInstanceOf(ApiError);
    expect(quotes(error, [TOKEN, OWN, OTHER, 'synthetic-user', 'https://auth.example.org', 'ayailmu-server-export'])).toBe(false);
    expect(net.sent).toHaveLength(1);
  }
});

it("passes the API's 401 reauthentication_required and 413 export_too_large on as ApiErrors, after one request each", async () => {
  // Catches: a refresh or retry at this layer, a lost stable code, or the provider's detail or the token in the message.
  const factory = controlsFactory();
  const detail = 'provider-detail-not-for-learners-7719';
  for (const [status, code] of [
    [401, 'reauthentication_required'],
    [413, 'export_too_large'],
  ] as const) {
    const net = server(status, JSON.stringify({ code, error: code, detail }));
    const controls = factory(createApiClient({ baseUrl: BASE, fetch: net.fetch }), OWN);
    const error = await controls.exportData(TOKEN).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ApiError);
    expect({ status, error }).toMatchObject({ status, error: { status, code } });
    expect(net.sent).toHaveLength(1);
    expect(quotes(error, [detail, TOKEN])).toBe(false);
  }
});
