// A held Unit A capture in the account layer, RED (regression-first), two cases only. A first choice whose intent and feedback
// are saved but whose row append failed (a held capture) must show in the account's own progress as capturePending, with no
// claim that everything was sent, until a load of the screen records the row. The actual UnitAPilotScreen tells the account
// only after a fully saved capture, so Home and the account can keep an earlier "all sent" and capturePending false.
// The real AppProvider, AccountProvider, maintained SDK, Auth adapter, API client and KvStore datasets run a fictional
// reviewed tester build (explicit private beta staging profile) over the frozen fake of test/fakeAccountApi.ts, reached
// through the fictional hosts (example.org) of test/productionNetwork.ts, here used as the staging roots, never resolved or
// contacted. The screen is hosted with the route's own props (app/unit-a-pilot.tsx) minus the router. ONE answer-growing
// write of the account's main blob fails, once; the intent's own save succeeds, and no controller or storage behavior is
// replaced. MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF: only the compiled UNIT_A_STARTER_REVIEW is swapped, pending in
// its file and a FICTIONAL approval here; no real content approval, service, email or credential is claimed. Every value is
// a fixture; no password or token is stored or printed.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { accountNamespace, openKvDataset, type Namespace } from '@/account/datasets';
import { loadPrivateBetaConfig } from '@/config/privateBeta';
import { localDate } from '@/engine/util';
import { PILOT_META_KEY } from '@/pilot/unitA/capture';
import { PILOT_CONTENT } from '@/pilot/unitA/content';
import { starterBeta } from '@/pilot/unitA/StarterHome';
import { UnitAPilotScreen } from '@/pilot/unitA/UnitAPilotScreen';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import type { AccountSyncProgress } from '@/sync/accountProgress';
import { sha256Hex } from '@/sync/sha256';
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

// Only the compiled review is swapped (pending by default, a fictional approval in the cases); the real checks run.
let mockStarterReview: unknown;
jest.mock('@/pilot/unitA/review', () => {
  const actual = jest.requireActual('@/pilot/unitA/review');
  return {
    ...actual,
    get UNIT_A_STARTER_REVIEW() {
      return mockStarterReview;
    },
    starterReviewAccess: (review: unknown = mockStarterReview, content?: unknown) => actual.starterReviewAccess(review, content),
  };
});
const actualReview = jest.requireActual('@/pilot/unitA/review') as typeof import('@/pilot/unitA/review');

jest.setTimeout(30_000);

/** A real-format address known to the fake GoTrue only, with its own provider user and canonical account ID. */
const A: FakeUser = { email: 'learner.a@ayailmu.test', password: 'fixture-password-a', uid: 'uid-A', token: 'legacy-fixture-token-a', accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01' };
const ACCOUNT_KEY = accountNamespace(A.accountId).kvKey;

const BUILD_KEYS = [
  'EXPO_PUBLIC_PRIVATE_BETA', 'EXPO_PUBLIC_APP_MODE', 'EXPO_PUBLIC_PRIVATE_QA', 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_AUTH_PROVIDER', 'EXPO_PUBLIC_ACCOUNT_ENV', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL', 'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL', 'EXPO_PUBLIC_REMEMBER_DEVICE', 'EXPO_PUBLIC_PASSWORD_RECOVERY',
] as const;
/** The explicit private beta profile; every other build variable stays unset, so off. */
const BETA_BUILD: Partial<Record<(typeof BUILD_KEYS)[number], string>> = {
  EXPO_PUBLIC_PRIVATE_BETA: 'on', EXPO_PUBLIC_APP_MODE: 'tester', EXPO_PUBLIC_PRIVATE_QA: 'off', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  EXPO_PUBLIC_API_BASE_URL: PRODUCTION_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: PRODUCTION_AUTH,
};
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);
const realFetch = globalThis.fetch;

/** FICTIONAL approval of the exact draft content, for this fixture build only; not a real review. */
const fictionalApproval = () => ({
  status: 'approved-for-trial',
  contentVersion: PILOT_CONTENT.contentVersion,
  contentSha256: sha256Hex(JSON.stringify(PILOT_CONTENT)),
  reviews: {
    arabic: { reviewer: 'Fictional Arabic Reviewer', reviewedAt: '2026-10-20T09:00:00.000Z' },
    indonesian: { reviewer: 'Fictional Indonesian Reviewer', reviewedAt: '2026-10-21T09:00:00.000Z' },
    assessment: { reviewer: 'Fictional Assessment Reviewer', reviewedAt: '2026-10-22T09:00:00.000Z' },
  },
});

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const SOON = { timeout: 5000 };
const ALL_SENT = /Semua jawaban terkirim/;
/** The wording of a held capture, which the screen and the account share. */
const HELD_NOTE = /Pencatatan akun akan dicoba lagi/;

const answerCount = (text: string | null): number => (text ? (JSON.parse(text).answers as unknown[]).length : 0);
/** A memory device whose next answer-growing write of A's account blob (never the intent's metadata write) throws, once. */
function flakyDevice() {
  const kv = memoryKv();
  const fail = { armed: 0, thrown: 0 };
  const backend: KvBackend = {
    getItem: (key) => kv.getItem(key),
    removeItem: (key) => kv.removeItem(key),
    setItem: (key, value) => {
      if (fail.armed > 0 && key === ACCOUNT_KEY && answerCount(value) > answerCount(kv.getItem(key))) {
        fail.armed -= 1;
        fail.thrown += 1;
        throw new Error('simulated quota failure');
      }
      kv.setItem(key, value);
    },
  };
  return { backend, fail };
}

let flaky = flakyDevice();
let device: KvBackend = flaky.backend;
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let view: Awaited<ReturnType<typeof render>> | null = null;
/** Mounts the hosted screen, or mounts a fresh one (a new key; the providers stay as they are). */
const pilotScreen = { show: (): void => undefined };

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
    app = appValue;
  }, [accountValue, appValue]);
  return null;
}

/** The route's own wiring of the screen (app/unit-a-pilot.tsx), without the router; `visit` keys the screen alone. */
function PilotHost() {
  const { store, learner, dataset, rules, readOnly, datasetActive, answersSaved } = useApp();
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    pilotScreen.show = () => setVisit((n) => n + 1);
    return () => {
      pilotScreen.show = () => undefined;
    };
  }, []);
  const today = useCallback(() => localDate(Date.now()), []);
  const capture = dataset === 'account' && starterBeta(rules.mode) === 'reviewed';
  if (visit === 0 || !learner || !store) return null;
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <UnitAPilotScreen
        key={visit}
        store={store}
        owner={`${dataset}:${learner.learner_id}`}
        mode={rules.mode}
        readOnly={readOnly}
        arabicScale={learner.arabic_scale}
        today={today}
        active={capture ? (datasetActive ?? (() => false)) : undefined}
        captureLearnerId={capture ? learner.learner_id : undefined}
        onAnswersSaved={capture ? answersSaved : undefined}
      />
    </SafeAreaProvider>
  );
}

beforeAll(() => {
  // Preconditions on the real gates: the fixture roots are staging roots, the compiled review stays pending, only the fixture approves.
  expect(loadPrivateBetaConfig(BETA_BUILD)).toMatchObject({ enabled: true });
  expect(actualReview.UNIT_A_STARTER_REVIEW).toEqual({ status: 'pending' });
  expect(actualReview.starterReviewAccess(fictionalApproval())).toEqual({ allowed: true });
});

beforeEach(() => {
  flaky = flakyDevice();
  device = flaky.backend;
  account = null;
  app = null;
  view = null;
  pilotScreen.show = () => undefined;
});

/** Unmounts the app, then puts the fetch, the review and the build variables back, whatever happened. */
afterEach(async () => {
  try {
    await view?.unmount();
  } finally {
    globalThis.fetch = realFetch;
    mockStarterReview = actualReview.UNIT_A_STARTER_REVIEW;
    for (const [key, value] of BASELINE) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

/** The reviewed tester build over the fixture network: ready and signed out, with A prepared at the fake. */
async function mount() {
  for (const key of BUILD_KEYS) {
    const value = BETA_BUILD[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  mockStarterReview = fictionalApproval();
  const fake = fakeAccountApi([A]);
  const net = productionNetwork(fake.fetch as unknown as typeof fetch);
  globalThis.fetch = net.fetch;
  view = await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset}>
        <HookProbe />
        <PilotHost />
      </AccountProvider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  expect(account?.enabled).toBe(true);
  return { fake, net };
}

function connected(): ConnectedProfile {
  const shown = account?.panel.connected;
  if (!shown) throw new Error('The account panel shows no connected profile');
  return shown;
}

function progressNow(): AccountSyncProgress {
  const progress = connected().progress;
  if (!progress) throw new Error('ConnectedProfile.progress is not provided');
  return progress;
}

/** A bounded wait in which nothing is expected to happen. */
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 250))));

/** Signs A in through the panel, then creates the adult profile with both ticks, until learning uses its dataset and its first sync has ended. */
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

/** The account dataset's main blob exactly as the device holds it: its stored answer IDs and its pilot document's attempts and intents. */
function stored() {
  const blob = JSON.parse(device.getItem(ACCOUNT_KEY) ?? '{"answers":[]}') as { answers: { answer_id: string }[]; meta?: Record<string, string> };
  const raw = blob.meta?.[PILOT_META_KEY];
  const doc = raw === undefined ? { attempts: [] } : (JSON.parse(raw) as { attempts: unknown[]; captures?: { answer_id: string }[] });
  return { ids: blob.answers.map((a) => a.answer_id), attempts: doc.attempts.length, captureIds: (doc.captures ?? []).map((c) => c.answer_id) };
}

const appears = (testID: string) => waitFor(() => screen.getByTestId(testID), SOON);

/** Mounts the hosted screen, or a fresh one in the same providers. */
const showScreen = () =>
  act(async () => {
    pilotScreen.show();
  });

/** From the lesson (or a feedback) on to the next question. */
async function toQuestion() {
  await appears('pilot-next');
  await act(async () => {
    fireEvent.press(screen.getByTestId('pilot-next'));
  });
  await appears('pilot-question');
}

/** Picks the first shown option and presses Periksa. */
async function answerFirst() {
  const option = screen.getAllByTestId(/^pilot-option-/)[0]!;
  await act(async () => {
    fireEvent.press(option);
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('pilot-check'));
  });
}

describe('AccountProvider held capture', () => {
  it('shows a capture whose row append failed as held, not sent; a remounted screen records the row once and clears it', async () => {
    const { net } = await mount();
    await learningIn(A);
    await syncNow();
    expect(connected().syncStatus).toMatch(ALL_SENT);
    expect(progressNow()).toMatchObject({ queued: 0, deviceAccepted: 0, capturePending: false });
    const mark = net.requests.length;
    const providersStore = app?.store;

    await showScreen();
    await appears('pilot-lesson');
    await toQuestion();
    flaky.fail.armed = 1;
    await answerFirst();
    await appears('pilot-feedback');
    await appears('pilot-capture-pending');
    // The intent and the feedback are saved; only the row is missing, and the one failure is spent.
    expect(flaky.fail.thrown).toBe(1);
    expect(stored()).toEqual({ ids: [], attempts: 1, captureIds: [expect.any(String)] });
    const held = stored().captureIds;

    // The account must know: a held capture, and never the earlier "all sent".
    await waitFor(() => expect(progressNow().capturePending).toBe(true), SOON);
    expect(progressNow()).toMatchObject({ queued: 0, blocked: 0, deviceAccepted: 0 });
    expect(connected().syncStatus).not.toMatch(ALL_SENT);
    await settle();
    expect(net.requests.slice(mark)).toEqual([]);

    // The screen's next load, in the same providers, finds the intent and records its row.
    await showScreen();
    await appears('pilot-feedback');
    await waitFor(() => expect(progressNow()).toMatchObject({ queued: 1, capturePending: false }), SOON);
    await waitFor(() => expect(screen.queryByTestId('pilot-capture-pending')).toBeNull(), SOON);
    expect(connected().syncStatus).not.toMatch(HELD_NOTE);
    expect(connected().syncStatus).not.toMatch(ALL_SENT);
    // One attempt, one intent, one row, written once; the failure was never repeated.
    expect(stored()).toEqual({ ids: held, attempts: 1, captureIds: held });
    expect(flaky.fail.thrown).toBe(1);
    expect(app?.store).toBe(providersStore);
    await settle();
    expect(net.requests.slice(mark)).toEqual([]);
  });

  it('keeps a capture that fails while an upload is in flight held after that upload ends; re-entry records it once, the next sync sends it once', async () => {
    const { fake } = await mount();
    await learningIn(A);
    await showScreen();
    await appears('pilot-lesson');
    await toQuestion();
    await answerFirst();
    await appears('pilot-feedback');
    await waitFor(() => expect(progressNow()).toMatchObject({ queued: 1, capturePending: false }), SOON);
    const [first] = stored().ids;
    expect(stored()).toEqual({ ids: [first], attempts: 1, captureIds: [first] });
    await toQuestion();
    // Leaving the feedback told the account once more: let that end, so no sync is in flight for it and nothing is held yet.
    await settle();
    expect(progressNow()).toMatchObject({ queued: 1, capturePending: false });

    // Answer 1 is on its way: the upload is held at the fake after it was recorded there.
    const gate = fake.hold('events');
    await act(async () => {
      account?.panel.onSyncNow();
    });
    await waitFor(() => expect(eventPosts(fake)).toHaveLength(1), SOON);
    expect(eventPosts(fake).map(sentIds)).toEqual([[first]]);

    // Answer 2 is chosen meanwhile and its row append fails: the intent and the feedback are saved.
    flaky.fail.armed = 1;
    await answerFirst();
    await appears('pilot-feedback');
    await appears('pilot-capture-pending');
    expect(flaky.fail.thrown).toBe(1);
    const second = stored().captureIds[1];
    expect(stored()).toEqual({ ids: [first], attempts: 2, captureIds: [first, second] });

    // Reported at once, while the upload is still in flight.
    await waitFor(() => expect(progressNow().capturePending).toBe(true), SOON);
    expect(account?.panel.busy).toBe('sync');
    expect(eventPosts(fake)).toHaveLength(1);

    // The upload ends: the sync's own finalization must not clear what was held while it ran.
    gate.release();
    await waitFor(() => expect(account?.panel.busy ?? null).toBeNull(), SOON);
    await settle();
    expect(progressNow()).toMatchObject({ queued: 0, blocked: 0, deviceAccepted: 1, capturePending: true });
    expect(connected().syncStatus).not.toMatch(ALL_SENT);
    expect(eventPosts(fake).map(sentIds)).toEqual([[first]]);

    // Back in the screen (same providers; the failure is spent): row 2 is recorded once and only queued, nothing is sent.
    await showScreen();
    await appears('pilot-feedback');
    await waitFor(() => expect(progressNow()).toMatchObject({ queued: 1, deviceAccepted: 1, capturePending: false }), SOON);
    expect(connected().syncStatus).not.toMatch(HELD_NOTE);
    expect(connected().syncStatus).not.toMatch(ALL_SENT);
    expect(stored()).toEqual({ ids: [first, second], attempts: 2, captureIds: [first, second] });
    expect(flaky.fail.thrown).toBe(1);
    await settle();
    expect(eventPosts(fake).map(sentIds)).toEqual([[first]]);

    // Only the next manual sync sends it, once.
    await syncNow();
    expect(eventPosts(fake).map(sentIds)).toEqual([[first], [second]]);
    expect(progressNow()).toMatchObject({ queued: 0, blocked: 0, deviceAccepted: 2, capturePending: false });
    expect(connected().syncStatus).toMatch(ALL_SENT);
  });
});
