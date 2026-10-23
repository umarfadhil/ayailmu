import { discoverOwnAccountDeletion, createApiClient } from '@/api/client';

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


it('discovers the canonical account only from one authenticated own-deletion proof',async()=>{ const net=server([[200,PENDING]]); const api=createApiClient({baseUrl:BASE,fetch:net.fetch}); await expect(discoverOwnAccountDeletion(api,TOKEN)).resolves.toEqual(PENDING); expect(net.sent.map(x=>[x.init?.method,x.url])).toEqual([['GET',DELETION_URL]]); expect((net.sent[0].init?.headers as Record<string,string>).Authorization).toBe(`Bearer ${TOKEN}`); });
it('accepts completed discovery but never manufactures completion from404',async()=>{ const net=server([[200,COMPLETED],[404,{code:'not_found'}]]); const api=createApiClient({baseUrl:BASE,fetch:net.fetch}); await expect(discoverOwnAccountDeletion(api,TOKEN)).resolves.toEqual(COMPLETED); await expect(discoverOwnAccountDeletion(api,TOKEN)).resolves.toBeNull(); });
it.each([{...PENDING,account_id:'bad-id'},{...PENDING,identity_provider:{status:'deleted',attempts:1}},{status:'completed',account_id:OWN}])('rejects malformed discovery before any own namespace can be opened %#',async body=>{ const net=server([[200,body]]); await expect(discoverOwnAccountDeletion(createApiClient({baseUrl:BASE,fetch:net.fetch}),TOKEN)).rejects.toMatchObject({code:'bad_response'}); });
