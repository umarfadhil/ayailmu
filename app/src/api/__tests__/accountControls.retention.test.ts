// Retained-data disclosure in a deletion proof, RED (regression-first). The server always discloses, in not_deleted, the
// two kinds of data it does not delete, deletion_record and device_data, each with an explanation. A proof that lists
// neither, only one of them or only other kinds, or explains one with nothing but whitespace, discloses less than that
// and is bad_response; a kind added later is kept as sent, in any order. Only the client's validation is checked here,
// not the server's erasure or any screen. The real createApiClient runs over an injected fetch: nothing is contacted,
// and every value is a fixture.
import { ApiError, createAccountControls, createApiClient } from '@/api/client';

const BASE = 'http://127.0.0.1:8092';
const DELETION_URL = `${BASE}/v1/me/deletion`;
const OWN = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const DELETION = '9b2d4e61-3c8a-4f17-a5e0-2d7c6b1f8e93';
const TOKEN = 'account-deletion-fixture-token';

/** The two disclosures every proof carries, and a kind added later; the explanations are arbitrary fixtures. */
const RECORD_KEPT = { what: 'deletion_record', why: 'Fixture reason: the record of this deletion is kept for now' };
const DEVICE_KEPT = { what: 'device_data', why: 'Fixture reason: copies on other devices are out of reach' };
const LATER_KEPT = { what: 'later_kind', why: 'Fixture reason for a kind added after this client' };

/** A completed deletion of the own account, valid in every field, with `notDeleted` as its not_deleted list. */
const completed = (notDeleted: unknown[]) => ({
  deletion_id: DELETION,
  account_id: OWN,
  status: 'completed',
  requested_at: '2026-10-22T15:15:00Z',
  completed_at: '2026-10-22T15:16:00Z',
  server_data: { status: 'erased', erased_at: '2026-10-22T15:15:00Z', profiles: 1, device_links: 1, events: 2, imports: 1 },
  identity_provider: { status: 'deleted', attempts: 2, deleted_at: '2026-10-22T15:16:00Z' },
  not_deleted: notDeleted,
});

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

/** The real deletionStatus of the own account over `net`, settled without an unhandled rejection. */
function deletionStatusOver(net: ReturnType<typeof server>) {
  const controls = createAccountControls(createApiClient({ baseUrl: BASE, fetch: net.fetch }), OWN);
  return controls.deletionStatus(TOKEN).then(
    (value) => ({ resolved: value }),
    (error: unknown) => ({ rejected: error })
  );
}

const INCOMPLETE: [name: string, notDeleted: unknown[]][] = [
  ['no entries', []],
  ['only deletion_record', [RECORD_KEPT]],
  ['only device_data', [DEVICE_KEPT]],
  ['only other kinds', [LATER_KEPT, { what: 'other_kind', why: 'Fixture reason for another kind' }]],
  ['device_data explained by whitespace only', [RECORD_KEPT, { ...DEVICE_KEPT, why: ' \t\n ' }]],
  ['deletion_record with an empty explanation', [{ ...RECORD_KEPT, why: '' }, DEVICE_KEPT]],
];

it.each(INCOMPLETE)('refuses a completed proof whose not_deleted has %s as bad_response, after one GET', async (_name, notDeleted) => {
  // Catches: a proof accepted while it hides what the server keeps or explains it with nothing, or a retry.
  const net = server(200, JSON.stringify(completed(notDeleted)));
  const outcome = await deletionStatusOver(net);
  expect(outcome).toEqual({ rejected: expect.any(ApiError) });
  expect(outcome).toMatchObject({ rejected: { status: 200, code: 'bad_response' } });
  expect(net.sent.map(({ url, init }) => [init?.method, url])).toEqual([['GET', DELETION_URL]]);
});

it('returns a completed proof disclosing both kinds with reasons, and a later kind between them, unchanged after one GET', async () => {
  // Catches: a required order, a later kind refused or dropped, or any rewrite of the record.
  const record = completed([RECORD_KEPT, LATER_KEPT, DEVICE_KEPT]);
  const net = server(200, JSON.stringify(record));
  await expect(deletionStatusOver(net)).resolves.toStrictEqual({ resolved: record });
  expect(net.sent.map(({ url, init }) => [init?.method, url])).toEqual([['GET', DELETION_URL]]);
});
