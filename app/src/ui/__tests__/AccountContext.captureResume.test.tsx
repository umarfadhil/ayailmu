// Learning resumes in the account's dataset after an account data operation, RED (regression-first), three cases only.
// An export (successful or refused for its password) and a deletion refused before it quiesces each start a turn of
// their own, so the dataset callback published before them turns false; once the operation has ended, with the same
// verified owner still signed in, the same learner and nothing stored changed, useApp().datasetActive must be a fresh
// callback that is exactly true again, so the learning screens can save. The real AppProvider, AccountProvider,
// maintained SDK, Auth adapter, API client and KvStore datasets run a production build (both explicit opt-ins; Google
// sign-in, remembering and password recovery unset, so off) whose fictional hosts (example.org) are answered by the
// frozen fakes of test/fakeAccountApi.ts through test/productionNetwork.ts, never resolved or contacted. GET
// /v1/me/export alone is answered here, before the fake, with the bearer's own account's export. No deletion request is
// ever sent: the deletion is refused before anything is. Every value is a fixture; no password or token may reach the
// device, and none is printed.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
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

/** A real-format address known to the fake GoTrue only, with its own provider user and canonical account ID. */
const A: FakeUser = { email: 'learner.a@example.org', password: 'fixture-password-a', uid: 'uid-A', token: 'legacy-fixture-token-a', accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01' };
/** A synthetic password the fake GoTrue refuses for A. */
const WRONG_PASSWORD = 'fixture-password-not-a';

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
const ACCOUNT_KEY = accountNamespace(A.accountId).kvKey;
const SOON = { timeout: 5000 };

const PASSWORD_GRANT = `POST ${PRODUCTION_AUTH}/token?grant_type=password`;
const ME = `GET ${PRODUCTION_API}/v1/me`;
const EXPORT = `GET ${PRODUCTION_API}/v1/me/export`;
/** The adapter retires each sign-in that a newer one replaced through a local logout, sent whenever it gets to it. */
const LOCAL_LOGOUT = `POST ${PRODUCTION_AUTH}/logout?scope=local`;
const exceptLogouts = (requests: string[]) => requests.filter((request) => request !== LOCAL_LOGOUT);

/** The server's export of `user`'s account, pretty-printed as the server sent it. */
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
 * GET /v1/me/export, answered before the fake's fetch for the account whose fake GoTrue access token it bears; every
 * other request goes on to the fake as it came. Each export request is noted by the account it asked for and whether
 * its token came from a grant after mark().
 */
function exportApi(fake: FakeAccountApi) {
  const asked: { accountId: string | null; fresh: boolean }[] = [];
  let earlier = new Set<string>();
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== `${FAKE_API}/v1/me/export` || (init?.method ?? 'GET') !== 'GET') return fake.fetch(input, init);
    const token = ((init?.headers ?? {}) as Record<string, string>).Authorization?.replace(/^Bearer /, '') ?? '';
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}') as { sub?: unknown };
    const user = providerUserId(A) === claims.sub ? A : undefined;
    asked.push({ accountId: user?.accountId ?? null, fresh: fake.auth.issued().includes(token) && !earlier.has(token) });
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
  };
}

let device: KvBackend = memoryKv();
/** Every change to the device storage in this test, in order: a write as "key value", a removal as its key. */
let changes: string[] = [];
let account: AccountContextValue | null = null;
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

/** Captures both contexts as last committed. */
function HookProbe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
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
  const fake = fakeAccountApi([A]);
  const server = exportApi(fake);
  const net = productionNetwork(server.fetch);
  globalThis.fetch = net.fetch;
  view = await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset}>
        <HookProbe />
      </AccountProvider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  expect(app?.learner ?? null).toBeNull();
  expect(account?.enabled).toBe(true);
  return { fake, server, net, guestBytes: device.getItem(GUEST_KEY) };
}

/** Unmounts the app, then puts the fetch and the build variables back, whatever happened. */
async function restore() {
  try {
    await view?.unmount();
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of BASELINE) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** What the account layer and the app show: never a token, a password or stored data. */
const shown = () => ({
  signedIn: account?.signedIn,
  connected: account?.connected,
  label: account?.panel.account?.label ?? null,
  busy: account?.panel.busy ?? null,
  dataset: app?.dataset,
});
const learningAs = (user: FakeUser) => ({ signedIn: true, connected: true, label: user.email, busy: null, dataset: 'account' });

/** The dataset callback useApp() currently renders with. */
function currentCallback(): () => boolean {
  const fn = app?.datasetActive;
  if (typeof fn !== 'function') throw new Error('useApp().datasetActive is not provided');
  return fn;
}

/**
 * Signs A in through the panel, then creates the adult profile with both ticks, as the learner does, until learning
 * uses A's dataset with a live callback and its first sync has ended.
 */
async function learningInAccount() {
  await act(async () => {
    account?.panel.onSubmit({ mode: 'signin', email: A.email, password: A.password });
  });
  await waitFor(() => expect({ ...shown(), error: account?.panel.error ?? null }).toEqual({ signedIn: true, connected: false, label: A.email, busy: null, dataset: 'guest', error: null }), SOON);
  await act(async () => {
    account?.panel.onCreateProfile({ adult: true, agreed: true });
  });
  await waitFor(
    () => {
      expect(shown()).toEqual(learningAs(A));
      expect(account?.panel.connected?.syncStatus ?? '').toMatch(/tersambung|terkirim/i);
      expect(app?.datasetActive?.()).toBe(true);
    },
    SOON
  );
}

/** Whether a password or any token the fake GoTrue issued reached the device storage (a boolean, so none is printed). */
function storedSecret(fake: FakeAccountApi): boolean {
  const secrets = [A.password, WRONG_PASSWORD, ...fake.auth.issued()];
  return changes.some((entry) => secrets.some((secret) => entry.includes(secret)));
}

type Outcome = { result?: { accountId: string; json: string }; error?: unknown };

/** The export through useAccount().dataControls, to its outcome (a refusal is its error), with updates flushed. */
async function exportWith(password: string): Promise<Outcome> {
  const controls = account?.dataControls;
  if (!controls) throw new Error('useAccount().dataControls is not provided');
  let outcome: Outcome = {};
  await act(async () => {
    outcome = await controls.exportData(password).then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    );
  });
  return outcome;
}

/** The deletion's remove through useAccount().deletion without the confirmation, to its refusal, with updates flushed. */
async function unconfirmedRemove(password: string): Promise<unknown> {
  const deletion = account?.deletion;
  if (!deletion) throw new Error('useAccount().deletion is not provided');
  let refusal: unknown = null;
  await act(async () => {
    await deletion.remove(password, false).catch((error: unknown) => {
      refusal = error;
    });
  });
  return refusal;
}

/** The panel is no longer busy, and anything the ended operation set off has run. */
async function settled() {
  await waitFor(() => expect(account?.panel.busy ?? null).toBeNull(), SOON);
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
}

it("after a successful export, A's earlier dataset callback is fenced and learning resumes with a fresh live callback for the same owner and learner, nothing stored changed", async () => {
  try {
    const { fake, server, net, guestBytes } = await mount();
    await learningInAccount();
    const held = currentCallback();
    const learnerId = app?.learner?.learner_id;
    const accountBytes = device.getItem(ACCOUNT_KEY);
    const from = net.requests.length;
    const changed = changes.length;
    server.mark();

    const done = await exportWith(A.password);
    await settled();

    expect(done).toEqual({ result: { accountId: A.accountId, json: exportText(A) } });
    // One fresh password grant and its verification, then the export for A's own account only.
    expect(exceptLogouts(net.requests.slice(from))).toEqual([PASSWORD_GRANT, ME, EXPORT]);
    expect(server.asked).toEqual([{ accountId: A.accountId, fresh: true }]);
    // The callback published before the export stays fenced; the one learning renders with now is fresh and live.
    expect(held()).toBe(false);
    const current = currentCallback();
    expect(current).not.toBe(held);
    expect(current()).toBe(true);
    // Same verified owner and learner, still learning in A's dataset; nothing stored changed, the guest's included.
    expect(shown()).toEqual(learningAs(A));
    expect(app?.learner?.learner_id).toBe(learnerId);
    expect(device.getItem(ACCOUNT_KEY)).toBe(accountBytes);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(changes.slice(changed)).toEqual([]);
    expect(storedSecret(fake)).toBe(false);
  } finally {
    await restore();
  }
});

it("after an export refused for its password, A's earlier dataset callback is fenced and learning resumes with a fresh live callback, nothing exported or stored", async () => {
  try {
    const { fake, server, net, guestBytes } = await mount();
    await learningInAccount();
    const held = currentCallback();
    const learnerId = app?.learner?.learner_id;
    const accountBytes = device.getItem(ACCOUNT_KEY);
    const from = net.requests.length;
    const changed = changes.length;

    const refused = await exportWith(WRONG_PASSWORD);
    await settled();

    expect(refused.result).toBeUndefined();
    expect(refused.error).toBeInstanceOf(Error);
    // The refused password grant only: no verification and no export.
    expect(exceptLogouts(net.requests.slice(from))).toEqual([PASSWORD_GRANT]);
    expect(server.asked).toEqual([]);
    expect(held()).toBe(false);
    const current = currentCallback();
    expect(current).not.toBe(held);
    expect(current()).toBe(true);
    expect(shown()).toEqual(learningAs(A));
    expect(app?.learner?.learner_id).toBe(learnerId);
    expect(device.getItem(ACCOUNT_KEY)).toBe(accountBytes);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(changes.slice(changed)).toEqual([]);
    expect(storedSecret(fake)).toBe(false);
  } finally {
    await restore();
  }
});

it("after a deletion refused for want of confirmation, before it quiesces or sends anything, A's earlier dataset callback is fenced and learning resumes with a fresh live callback", async () => {
  try {
    const { fake, server, net, guestBytes } = await mount();
    await learningInAccount();
    expect(account?.deletion?.state.phase).toBe('idle');
    expect(account?.deletion?.available).toBe(true);
    const held = currentCallback();
    const learnerId = app?.learner?.learner_id;
    const accountBytes = device.getItem(ACCOUNT_KEY);
    const from = net.requests.length;
    const changed = changes.length;

    const refusal = await unconfirmedRemove(A.password);
    await settled();

    expect(refusal).toBeInstanceOf(Error);
    // Refused before anything was sent: no grant, verification, deletion request or export.
    expect(net.requests.slice(from)).toEqual([]);
    expect(server.asked).toEqual([]);
    expect(account?.deletion?.state.phase).toBe('idle');
    expect(held()).toBe(false);
    const current = currentCallback();
    expect(current).not.toBe(held);
    expect(current()).toBe(true);
    expect(shown()).toEqual(learningAs(A));
    expect(typeof account?.dataControls?.exportData).toBe('function');
    expect(app?.learner?.learner_id).toBe(learnerId);
    expect(device.getItem(ACCOUNT_KEY)).toBe(accountBytes);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(changes.slice(changed)).toEqual([]);
    expect(storedSecret(fake)).toBe(false);
  } finally {
    await restore();
  }
});
