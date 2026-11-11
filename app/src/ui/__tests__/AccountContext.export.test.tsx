// Exporting the signed-in account's server data through the app's account layer, RED (regression-first), three cases
// only. The proposed capability, useAccount().dataControls.exportData(password), is typed here as an optional field and
// asserted to exist before each use, so its absence fails as such. The real AppProvider, AccountProvider, maintained
// SDK, Auth adapter, API client and KvStore datasets run a production build (both explicit opt-ins; Google sign-in,
// remembering and password recovery unset, so off) whose fictional hosts (example.org) are answered by the frozen fakes
// of test/fakeAccountApi.ts through test/productionNetwork.ts, never resolved or contacted. That fake API has no export
// route, so GET /v1/me/export alone is answered here, before it: the bearer's own account's export as pretty-printed
// text, which a test may hold behind a gate that never listens to the request's abort signal, so that a late reply still
// arrives on the wire. The export is the server's copy only; the guest data stays on the device, untouched. Deletion,
// its reconciliation and screens are not covered. Every value is a fixture; no password or token may reach the device.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_GOTRUE_ISSUER, fakeAccountApi, providerUserId, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

type ExportResult = { accountId: string; json: string };
/** The proposed capability, typed here before AccountContext declares it. */
type ProposedAccount = AccountContextValue & { dataControls?: { exportData(password: string): Promise<ExportResult> } };

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

const PASSWORD_GRANT = `POST ${PRODUCTION_AUTH}/token?grant_type=password`;
const ME = `GET ${PRODUCTION_API}/v1/me`;
const EXPORT = `GET ${PRODUCTION_API}/v1/me/export`;
/** The adapter retires each sign-in that a newer one replaced through a local logout, sent whenever it gets to it. */
const LOCAL_LOGOUT = `POST ${PRODUCTION_AUTH}/logout?scope=local`;
const exceptLogouts = (requests: string[]) => requests.filter((request) => request !== LOCAL_LOGOUT);
const logouts = (requests: string[]) => requests.filter((request) => request === LOCAL_LOGOUT).length;

/** The server's export of `user`'s account, pretty-printed as the server sent it: any re-serialization changes its bytes. */
const exportText = (user: FakeUser) =>
  JSON.stringify(
    {
      format: 'ayailmu-server-export-1',
      generated_at: '2026-10-23T02:00:00Z',
      contents: {
        included: 'The account and its profiles as the server keeps them',
        not_included: [{ what: 'device_data', why: 'Guest and unsent records stay on devices' }],
      },
      account: { account_id: user.accountId, created_at: '2026-10-18T00:00:00Z', issuer: FAKE_GOTRUE_ISSUER, subject: providerUserId(user), auth_mode: 'standalone-gotrue' },
      profiles: [],
    },
    null,
    2
  );

/**
 * GET /v1/me/export, answered before the fake's fetch for the account whose fake GoTrue access token it bears (read from
 * that fixture token's own claims); every other request goes on to the fake as it came. Each export request is noted by
 * the account it asked for and whether its token came from a grant after mark(). hold() keeps the next export reply
 * until released, never listening to the request's abort signal.
 */
function exportApi(fake: FakeAccountApi) {
  const asked: { accountId: string | null; fresh: boolean }[] = [];
  let earlier = new Set<string>();
  let gate: Promise<void> | null = null;
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== `${FAKE_API}/v1/me/export` || (init?.method ?? 'GET') !== 'GET') return fake.fetch(input, init);
    const token = ((init?.headers ?? {}) as Record<string, string>).Authorization?.replace(/^Bearer /, '') ?? '';
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}') as { sub?: unknown };
    const user = [A, B].find((u) => providerUserId(u) === claims.sub);
    asked.push({ accountId: user?.accountId ?? null, fresh: fake.auth.issued().includes(token) && !earlier.has(token) });
    const held = gate;
    gate = null;
    if (held) await held;
    const status = user ? 200 : 401;
    const text = user ? exportText(user) : JSON.stringify({ code: 'unauthenticated' });
    return { ok: status === 200, status, url, redirected: false, headers: { get: () => null }, text: async () => text };
  };
  return {
    fetch: answer as unknown as typeof globalThis.fetch,
    asked,
    /** Tokens issued from now on count as fresh. */
    mark() {
      earlier = new Set(fake.auth.issued());
    },
    hold() {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => (release = resolve));
      return { release: () => release() };
    },
  };
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
  const server = exportApi(fake);
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

type Outcome = { result?: ExportResult; error?: unknown };
/** An export under way: its outcome never rejects (a refusal is its error), and is noted once settled. */
interface Started {
  outcome: Promise<Outcome>;
  settled?: Outcome;
}

/** Starts the proposed export, asserted to exist first; its outcome is handled at once, so a refusal is never unhandled. */
async function startExport(password: string): Promise<Started> {
  const controls = account?.dataControls;
  expect(typeof controls?.exportData).toBe('function');
  if (!controls) throw new Error('useAccount().dataControls is not provided yet');
  const started: Started = { outcome: Promise.resolve({}) };
  await act(async () => {
    started.outcome = new Promise<ExportResult>((resolve) => resolve(controls.exportData(password))).then(
      (result) => (started.settled = { result }),
      (error: unknown) => (started.settled = { error })
    );
  });
  return started;
}

/** The export's outcome once it has settled, with the provider's updates flushed. */
async function outcomeOf(started: Started): Promise<Outcome> {
  await act(async () => {
    await started.outcome;
  });
  return started.outcome;
}

/** Lets anything a late reply could still set off run before what it might have changed is compared. */
const settleLate = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

it("exports account A's server data as the server's exact text after one new password grant and one verification, touching neither the guest data nor the device storage", async () => {
  try {
    const { fake, server, net, guestBytes } = await mount();
    await signIn(A);
    expect(net.requests).toEqual([PASSWORD_GRANT, ME]);
    server.mark();

    const done = await outcomeOf(await startExport(A.password));
    // The server's own text, spacing included, for the own account: never re-serialized, never the device's data.
    expect(done).toEqual({ result: { accountId: A.accountId, json: exportText(A) } });
    // One new password grant and its verification, then one export bearing that new sign-in's token: no refresh,
    // sign-up, profile request or copy. The adapter retires the first sign-in, which the new one replaced.
    expect(exceptLogouts(net.requests)).toEqual([PASSWORD_GRANT, ME, PASSWORD_GRANT, ME, EXPORT]);
    expect(server.asked).toEqual([{ accountId: A.accountId, fresh: true }]);
    await waitFor(() => expect(logouts(net.requests)).toBe(1));
    // Account A is still shown, nothing is busy, and learning stays with the empty guest's untouched data.
    await waitFor(() => expect(shown()).toEqual(signedInAs(A)));
    expect(app?.learner ?? null).toBeNull();
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(fake.profiles).toHaveLength(0);
    expect(storedSecret(fake)).toBe(false);
  } finally {
    restore();
  }
});

it("drops A's held export once B has signed in through the panel: its late reply changes nothing of B's sign-in, session or storage", async () => {
  try {
    const { fake, server, net, guestBytes } = await mount();
    await signIn(A);
    server.mark();
    const reply = server.hold();
    const late = await startExport(A.password);
    // Held at the server's reply, after the new password grant and its verification.
    await waitFor(() => expect(server.asked).toEqual([{ accountId: A.accountId, fresh: true }]), SOON);

    await signIn(B);
    // Both of A's sign-ins are retired by the adapter (each replaced by a newer one); then B's state is noted.
    await waitFor(() => expect(logouts(net.requests)).toBe(2));
    expect(exceptLogouts(net.requests)).toEqual([PASSWORD_GRANT, ME, PASSWORD_GRANT, ME, EXPORT, PASSWORD_GRANT, ME]);
    const requests = [...net.requests];
    const changed = changes.length;

    // A's reply arrives late, on the wire.
    reply.release();
    const outcome = await outcomeOf(late);
    await settleLate();
    expect(outcome.result).toBeUndefined();
    expect(outcome.error).toBeInstanceOf(Error);
    // Nothing further was sent (no sign-out, revocation, refresh or retry), and B stays signed in as it was.
    expect(net.requests).toEqual(requests);
    expect(fake.auth.liveSessions(B.email)).toBe(1);
    expect(shown()).toEqual(signedInAs(B));
    // Nothing was written or removed for the late reply: B's dataset and the guest's are as they were.
    expect(changes.length).toBe(changed);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(fake.profiles).toHaveLength(0);
    expect(storedSecret(fake)).toBe(false);
  } finally {
    restore();
  }
});

it('refuses a second export while the first is on its way, sending nothing for it, and the first still completes', async () => {
  try {
    const { fake, server, net, guestBytes } = await mount();
    await signIn(A);
    server.mark();
    const reply = server.hold();
    const first = await startExport(A.password);
    await waitFor(() => expect(server.asked).toHaveLength(1), SOON);
    const sent = [PASSWORD_GRANT, ME, PASSWORD_GRANT, ME, EXPORT];

    // Refused at once, while the first is held: no password grant, verification or export of its own.
    const second = await startExport(A.password);
    await waitFor(() => expect(second.settled).toBeDefined());
    expect(second.settled?.result).toBeUndefined();
    expect(second.settled?.error).toBeInstanceOf(Error);
    expect(first.settled).toBeUndefined();
    expect(exceptLogouts(net.requests)).toEqual(sent);

    // Not superseded: released, the first completes with the server's exact text.
    reply.release();
    expect(await outcomeOf(first)).toEqual({ result: { accountId: A.accountId, json: exportText(A) } });
    expect(exceptLogouts(net.requests)).toEqual(sent);
    expect(server.asked).toEqual([{ accountId: A.accountId, fresh: true }]);
    await waitFor(() => expect(logouts(net.requests)).toBe(1));
    await waitFor(() => expect(shown()).toEqual(signedInAs(A)));
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(fake.profiles).toHaveLength(0);
    expect(storedSecret(fake)).toBe(false);
  } finally {
    restore();
  }
});
