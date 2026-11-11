// Protocol-fixture verification, NOT a live-backend, full-router, native or phone test.
// The real providers, SDK, API client, journal, datasets and pilot screen run together.
// Only device I/O and the network are fixtures. The compiled review is the ACTUAL record,
// returned unchanged through the mock getter below so the real verifier runs on it: an
// owner-authorized, AI-only trial acceptance of the exact synthetic draft content (one
// coordinating AI reviewer under three sections). It is not human/expert review, not three
// independent reviewers, and no efficacy proof; there is no live backend, native or phone proof.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { accountNamespace, openKvDataset, type Namespace } from '@/account/datasets';
import { localDate } from '@/engine/util';
import { PILOT_META_KEY } from '@/pilot/unitA/capture';
import { PILOT_CONTENT } from '@/pilot/unitA/content';
import { normalStarter } from '@/pilot/unitA/StarterHome';
import { UnitAPilotScreen } from '@/pilot/unitA/UnitAPilotScreen';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { AnswerRecord } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import type { AccountSyncProgress } from '@/sync/accountProgress';
import { sha256Hex } from '@/sync/sha256';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { fakeAccountApi, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';

jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => { throw new Error('Guest storage must be supplied by this fixture.'); },
}));

let mockStarterReview: unknown;
jest.mock('@/pilot/unitA/review', () => {
  const actual = jest.requireActual('@/pilot/unitA/review');
  return {
    ...actual,
    get UNIT_A_STARTER_REVIEW() { return mockStarterReview; },
    starterReviewAccess: (review: unknown = mockStarterReview, content?: unknown) => actual.starterReviewAccess(review, content),
  };
});
const actualReview = jest.requireActual('@/pilot/unitA/review') as typeof import('@/pilot/unitA/review');

jest.setTimeout(30_000);
const A: FakeUser = { email: 'starter.a@example.org', password: 'fixture-password-a', uid: 'uid-A', token: 'legacy-fixture-token-a', accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01' };
const B: FakeUser = { email: 'starter.b@example.org', password: 'fixture-password-b', uid: 'uid-B', token: 'legacy-fixture-token-b', accountId: '9b7d5e21-0c4f-4a8e-b1d3-2f6a8c0e4b12' };
const BUILD = {
  EXPO_PUBLIC_NORMAL_USER_STARTER: 'on', EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on', EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'confirmed-email',
  EXPO_PUBLIC_PRIVATE_QA: 'off', EXPO_PUBLIC_PRIVATE_BETA: 'off', EXPO_PUBLIC_LEARNING_BETA: 'off',
  EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off', EXPO_PUBLIC_PASSWORD_RECOVERY: 'off', EXPO_PUBLIC_REMEMBER_DEVICE: 'off',
  EXPO_PUBLIC_API_BASE_URL: PRODUCTION_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: PRODUCTION_AUTH,
};
const EXTRA_KEYS = ['EXPO_PUBLIC_AUTH_EMULATOR_URL', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL', 'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL'];
const KEYS = [...Object.keys(BUILD), ...EXTRA_KEYS];
const BASELINE = KEYS.map((key) => [key, process.env[key]] as const);
const realFetch = globalThis.fetch;
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const SOON = { timeout: 5000 };
let device = memoryKv();
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let view: Awaited<ReturnType<typeof render>> | null = null;
const pilotScreen = { show: (): void => undefined };

const ACTUAL_SHA256 = '5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e';
const ACTUAL_REVIEWED_AT = '2026-10-30T10:25:22.000Z';
/**
 * The actual compiled record: the owner-authorized, AI-only trial acceptance of the exact current draft content, with one
 * coordinating AI reviewer under all three sections. Not human/expert review, not three independent reviewers, and no efficacy,
 * native or backend proof; the content itself stays a synthetic, constructed draft.
 */
function expectActualAiAcceptedRecord() {
  const section = { reviewer: expect.stringMatching(/^\/root\/check_fasih_expo .*AI-only/), reviewedAt: ACTUAL_REVIEWED_AT };
  expect(actualReview.UNIT_A_STARTER_REVIEW).toMatchObject({
    status: 'approved-for-trial', contentVersion: PILOT_CONTENT.contentVersion, contentSha256: ACTUAL_SHA256,
    reviews: { arabic: section, indonesian: section, assessment: section },
  });
  expect(sha256Hex(JSON.stringify(PILOT_CONTENT))).toBe(ACTUAL_SHA256);
  expect(actualReview.starterReviewAccess()).toEqual({ allowed: true });
  expect(PILOT_CONTENT).toMatchObject({ synthetic: true, constructed: true, reviewStatus: 'draft' });
}

async function openGuest() {
  const guest = new KvStore(device);
  await guest.init();
  return guest;
}
const openAccountDataset = (namespace: Namespace) => openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });

function HookProbe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => { account = accountValue; app = appValue; }, [accountValue, appValue]);
  return null;
}

// This host passes the real route's capture props, but does not claim router E2E.
function PilotHost() {
  const { store, learner, dataset, rules, readOnly, datasetActive, answersSaved } = useApp();
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    pilotScreen.show = () => setVisit((n) => n + 1);
    return () => { pilotScreen.show = () => undefined; };
  }, []);
  const today = useCallback(() => localDate(Date.now()), []);
  const capture = dataset === 'account' && normalStarter(rules.mode) === 'reviewed';
  if (visit === 0 || !store || !learner) return null;
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <UnitAPilotScreen key={visit} store={store} owner={`${dataset}:${learner.learner_id}`}
        mode={rules.mode} readOnly={readOnly} arabicScale={learner.arabic_scale} today={today}
        active={capture ? (datasetActive ?? (() => false)) : undefined}
        captureLearnerId={capture ? learner.learner_id : undefined}
        onAnswersSaved={capture ? answersSaved : undefined} />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  device = memoryKv(); account = null; app = null; view = null;
  for (const key of KEYS) {
    const value = (BUILD as Record<string, string>)[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  expectActualAiAcceptedRecord();
  mockStarterReview = actualReview.UNIT_A_STARTER_REVIEW;
});
afterEach(async () => {
  try { await view?.unmount(); }
  finally {
    globalThis.fetch = realFetch;
    mockStarterReview = actualReview.UNIT_A_STARTER_REVIEW;
    for (const [key, value] of BASELINE) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    expectActualAiAcceptedRecord();
  }
});

function clearProbes() { account = null; app = null; }
async function mountProviders() {
  clearProbes();
  view = await render(<AppProvider storeFactory={openGuest}><AccountProvider openDataset={openAccountDataset}>
    <HookProbe /><PilotHost />
  </AccountProvider></AppProvider>);
  await waitFor(() => expect(app?.ready).toBe(true), SOON);
  expect(account?.enabled).toBe(true);
}
async function mount() {
  const fake = fakeAccountApi([A, B]);
  const net = productionNetwork(fake.fetch as unknown as typeof fetch);
  globalThis.fetch = net.fetch;
  await mountProviders();
  return { fake, net };
}
async function learningIn(user: FakeUser, fake: FakeAccountApi) {
  await act(async () => { account?.panel.onSubmit({ mode: 'signin', email: user.email, password: user.password }); });
  await waitFor(() => expect([account?.panel.account?.label, account?.panel.busy ?? null, account?.panel.error ?? null]).toEqual([user.email, null, null]), SOON);
  if (!account?.connected) {
    const existing = fake.profileOf(user.accountId);
    await act(async () => {
      if (existing) account?.panel.onLinkProfile(existing.profileId);
      else account?.panel.onCreateProfile({ adult: true, agreed: true });
    });
  }
  await waitFor(() => {
    expect([account?.connected, account?.panel.busy ?? null, app?.dataset, app?.datasetActive?.()]).toEqual([true, null, 'account', true]);
  }, SOON);
}
function progress(): AccountSyncProgress {
  const p = account?.panel.connected?.progress;
  if (!p) throw new Error('The actual provider supplied no progress model.');
  return p;
}
function stored(user = A) {
  const blob = JSON.parse(device.getItem(accountNamespace(user.accountId).kvKey) ?? '{"answers":[],"meta":{}}') as { answers: AnswerRecord[]; meta?: Record<string, string> };
  const raw = blob.meta?.[PILOT_META_KEY];
  const doc = raw ? JSON.parse(raw) as { attempts: unknown[] } : { attempts: [] };
  return { rows: blob.answers, attempts: doc.attempts.length };
}
const eventPosts = (fake: FakeAccountApi) => fake.sent.filter((r) => r.method === 'POST' && /^\/v1\/profiles\/[^/]+\/events$/.test(r.path));
const appears = (id: string) => waitFor(() => screen.getByTestId(id), SOON);
async function show() { await act(async () => { pilotScreen.show(); }); }
async function firstAnswer() {
  await show(); await appears('pilot-lesson');
  await act(async () => { fireEvent.press(screen.getByTestId('pilot-next')); });
  await appears('pilot-question');
  expect(stored().rows).toHaveLength(0);
  expect(progress()).toMatchObject({ queued: 0, deviceAccepted: 0 });
  // The first reference item is هُوَ كَاتِبٌ: literal b is correct, independent of source.correct.
  await act(async () => { fireEvent.press(screen.getByTestId('pilot-option-b')); });
  await act(async () => { fireEvent.press(screen.getByTestId('pilot-check')); });
  await appears('pilot-feedback');
  expect(screen.getByText('Benar')).toBeTruthy();
  await waitFor(() => expect(progress()).toMatchObject({ queued: 1, deviceAccepted: 0, capturePending: false }), SOON);
}
async function sync() {
  await act(async () => { account?.panel.onSyncNow(); });
  await waitFor(() => expect(account?.panel.busy ?? null).toBeNull(), SOON);
  await waitFor(() => expect(progress()).toMatchObject({ queued: 0, deviceAccepted: 1 }), SOON);
}

it('real screen capture notifies the provider; reads do not count and remount/sync do not duplicate answers', async () => {
  const { fake } = await mount();
  await learningIn(A, fake); await firstAnswer();
  const saved = stored();
  expect(saved.attempts).toBe(1);
  expect(saved.rows).toHaveLength(1);
  expect(saved.rows[0]).toMatchObject({ learner_id: app?.learner?.learner_id, outcome: 'correct' });
  expect(eventPosts(fake)).toHaveLength(0);
  await show(); await appears('pilot-feedback');
  expect(stored()).toEqual(saved);
  await sync();
  const posts = eventPosts(fake);
  expect(posts).toHaveLength(1);
  expect((JSON.parse(posts[0]!.body) as { events: { event_id: string }[] }).events.map((e) => e.event_id)).toEqual([saved.rows[0]!.answer_id]);
  // Transport acceptance is distinct from the server's eligible curricular count.
  expect(progress().server.state).toBe('verified');
});

it('persists A through provider restart and explicit relogin, then keeps B isolated without changing A', async () => {
  const { fake } = await mount();
  await learningIn(A, fake); await firstAnswer(); await sync();
  const saved = stored();
  await view!.unmount(); view = null;
  await mountProviders();
  await learningIn(A, fake);
  await waitFor(() => expect(progress()).toMatchObject({ queued: 0, deviceAccepted: 1 }), SOON);
  await show(); await appears('pilot-feedback');
  expect(stored()).toEqual(saved);
  expect(eventPosts(fake)).toHaveLength(1);
  await act(async () => { account?.panel.onSignOut(); });
  await waitFor(() => expect(account?.signedIn).toBe(false), SOON);
  await learningIn(B, fake);
  expect(stored(B)).toEqual({ rows: [], attempts: 0 });
  expect(progress()).toMatchObject({ queued: 0, deviceAccepted: 0 });
  await show(); await appears('pilot-lesson');
  expect(screen.queryByTestId('pilot-feedback')).toBeNull();
  expect(stored(A)).toEqual(saved);
});
