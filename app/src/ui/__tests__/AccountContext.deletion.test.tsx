// Real provider/maintained SDK deletion integration over disposable in-memory endpoints. No live identities.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { FAKE_API, fakeAccountApi, providerUserId, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

/** The proposed capability, typed here before AccountContext declares it. */
type ProposedAccount = AccountContextValue & { deletion?: { state: import('@/account/accountDeletion').AccountDeletionState; available: boolean; remove(password: string, confirmed: boolean): Promise<void>; check(): Promise<void>; retryIdentity(password: string, confirmed: boolean): Promise<void>; retryCleanup(): Promise<void> } };

/** Two real-format addresses known to the fake GoTrue only, each with its own provider user and canonical account ID. */
const A: FakeUser = { email: 'learner.a@example.org', password: 'fixture-password-a', uid: 'uid-A', token: 'legacy-fixture-token-a', accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01' };
const B: FakeUser = { email: 'learner.b@example.org', password: 'fixture-password-b', uid: 'uid-B', token: 'legacy-fixture-token-b', accountId: '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687' };

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL',
  'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL',
  'EXPO_PUBLIC_REMEMBER_DEVICE',
  'EXPO_PUBLIC_PASSWORD_RECOVERY',
] as const;
/** The production build: Google sign-in, remembering and password recovery all unset, so off. */
const PRODUCTION_BUILD: Partial<Record<(typeof BUILD_KEYS)[number], string>> = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_API_BASE_URL: PRODUCTION_API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: PRODUCTION_AUTH,
};
/** The process's own values, put back after every test. */
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);
const realFetch = globalThis.fetch;

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const GUEST_KEY = GUEST_NAMESPACE.kvKey;
const SOON = { timeout: 5000 };

const ME = `GET ${PRODUCTION_API}/v1/me`;

function deletionApi(fake: FakeAccountApi) {
 const deleted = new Set<string>(); const asked: { method: string; accountId: string }[] = [];
 let lost = false; let finish = false; let held: Promise<void> | null = null;
 const proof = (user: FakeUser, complete = false) => ({ deletion_id: 'f0c9a527-a1e4-4559-92e6-b8f1e2a4c010', account_id: user.accountId, requested_at: '2026-10-23T02:00:00Z', server_data: { status: 'erased', erased_at: '2026-10-23T02:00:00Z', profiles: 0, device_links: 0, events: 0, imports: 0 }, not_deleted: [{ what: 'deletion_record', why: 'Retained deletion record' }, { what: 'device_data', why: 'Other device copies' }], ...(complete ? { status: 'completed', completed_at: '2026-10-23T02:01:00Z', identity_provider: { status: 'deleted', deleted_at: '2026-10-23T02:01:00Z', attempts: 2 } } : { status: 'identity_deletion_pending', identity_provider: { status: 'pending', attempts: 1 } }) });
 const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input); const method = init?.method ?? 'GET';
  if (!url.startsWith(FAKE_API)) return fake.fetch(input, init);
  const token = ((init?.headers ?? {}) as Record<string,string>).Authorization?.replace(/^Bearer /,'') ?? '';
  const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}') as { sub?: unknown };
  const user = [A,B].find(u => providerUserId(u) === claims.sub);
  const response = (status: number, body: unknown) => ({ ok: status < 300, status, url, redirected: false, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  if (user && url.endsWith('/v1/me') && deleted.has(user.accountId)) return response(410, { code: 'account_deleted' });
  if (!url.endsWith('/v1/me/deletion')) return fake.fetch(input,init);
  if (!user) return response(401, { code: 'unauthenticated' });
  asked.push({ method, accountId: user.accountId });
  if (method === 'POST') { deleted.add(user.accountId); const gate = held; held = null; if (gate) await gate; if (lost) { lost = false; throw new TypeError('fixture lost reply'); } return response(finish ? 200 : 202, proof(user,finish)); }
  return deleted.has(user.accountId) ? response(200,proof(user,finish)) : response(404,{code:'not_found'});
 };
 return { fetch: fetch as unknown as typeof globalThis.fetch, asked, lose: () => { lost = true; }, finish: () => { finish = true; }, hold: () => { let release!: () => void; held = new Promise<void>(done => { release = done; }); return { release }; } };
}

let device: KvBackend = memoryKv();
/** Every change to the device storage in this test, in order: a write as "key value", a removal as its key. */
let changes: string[] = [];
let account: ProposedAccount | null = null;
let app: ReturnType<typeof useApp> | null = null;
let view: Awaited<ReturnType<typeof render>> | null = null;

function recordingDevice(): KvBackend {
  const kv = memoryKv();
  return {
    getItem: (key) => kv.getItem(key),
    setItem: (key, value) => {
      changes.push(`${key} ${value}`);
      kv.setItem(key, value);
    },
    removeItem: (key) => {
      changes.push(key);
      kv.removeItem(key);
    },
  };
}

async function openGuest() {
  const guest = new KvStore(device);
  await guest.init();
  return guest;
}

function openAccountDataset(namespace: Namespace) {
  return openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });
}

function Probe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue as ProposedAccount;
    app = appValue;
  }, [accountValue, appValue]);
  return null;
}

beforeEach(() => {
  device = recordingDevice();
  // Fresh KvStore.init is read-only. Seed existing own copies so the erasure/unknown assertions exercise real bytes.
  for (const user of [A, B]) device.setItem(accountNamespace(user.accountId).kvKey, JSON.stringify({ schema: 2, meta: { pending_notice: 'fixture-own-data' }, learner: null, answers: [], snapshot: null, reports: [] }));
  changes = [];
  account = null;
  app = null;
  view = null;
});

/** The app of a production build over the fixture network: ready, signed out, with an empty guest (no learner). */
async function mount() {
  for (const key of BUILD_KEYS) {
    const value = PRODUCTION_BUILD[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const fake = fakeAccountApi([A, B]);
  const server = deletionApi(fake);
  const net = productionNetwork(server.fetch);
  globalThis.fetch = net.fetch;
  view = await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset}>
        <Probe />
      </AccountProvider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  expect(app?.learner ?? null).toBeNull();
  expect(account?.enabled).toBe(true);
  expect(net.requests).toEqual([]);
  return { fake, server, net, guestBytes: device.getItem(GUEST_KEY) };
}

/** Unmounts the app, then puts the fetch and the build variables back, whatever happened. */
function restore() {
  view?.unmount();
  globalThis.fetch = realFetch;
  for (const [key, value] of BASELINE) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** What the account layer and the app show of the sign-in: never a token, a password or stored data. */
const shown = () => ({
  signedIn: account?.signedIn,
  connected: account?.connected,
  label: account?.panel.account?.label ?? null,
  busy: account?.panel.busy ?? null,
  error: account?.panel.error ?? null,
  dataset: app?.dataset,
});
const signedInAs = (user: FakeUser) => ({ signedIn: true, connected: false, label: user.email, busy: null, error: null, dataset: 'guest' });

/** Signs `user` in through the account panel, as the learner does, until the verified account is shown. */
async function signIn(user: FakeUser) {
  await act(async () => {
    account?.panel.onSubmit({ mode: 'signin', email: user.email, password: user.password });
  });
  await waitFor(() => expect(shown()).toEqual(signedInAs(user)), SOON);
}

/** Whether a password or any token the fake GoTrue issued reached the device storage (a boolean, so none is printed). */
function storedSecret(fake: FakeAccountApi): boolean {
  const secrets = [A.password, B.password, ...fake.auth.issued()];
  return changes.some((entry) => secrets.some((secret) => entry.includes(secret)));
}


it('wires initial deletion, blocks ordinary mutations, erases own local data, and reconciles pending/completed without /me', async () => {
 try { const {fake,server,net,guestBytes} = await mount(); await signIn(A); expect(account?.deletion).toBeDefined(); const controls = account!.deletion!;
  expect(device.getItem(accountNamespace(A.accountId).kvKey)).not.toBeNull();
  await act(async () => controls.remove(A.password,true));
  expect(account?.deletion?.state).toMatchObject({phase:'pending',local:'erased',busy:false}); expect(app?.dataset).toBe('guest'); expect(app?.learner).toBeNull(); expect(account?.dataControls).toBeUndefined();
  expect(device.getItem(accountNamespace(A.accountId).kvKey)).toBeNull(); expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
  const before = net.requests.length; await act(async () => { account?.panel.onCreateProfile({adult:true,agreed:true}); account?.panel.onSyncNow(); account?.panel.onGuestCopy(); }); expect(net.requests).toHaveLength(before);
  await act(async () => account?.deletion?.check()); expect(server.asked.filter(x=>x.method==='POST')).toHaveLength(1);
  server.finish(); await act(async () => account?.deletion?.retryIdentity(A.password,true)); expect(account?.deletion?.state).toMatchObject({phase:'completed',local:'erased'});
  expect(net.requests.filter(r=>r===ME)).toHaveLength(2); expect(server.asked.filter(x=>x.method==='POST')).toHaveLength(1); // GET already proved completed: no retry POST needed.
  expect(storedSecret(fake)).toBe(false); expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
 } finally { restore(); }
});
it('keeps lost deletion unknown with local data until direct status proves erasure', async () => {
 try { const {server,net,guestBytes} = await mount(); await signIn(A); expect(account?.deletion).toBeDefined(); server.lose(); await act(async () => account?.deletion?.remove(A.password,true));
  expect(account?.deletion?.state).toMatchObject({phase:'unknown',local:'kept'}); expect(device.getItem(accountNamespace(A.accountId).kvKey)).not.toBeNull();
  await act(async () => account?.deletion?.check()); expect(account?.deletion?.state).toMatchObject({phase:'pending',local:'erased'}); expect(net.requests.filter(r=>r===ME)).toHaveLength(2); expect(server.asked.filter(x=>x.method==='POST')).toHaveLength(1); expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
 } finally { restore(); }
});
it('drops a late A deletion proof after B signs in without erasing B, its session or guest data', async () => {
 try { const {server,fake,guestBytes} = await mount(); await signIn(A); expect(account?.deletion).toBeDefined(); const gate = server.hold(); let late: Promise<unknown> = Promise.resolve();
  await act(async () => { late = account!.deletion!.remove(A.password,true).catch(e=>e); }); await waitFor(()=>expect(server.asked).toHaveLength(1));
  await signIn(B); const bytes = device.getItem(accountNamespace(B.accountId).kvKey); const changed = changes.length;
  gate.release(); await act(async () => { await late; }); expect(shown()).toEqual(signedInAs(B)); expect(account?.deletion?.state.phase).toBe('idle'); expect(changes).toHaveLength(changed); expect(device.getItem(accountNamespace(B.accountId).kvKey)).toBe(bytes); expect(device.getItem(GUEST_KEY)).toBe(guestBytes); expect(fake.auth.liveSessions(B.email)).toBe(1);
 } finally { restore(); }
});
it('keeps the last proven deletion visible after sign-out but does not authorize another request', async () => {
 try { const {server} = await mount(); await signIn(A); expect(account?.deletion).toBeDefined(); await act(async () => account?.deletion?.remove(A.password,true)); await act(async () => account?.panel.onSignOut());
  expect(account?.deletion?.state).toMatchObject({phase:'pending',local:'erased'}); expect(account?.deletion?.available).toBe(false); const n = server.asked.length; await expect(account?.deletion?.check()).rejects.toThrow(); expect(server.asked).toHaveLength(n);
 } finally { restore(); }
});
