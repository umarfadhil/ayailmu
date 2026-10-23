// Deleting the signed-in account, RED (regression-first). On createAccountControls(api, accountId), the proposed
// deleteAccount(token, signal) sends one POST /v1/me/deletion confirming that same account and deletionStatus(token,
// signal) one GET /v1/me/deletion; each returns the server's validated deletion document as it came (deletionStatus may
// also return null), never a rewritten UI state, so an accepted deletion stays pending until a GET reports it completed.
// The real createApiClient runs over an injected fetch: nothing is contacted or deleted, and every value is a fixture.
import { createAccountControls, createApiClient } from '@/api/client';

/** The proposed deletion controls, typed here before AccountControls declares them: each answers a server document. */
interface DeletionControls {
  deleteAccount(token: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  deletionStatus(token: string, signal?: AbortSignal): Promise<Record<string, unknown> | null>;
}

const BASE = 'http://127.0.0.1:8092';
const DELETION_URL = `${BASE}/v1/me/deletion`;
const OWN = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const DELETION = '9b2d4e61-3c8a-4f17-a5e0-2d7c6b1f8e93';
const TOKEN = 'account-deletion-fixture-token';

/** The accepted deletion: the server's data erased, the identity provider's deletion still pending. */
const PENDING = {
  deletion_id: DELETION,
  account_id: OWN,
  status: 'identity_deletion_pending',
  requested_at: '2026-10-22T15:15:00Z',
  server_data: { status: 'erased', erased_at: '2026-10-22T15:15:00Z', profiles: 1, device_links: 1, events: 2, imports: 1 },
  identity_provider: { status: 'pending', attempts: 1 },
  not_deleted: [
    { what: 'deletion_record', why: 'Retention not decided' },
    { what: 'device_data', why: 'Other device copies remain' },
  ],
};
/** The same deletion once the identity provider has deleted the sign-in as well. */
const COMPLETED = {
  ...PENDING,
  status: 'completed',
  completed_at: '2026-10-22T15:16:00Z',
  identity_provider: { status: 'deleted', attempts: 2, deleted_at: '2026-10-22T15:16:00Z' },
};

/** An API that answers each request with the next queued status and document, noting each request's URL and options. */
function server(replies: [number, unknown][]) {
  const queue = [...replies];
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('No reply is queued for this request');
    const [status, body] = next;
    return { ok: status >= 200 && status < 300, status, url, redirected: false, headers: { get: () => null }, text: async () => JSON.stringify(body) } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

/** The headers a request was sent with, as the client builds them. */
const headersOf = (init: RequestInit | undefined) => (init?.headers ?? {}) as Record<string, string>;

afterEach(() => {
  jest.restoreAllMocks();
});

it('keeps an accepted deletion pending until GET /v1/me/deletion reports it completed, returning each server document as sent', async () => {
  // Catches: missing controls; a deletion reported done once accepted, polled to completion or rewritten into UI state;
  // a stored answer, retry or refresh instead of each single request; another path, method or confirmation; a token
  // outside the Authorization header; cookies, followed redirects, a GET body, a lost caller signal; console output.
  const logged = jest.fn();
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, level).mockImplementation(logged);
  const net = server([[202, PENDING], [200, PENDING], [200, COMPLETED]]);
  const api = createApiClient({ baseUrl: BASE, fetch: net.fetch });
  const controls = createAccountControls(api, OWN) as unknown as DeletionControls;
  const kinds = { deleteAccount: typeof controls.deleteAccount, deletionStatus: typeof controls.deletionStatus };
  expect(kinds).toEqual({ deleteAccount: 'function', deletionStatus: 'function' });
  const signal = new AbortController().signal;

  await expect(controls.deleteAccount(TOKEN, signal)).resolves.toStrictEqual(PENDING);
  await expect(controls.deletionStatus(TOKEN, signal)).resolves.toStrictEqual(PENDING);
  await expect(controls.deletionStatus(TOKEN, signal)).resolves.toStrictEqual(COMPLETED);

  expect(net.sent.map(({ url, init }) => [init?.method, url])).toEqual([
    ['POST', DELETION_URL],
    ['GET', DELETION_URL],
    ['GET', DELETION_URL],
  ]);
  const posted = net.sent[0]?.init?.body;
  const confirmation: unknown = typeof posted === 'string' ? JSON.parse(posted) : posted;
  expect(confirmation).toStrictEqual({ confirm: 'delete-account', account_id: OWN });
  expect(headersOf(net.sent[0]?.init)['Content-Type']).toBe('application/json');
  expect(net.sent.slice(1).map(({ init }) => init?.body ?? null)).toEqual([null, null]);
  for (const { init } of net.sent) {
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(init?.signal).toBe(signal);
    const headers = headersOf(init);
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(Object.entries(headers).filter(([, value]) => value.includes(TOKEN)).map(([name]) => name)).toEqual(['Authorization']);
  }
  expect(logged).not.toHaveBeenCalled();
});
