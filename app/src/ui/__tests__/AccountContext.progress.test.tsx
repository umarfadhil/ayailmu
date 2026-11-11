// Account progress in the account layer, RED (regression-first), three cases only. The real AppProvider, AccountProvider,
// maintained SDK, Auth adapter, API client and KvStore datasets run a production build over the frozen fake of
// test/fakeAccountApi.ts, reached through the fictional hosts (example.org) of test/productionNetwork.ts, never resolved
// or contacted. Only GET .../progress is answered before the fake, and only in the first case. Neither
// useApp().answersSaved nor ConnectedProfile.progress exists yet: both are reached through local casts, so a missing API
// fails its case with a plain message, not compilation. Every value is a fixture; no password or token is stored or printed.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Store } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import type { AccountSyncProgress } from '@/sync/accountProgress';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import type { ConnectedProfile } from '@/ui/account/AccountPanel';
import { AppProvider, useApp } from '@/ui/AppContext';
import { fakeAccountApi, type FakeAccountApi, type FakeUser, type SentRequest } from '../../../test/fakeAccountApi';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

/** Real-format addresses known to the fake GoTrue only, each with its own provider user and canonical account ID. */
const A: FakeUser = { email: 'learner.a@example.org', password: 'fixture-password-a', uid: 'uid-A', token: 'legacy-fixture-token-a', accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01' };
const B: FakeUser = { email: 'learner.b@example.org', password: 'fixture-password-b', uid: 'uid-B', token: 'legacy-fixture-token-b', accountId: '9b7d5e21-0c4f-4a8e-b1d3-2f6a8c0e4b12' };

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER', 'EXPO_PUBLIC_ACCOUNT_ENV', 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL', 'EXPO_PUBLIC_AUTH_EMULATOR_URL', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL', 'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL', 'EXPO_PUBLIC_REMEMBER_DEVICE', 'EXPO_PUBLIC_PASSWORD_RECOVERY',
] as const;
/** The production build: Google sign-in, remembering and password recovery all unset, so off. */
const PRODUCTION_BUILD: Partial<Record<(typeof BUILD_KEYS)[number], string>> = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_API_BASE_URL: PRODUCTION_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: PRODUCTION_AUTH,
};
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);
const realFetch = globalThis.fetch;

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const SOON = { timeout: 5000 };
const CANONICAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The fake, except that GET /v1/profiles/{id}/progress answers as `mode` says: the fake's own reply, the model server's
 * counts (3 registered events and 2 stored but excluded ones) with the reply's own profile_id kept, or a lost connection.
 */
function progressApi(fake: FakeAccountApi) {
  const feed = {
    mode: 'fake' as 'fake' | 'model' | 'lost',
    /** Lost progress reads. */
    lost: 0,
    /** The profile_id of each modelled reply. */
    served: [] as string[],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const isProgress = (init?.method ?? 'GET') === 'GET' && /^\/v1\/profiles\/[^/]+\/progress$/.test(new URL(String(input)).pathname);
      if (!isProgress || feed.mode === 'fake') return fake.fetch(input, init);
      if (feed.mode === 'lost') {
        feed.lost += 1;
        throw new TypeError('Network request failed');
      }
      const reply = await fake.fetch(input, init);
      const body: Record<string, unknown> = { ...(JSON.parse(await reply.text()) as Record<string, unknown>), events: 3, excluded_unregistered: 2 };
      feed.served.push(String(body.profile_id));
      const text = JSON.stringify(body);
      return { ...reply, text: async () => text, json: async () => body } as unknown as Response;
    }) as typeof fetch,
  };
  return feed;
}

type App = ReturnType<typeof useApp> & { answersSaved?: () => Promise<void> };
type Connected = ConnectedProfile & { progress?: AccountSyncProgress | null };

let device: KvBackend = memoryKv();
let account: AccountContextValue | null = null;
let app: App | null = null;
let view: Awaited<ReturnType<typeof render>> | null = null;

async function openGuest() {
  const guest = new KvStore(device);
  await guest.init();
  return guest;
}

const openAccountDataset = (namespace: Namespace) => openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });

/** Captures both contexts as last committed. */
function HookProbe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue as App;
  }, [accountValue, appValue]);
  return null;
}

beforeEach(() => {
  device = memoryKv();
  account = null;
  app = null;
  view = null;
});

/** Unmounts the app, then puts the fetch and the build variables back, whatever happened. */
afterEach(async () => {
  try {
    await view?.unmount();
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of BASELINE) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

/** The app of a production build over the fixture network: ready and signed out, with A and B prepared at the fake. */
async function mount() {
  for (const key of BUILD_KEYS) {
    const value = PRODUCTION_BUILD[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const fake = fakeAccountApi([A, B]);
  const feed = progressApi(fake);
  const net = productionNetwork(feed.fetch);
  globalThis.fetch = net.fetch;
  view = await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset}>
        <HookProbe />
      </AccountProvider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  expect(account?.enabled).toBe(true);
  return { fake, feed, net };
}

function connected(): Connected {
  const shown = account?.panel.connected;
  if (!shown) throw new Error('The account panel shows no connected profile');
  return shown as Connected;
}

function progressNow(): AccountSyncProgress {
  const progress = connected().progress;
  if (!progress) throw new Error('ConnectedProfile.progress is not provided');
  return progress;
}

const serverOf = () => progressNow().server;

/** The store and learner learning currently uses (the account's, once connected). */
function learning(): { store: Store; learnerId: string } {
  const store = app?.store;
  const learnerId = app?.learner?.learner_id;
  if (!store || !learnerId) throw new Error('useApp() has no store and learner to learn with');
  return { store, learnerId };
}

function answersSaved(): () => Promise<void> {
  const notify = app?.answersSaved;
  if (typeof notify !== 'function') throw new Error('useApp().answersSaved is not provided');
  return notify;
}

/** `work` must settle in time: a hang fails here, with its name, instead of at the suite's timeout. */
function within<T>(ms: number, work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A bounded wait in which nothing is expected to happen. */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 250))));

/** One full v1 answer record of fixture content: no four-choice fields, no curriculum claim. `id` is its answer_id. */
const fixtureAnswer = (learnerId: string, id: string): AnswerRecord => ({
  answer_id: id, learner_id: learnerId, item_id: 'FIXTURE-ITEM-1',
  content_version: 'fixture-content-0', rules_version: 'fixture-rules-0', app_version: '0.0.0-fixture',
  timestamp: '2026-10-28T02:00:00.000Z', local_date: '2026-10-28', session_id: 'fixture-session-1',
  pool: 'PRACT', unit: 'A', skills: ['fixture-skill'],
  raw_response: '{"kind":"choice","option_id":"a"}', auto_score: { main: 'correct' }, outcome: 'correct',
  error_tags: [], serious_tag: null, hint_used: false, help_lines_shown: [],
  first_attempt: true, fresh_evidence: true, time_on_item_ms: 1200,
  audio_status: null, report_flag: false, review_status: 'draft', synthetic: true,
});

/** Writes a valid-looking answer to the learning store, then tells the provider through useApp().answersSaved. */
async function saveAnswer(id: string) {
  const { store, learnerId } = learning();
  await store.recordAnswer(fixtureAnswer(learnerId, id), null);
  const notify = answersSaved();
  await act(async () => {
    await within(5000, notify(), 'answersSaved');
  });
}

/** Signs `user` in through the panel, then creates the adult profile with both ticks, until learning uses its dataset and its first sync has ended. */
async function learningIn(user: FakeUser) {
  await act(async () => {
    account?.panel.onSubmit({ mode: 'signin', email: user.email, password: user.password });
  });
  await waitFor(() => expect([account?.panel.account?.label, account?.panel.busy ?? null, account?.panel.error ?? null]).toEqual([user.email, null, null]), SOON);
  await act(async () => {
    account?.panel.onCreateProfile({ adult: true, agreed: true });
  });
  await waitFor(() => {
    expect([account?.connected, account?.panel.busy ?? null, app?.datasetActive?.()]).toEqual([true, null, true]);
    expect(account?.panel.connected?.syncStatus ?? '').toMatch(/tersambung|terkirim/i);
  }, SOON);
}

async function syncNow() {
  await act(async () => {
    account?.panel.onSyncNow();
  });
  await waitFor(() => expect(account?.panel.busy ?? null).toBeNull(), SOON);
}

/** The fake's event uploads (POST /v1/profiles/{id}/events) so far, and the event IDs one of them carried. */
const eventPosts = (fake: FakeAccountApi) => fake.sent.filter((r) => r.method === 'POST' && /^\/v1\/profiles\/[^/]+\/events$/.test(r.path));
const sentIds = (post: SentRequest) => (JSON.parse(post.body) as { events: { event_id: string }[] }).events.map((e) => e.event_id);
const storedIds = async (store: Store) => (await store.listAnswers()).map((a) => a.answer_id);

describe('AccountProvider progress', () => {
  it('shows the server total as verified, keeps it stale when a read is lost, and never lends it to another account', async () => {
    const { fake, feed } = await mount();
    feed.mode = 'model';
    await learningIn(A);
    const profileId = fake.profileOf(A.accountId)?.profileId ?? '';
    await waitFor(() => expect(serverOf()).toEqual({ state: 'verified', total: 5, excluded: 2, checkedAt: expect.stringMatching(CANONICAL_TIME) }), SOON);

    await syncNow();
    expect(serverOf()).toMatchObject({ state: 'verified', total: 5, excluded: 2 });
    expect([...new Set(feed.served)]).toEqual([profileId]);
    const lastRead = serverOf().checkedAt;

    feed.mode = 'lost';
    await syncNow();
    expect(feed.lost).toBeGreaterThan(0);
    expect(serverOf()).toEqual({ state: 'stale', total: 5, excluded: 2, checkedAt: lastRead });

    // Signing out clears what was shown; B has not read the server once, so it knows nothing: never A's 5, stale or not.
    await act(async () => {
      account?.panel.onSignOut();
    });
    await waitFor(() => expect(account?.panel.connected ?? null).toBeNull(), SOON);
    const lostBefore = feed.lost;
    await learningIn(B);
    expect(feed.lost).toBeGreaterThan(lostBefore);
    expect(serverOf()).toMatchObject({ state: 'unknown', total: null });
  });

  it('queues a saved answer without any request, and keeps a blocked one stored but never sent nor counted as sent', async () => {
    const { fake, net } = await mount();
    await learningIn(A);
    const { store } = learning();
    const mark = net.requests.length;

    await saveAnswer('ans-valid-1');
    await waitFor(() => expect(progressNow()).toMatchObject({ queued: 1, blocked: 0 }), SOON);
    await settle();
    expect(net.requests.slice(mark)).toEqual([]);

    // The store takes any string as an answer_id; the journal's event ID refuses a space, so it is kept, blocked.
    await saveAnswer('bad id');
    await waitFor(() => expect(progressNow()).toMatchObject({ queued: 1, blocked: 1, deviceAccepted: 0 }), SOON);
    expect(await storedIds(store)).toEqual(['ans-valid-1', 'bad id']);
    expect(net.requests.slice(mark)).toEqual([]);

    await syncNow();
    expect(eventPosts(fake).map(sentIds)).toEqual([['ans-valid-1']]);
    expect(progressNow()).toMatchObject({ queued: 0, blocked: 1, deviceAccepted: 1 });
    expect(connected().syncStatus).not.toMatch(/Semua jawaban terkirim/);
  });

  it('uploads only the answer queued when the sync took its batch; one saved while it is held waits for the next sync', async () => {
    const { fake } = await mount();
    await learningIn(A);
    const profileId = fake.profileOf(A.accountId)?.profileId ?? '';
    await saveAnswer('ans-1');
    await waitFor(() => expect(progressNow()).toMatchObject({ queued: 1 }), SOON);

    const gate = fake.hold('events');
    await act(async () => {
      account?.panel.onSyncNow();
    });
    await waitFor(() => expect(eventPosts(fake)).toHaveLength(1), SOON);
    expect(sentIds(eventPosts(fake)[0])).toEqual(['ans-1']);

    await saveAnswer('ans-2');
    gate.release();
    await waitFor(() => expect(account?.panel.busy ?? null).toBeNull(), SOON);
    await settle();
    expect(eventPosts(fake).map(sentIds)).toEqual([['ans-1']]);
    expect(progressNow()).toMatchObject({ queued: 1, blocked: 0, deviceAccepted: 1 });

    await syncNow();
    expect(eventPosts(fake).map(sentIds)).toEqual([['ans-1'], ['ans-2']]);
    expect(eventPosts(fake).map((r) => r.path)).toEqual([`/v1/profiles/${profileId}/events`, `/v1/profiles/${profileId}/events`]);
    expect(progressNow()).toMatchObject({ queued: 0, blocked: 0, deviceAccepted: 2, server: { state: 'verified', total: 2 } });
  });
});
