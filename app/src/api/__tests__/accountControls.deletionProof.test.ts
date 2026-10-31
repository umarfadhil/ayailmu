// Deleting the signed-in account: the proof and error matrix, RED (regression-first). The proposed deleteAccount (POST
// /v1/me/deletion) and deletionStatus (GET /v1/me/deletion) on createAccountControls(api, accountId) send one request
// each and answer the server's raw deletion document only when it proves its state for this same account: a POST
// answers 202 while the deletion is pending and 200 once it is completed, and GET's 404 not_found is null. Any other
// problem keeps its status and stable code, a reply that proves nothing is bad_response, and no error quotes the reply,
// the token or another account. The existing factory guard is pinned too: an ID that is not canonical gets no controls.
// The real createApiClient runs over an injected fetch: nothing is contacted, and every value is a fixture.
import { ApiError, createAccountControls, createApiClient } from '@/api/client';

/** The proposed deletion controls, typed here before AccountControls declares them: each answers a server document. */
interface DeletionControls {
  deleteAccount(token: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  deletionStatus(token: string, signal?: AbortSignal): Promise<Record<string, unknown> | null>;
}

const BASE = 'http://127.0.0.1:8092';
const DELETION_URL = `${BASE}/v1/me/deletion`;
const OWN = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const OTHER = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
const DELETION = '9b2d4e61-3c8a-4f17-a5e0-2d7c6b1f8e93';
const TOKEN = 'account-deletion-fixture-token';
/** Server detail that no error may quote. */
const PRIVATE = 'provider-detail-not-for-learners-5531';

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

/** An API that answers one request with `status` and exactly `text`, noting each request's URL and options. */
function server(status: number, text: string) {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, init });
    if (sent.length > 1) throw new Error('Only one reply is queued');
    return { ok: status >= 200 && status < 300, status, url, redirected: false, headers: { get: () => null }, text: async () => text } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const json = (value: unknown) => JSON.stringify(value);
/** An API problem: its stable code, and detail that must stay out of every error. */
const problem = (code: string) => json({ code, detail: PRIVATE });

/** How a row's call settles: resolved to exactly this value, or rejected with an ApiError of this [status, code]. */
type Outcome = { resolves: Record<string, unknown> | null } | { rejects: [number, string] };
const answers = (value: Record<string, unknown> | null): Outcome => ({ resolves: value });
const fails = (status: number, code: string): Outcome => ({ rejects: [status, code] });
const bad = (status: number) => fails(status, 'bad_response');

const CASES: [name: string, method: 'POST' | 'GET', status: number, text: string, expected: Outcome][] = [
  ['POST 200 completed: the document as sent', 'POST', 200, json(COMPLETED), answers(COMPLETED)],
  ['GET 404 not_found: null', 'GET', 404, json({ code: 'not_found' }), answers(null)],
  ['GET 404 unexpected_missing: that problem, not null', 'GET', 404, problem('unexpected_missing'), fails(404, 'unexpected_missing')],
  ['POST 401 reauthentication_required: that problem', 'POST', 401, problem('reauthentication_required'), fails(401, 'reauthentication_required')],
  ['POST 503 account_deletion_failed: that problem', 'POST', 503, problem('account_deletion_failed'), fails(503, 'account_deletion_failed')],
  ['POST 500 internal_error: that problem', 'POST', 500, problem('internal_error'), fails(500, 'internal_error')],
  ['POST 200 pending: bad_response', 'POST', 200, json(PENDING), bad(200)],
  ['POST 202 completed: bad_response', 'POST', 202, json(COMPLETED), bad(202)],
  ['GET 200 another account: bad_response', 'GET', 200, json({ ...PENDING, account_id: OTHER }), bad(200)],
  ['GET 200 non-UUID deletion_id: bad_response', 'GET', 200, json({ ...PENDING, deletion_id: 'not-a-uuid' }), bad(200)],
  ['GET 200 negative events: bad_response', 'GET', 200, json({ ...PENDING, server_data: { ...PENDING.server_data, events: -1 } }), bad(200)],
  ['GET 200 pending with completed_at: bad_response', 'GET', 200, json({ ...PENDING, completed_at: COMPLETED.completed_at }), bad(200)],
  ['GET 200 completed, provider pending: bad_response', 'GET', 200, json({ ...COMPLETED, identity_provider: PENDING.identity_provider }), bad(200)],
  ['GET 200 completed without completed_at: bad_response', 'GET', 200, json({ ...COMPLETED, completed_at: undefined }), bad(200)],
  ['GET 200 malformed JSON: bad_response', 'GET', 200, json({ ...PENDING, detail: PRIVATE }).slice(0, -1), bad(200)],
  ['GET 200 without not_deleted: bad_response', 'GET', 200, json({ ...PENDING, not_deleted: undefined }), bad(200)],
];

afterEach(() => {
  jest.restoreAllMocks();
});

it.each(CASES)('%s', async (_name, method, status, text, expected) => {
  // Catches: a success whose HTTP status or contents prove another state, another account or nothing; any 404 taken
  // for not_found; a lost status or code; a retry or refresh; the reply's detail, the token or another account in an
  // error message; console output.
  const logged = jest.fn();
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, level).mockImplementation(logged);
  const net = server(status, text);
  const controls = createAccountControls(createApiClient({ baseUrl: BASE, fetch: net.fetch }), OWN) as unknown as DeletionControls;
  const kinds = { deleteAccount: typeof controls.deleteAccount, deletionStatus: typeof controls.deletionStatus };
  expect(kinds).toEqual({ deleteAccount: 'function', deletionStatus: 'function' });

  let message = '';
  const call: Promise<unknown> = method === 'POST' ? controls.deleteAccount(TOKEN) : controls.deletionStatus(TOKEN);
  const outcome = await call.then(
    (value) => ({ resolves: value }),
    (error: unknown) => {
      message = error instanceof Error ? error.message : '';
      return { rejects: error instanceof ApiError ? [error.status, error.code] : error };
    }
  );
  expect(outcome).toStrictEqual(expected);
  expect(net.sent.map(({ url, init }) => [init?.method, url])).toEqual([[method, DELETION_URL]]);
  expect([PRIVATE, TOKEN, OTHER].some((secret) => message.includes(secret))).toBe(false);
  expect(logged).not.toHaveBeenCalled();
});

it('refuses an invalid, non-canonical or guest-like account ID before any request, quoting none of it', () => {
  // Catches: controls for an ID that GET /v1/me never answers, a request sent for one, or the ID echoed in its error.
  const net = server(200, json(PENDING));
  const api = createApiClient({ baseUrl: BASE, fetch: net.fetch });
  for (const id of ['', 'not-a-uuid', 'guest', `guest-${OWN}`, OWN.toUpperCase(), `{${OWN}}`]) {
    let error: unknown = null;
    try {
      createAccountControls(api, id);
    } catch (thrown) {
      error = thrown;
    }
    const message = error instanceof Error ? error.message : '';
    expect({ id, refused: error instanceof Error }).toEqual({ id, refused: true });
    expect([id, OWN].some((value) => value !== '' && message.includes(value))).toBe(false);
  }
  expect(net.sent).toHaveLength(0);
});
