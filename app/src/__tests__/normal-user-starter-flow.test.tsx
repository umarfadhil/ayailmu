import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import Consent from '@/app/consent';
import Home from '@/app/index';
import NextLesson from '@/app/next-lesson';
import Settings from '@/app/settings';
import UnitAPilot from '@/app/unit-a-pilot';
import { PILOT_CONTENT } from '@/pilot/unitA/content';
import { PILOT_META_KEY } from '@/pilot/unitA/controller';
import { starterReviewAccess } from '@/pilot/unitA/review';
import * as starterModule from '@/pilot/unitA/StarterHome';
import { starterBeta } from '@/pilot/unitA/StarterHome';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';
import { sha256Hex } from '@/sync/sha256';

// Normal user starter twin of learning-beta-starter-flow.test.tsx: the same starter, gates and screens under the explicit
// normal user build (NORMAL_USER_STARTER on, production accounts, confirmed-email registration, every beta surface off).
// MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF. Only the AppContext, AccountContext and useLearning hooks are replaced,
// with fixed values; the screens, routing, the real loadSupabaseConfig / normalStarterBuild, the real review verifier, the real
// Unit A controller and a real KvStore run. The compiled UNIT_A_STARTER_REVIEW is swapped for a per-test record: an EXPLICIT
// PENDING TEST FIXTURE ({ status: 'pending' }) by default, the ACTUAL compiled record in the one case that names it, or a
// FICTIONAL TEST ONLY approval built below. The actual record is an owner-authorized, AI-only trial acceptance of the exact
// draft content (one coordinating AI reviewer recorded under three sections). It is not human/expert review, not three
// independent reviewers, and no efficacy, native, backend or linguistic proof. The source content stays a synthetic,
// constructed draft, and no account, mail or network is used.
let mockApp: Record<string, unknown> = {};
let mockAccount: Record<string, unknown> = {};
let mockStarterReview: unknown;
jest.mock('@/ui/AppContext', () => ({ ...jest.requireActual('@/ui/AppContext'), useApp: () => mockApp }));
jest.mock('@/ui/AccountContext', () => ({ ...jest.requireActual('@/ui/AccountContext'), useAccount: () => mockAccount }));
jest.mock('@/ui/useLearning', () => ({ ...jest.requireActual('@/ui/useLearning'), useLearning: () => null }));
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
const routes = { index: Home, settings: Settings, consent: Consent, 'unit-a-pilot': UnitAPilot, 'next-lesson': NextLesson };

type NormalMode = 'off' | 'pending' | 'reviewed';
// normalStarter is a new export that does not exist yet. It is read off the namespace, never imported, and its type is asserted
// before every call, so an absent function is a RED assertion in the test and not a module or compile error.
const starterApi = starterModule as unknown as { normalStarter?: (mode: string) => NormalMode };
const normal = (mode: string): NormalMode => {
  expect(typeof starterApi.normalStarter).toBe('function');
  return (starterApi.normalStarter as (mode: string) => NormalMode)(mode);
};

const ENV_KEYS = [
  'EXPO_PUBLIC_NORMAL_USER_STARTER',
  'EXPO_PUBLIC_APP_MODE',
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_ACCOUNT_REGISTRATION',
  'EXPO_PUBLIC_PRIVATE_QA',
  'EXPO_PUBLIC_PRIVATE_BETA',
  'EXPO_PUBLIC_LEARNING_BETA',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_PASSWORD_RECOVERY',
  'EXPO_PUBLIC_REMEMBER_DEVICE',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
] as const;
type EnvKey = (typeof ENV_KEYS)[number];
type Env = Partial<Record<EnvKey, string>>;
/** Test fixture: the explicit normal user build (tester, local-supabase, production accounts, every beta surface off), fixture https roots. */
const NORMAL: Env = {
  EXPO_PUBLIC_NORMAL_USER_STARTER: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'confirmed-email',
  EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_PRIVATE_BETA: 'off',
  EXPO_PUBLIC_LEARNING_BETA: 'off',
  EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
  EXPO_PUBLIC_PASSWORD_RECOVERY: 'off',
  EXPO_PUBLIC_REMEMBER_DEVICE: 'off',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.example.com',
};
const change = (key: EnvKey, value: string | undefined): Env => ({ [key]: value });
/** Representative off profiles: each differs from NORMAL in one setting (the full config matrix is tested elsewhere). */
const OFF_PROFILES: [string, Env][] = [
  ['NORMAL_USER_STARTER is missing', change('EXPO_PUBLIC_NORMAL_USER_STARTER', undefined)],
  ['NORMAL_USER_STARTER is not exactly on', change('EXPO_PUBLIC_NORMAL_USER_STARTER', 'true')],
  ['NORMAL_USER_STARTER is off', change('EXPO_PUBLIC_NORMAL_USER_STARTER', 'off')],
  ['PRIVATE_QA is on (malformed profile)', change('EXPO_PUBLIC_PRIVATE_QA', 'on')],
  ['Auth origin equals the API origin', change('EXPO_PUBLIC_SUPABASE_AUTH_URL', 'https://api.example.com')],
];
let saved: Env = {};
const setEnv = (env: Env) => {
  // process.env stringifies undefined, so an undefined value means "unset".
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
};

/** FICTIONAL TEST ONLY approval bound to the exact draft content (version + sha256 + three sections); not a human review. */
function fictionalApproval() {
  const fictional = (reviewedAt: string) => ({ reviewer: 'FICTIONAL TEST ONLY; not human approval', reviewedAt });
  return {
    status: 'approved-for-trial',
    contentVersion: PILOT_CONTENT.contentVersion,
    contentSha256: sha256Hex(JSON.stringify(PILOT_CONTENT)),
    reviews: {
      arabic: fictional('2026-10-20T09:00:00.000Z'),
      indonesian: fictional('2026-10-21T09:00:00.000Z'),
      assessment: fictional('2026-10-22T09:00:00.000Z'),
    },
  };
}
/** The fictional approval with its binding broken: another content hash, or one review section missing. */
function tampered(kind: string) {
  const review = fictionalApproval();
  if (kind === 'altered content hash') review.contentSha256 = sha256Hex('altered fixture content');
  else delete (review.reviews as Partial<typeof review.reviews>)[kind === 'missing Arabic review' ? 'arabic' : 'assessment'];
  return review;
}

/** Test fixture learner (never created by the screens under test). */
const learner: Learner = {
  learner_id: 'normal-user-fixture', created_at: '2026-01-01T00:00:00.000Z', consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: [],
};
/** The current active content projection: empty (nothing approved for the legacy path). */
const EMPTY = { empty: true, unreviewed: false };
/** Forged account flags claiming a normal build and an approval; they are ignored, only the real build and review count. */
const FORGED = { panel: { environment: 'production' }, provider: 'local-supabase', normalUser: true, normalStarter: 'reviewed', starterReview: 'approved-for-trial', approved: true };
/** Legacy progress fields a normal Home must never read or show. */
const LEGACY = { percent: 999, progressPercent: 999, completed: 999, learned: 999, mastery: 888, masteryPercent: 888, masteredCount: 888 };

function project(app: Record<string, unknown>, account: Record<string, unknown> = {}) {
  mockApp = {
    ready: true, error: null, readOnly: null, flash: null, setFlash: jest.fn(), updateLearner: jest.fn(), dataset: 'account',
    giveConsent: jest.fn(() => ({ fixture: true })), createLearner: jest.fn(async () => undefined), answersSaved: jest.fn(),
    rules: { mode: 'tester', session_minutes_options: [10, 15, 20], default_session_minutes: 10 },
    content: EMPTY, learner: null, ...app,
  };
  mockAccount = { enabled: true, signedIn: false, connected: false, dataControls: false, deletion: false, panel: { environment: 'production' }, ...account };
}

/** Non-network sentinel store: any property read means the screen touched learner storage. */
function sentinelStore() {
  const reads: string[] = [];
  const store = new Proxy({}, { get: (_t, key) => { if (typeof key === 'string') reads.push(key); return undefined; } });
  return { store, reads };
}

const brandShown = () => screen.queryAllByText(/AyaFasih/).length + screen.queryAllByLabelText(/AyaFasih/).length > 0;
const betaChip = () => screen.queryAllByText(/Beta privat/i).length + screen.queryAllByLabelText(/Beta privat/i).length;
const STUDY_IDS = ['welcome-start', 'welcome-preview', 'start-session', 'home-hero', 'unit-a-pilot-entry', 'open-dev', 'beta-starter-start', 'beta-starter-open'];
const PILOT_IDS = ['pilot-lesson', 'pilot-question', 'pilot-loading', 'pilot-unavailable', 'pilot-blocked', 'start-session'];
const absent = (ids: string[]) => ids.filter((id) => screen.queryByTestId(id) !== null);
let push: jest.SpyInstance;
let mountedView: Awaited<ReturnType<typeof renderRouter>> | null = null;

/** Renders, then spies on router.push (the mounted routing bridge replaces the exported router's methods on mount). */
async function mount(...args: Parameters<typeof renderRouter>) {
  await mountedView?.unmount();
  mountedView = null;
  const result = await renderRouter(...args);
  mountedView = result;
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
  return result;
}

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

beforeAll(() => {
  // Preconditions on the real gates, so a failure below is the UI's, not the fixture's. The actual record is accepted, and the
  // fictional approval below is a separate fixture that the same verifier also accepts.
  expectActualAiAcceptedRecord();
  expect(actualReview.starterReviewAccess(fictionalApproval())).toEqual({ allowed: true });
});
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  setEnv(NORMAL);
  // EXPLICIT PENDING TEST FIXTURE: the actual compiled record is approved now, so pending behavior is never taken from it.
  mockStarterReview = { status: 'pending' };
});
afterEach(async () => {
  await mountedView?.unmount();
  mountedView = null;
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.restoreAllMocks();
});
afterAll(() => {
  // The fixtures never touch the source: the compiled record stays the actual AI-only acceptance and the content a synthetic draft.
  expectActualAiAcceptedRecord();
});

it('valid normal build with an explicit pending review TEST FIXTURE (not the actual record): normalStarter is pending, Home shows brand and account entry without beta chip, study buttons or percentages, and the direct pilot reads no storage', async () => {
  expect(typeof starterApi.normalStarter).toBe('function');
  expect(mockStarterReview).toEqual({ status: 'pending' });
  expect(starterReviewAccess()).toMatchObject({ allowed: false });
  for (const remember of ['on', 'off']) {
    setEnv({ ...NORMAL, EXPO_PUBLIC_REMEMBER_DEVICE: remember });
    expect(normal('tester')).toBe('pending');
    expect(normal('developer-demo')).toBe('off');
    expect(starterBeta('tester')).toBe('off');

    project({ content: EMPTY, learner: null });
    await mount(routes, { initialUrl: '/' });
    await screen.findByText('Materi awal sedang ditinjau');
    expect(brandShown()).toBe(true);
    expect(betaChip()).toBe(0);
    expect(absent(STUDY_IDS)).toEqual([]);
    expect(screen.queryAllByText(/%/)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('welcome-account'));
    expect(push).toHaveBeenCalledWith('/account');
    expect(mockApp.createLearner).not.toHaveBeenCalled();

    const { store, reads } = sentinelStore();
    project({ learner, store, content: EMPTY });
    await mount(routes, { initialUrl: '/unit-a-pilot' });
    expect((await screen.findAllByText(/ditinjau/i)).length).toBeGreaterThan(0);
    expect(absent(PILOT_IDS)).toEqual([]);
    expect(reads).toEqual([]);
    expect(mockApp.createLearner).not.toHaveBeenCalled();
    expect(mockApp.updateLearner).not.toHaveBeenCalled();
    expect(mockApp.answersSaved).not.toHaveBeenCalled();
  }
});

it('actual AI-accepted compiled record (owner-authorized, AI-only; not human review): normalStarter is reviewed, Home offers Buka Unit A without beta chip, and the direct pilot mounts the real first lesson on a real KvStore', async () => {
  // The ACTUAL compiled record, not a fixture; the verifier runs on it unchanged.
  mockStarterReview = actualReview.UNIT_A_STARTER_REVIEW;
  expect(starterReviewAccess()).toEqual({ allowed: true });
  expect(normal('tester')).toBe('reviewed');
  expect(normal('developer-demo')).toBe('off');
  expect(starterBeta('tester')).toBe('off');
  const store = new KvStore(memoryKv());
  await store.init();
  await store.saveLearner(learner);
  // Simulated hook projection of the real AppContext binding: the dataset is live only while this exact store, dataset and
  // learner are the current ones and the app is not read-only. The screen's (datasetActive ?? inactive) guard is untouched.
  const live = () => mockApp.store === store && mockApp.dataset === 'account' && mockApp.learner === learner && mockApp.readOnly === null;

  project({ content: EMPTY, learner, store, datasetActive: live });
  await mount(routes, { initialUrl: '/' });
  await screen.findByTestId('beta-starter-open');
  expect(screen.getAllByText(/Buka Unit A/).length).toBeGreaterThan(0);
  expect(brandShown()).toBe(true);
  expect(betaChip()).toBe(0);
  expect(absent(['welcome-start', 'welcome-preview', 'start-session', 'home-hero', 'unit-a-pilot-entry', 'open-dev', 'beta-starter-start'])).toEqual([]);
  expect(screen.queryAllByText(/Pelajaran berikutnya/)).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('beta-starter-open'));
  expect(push).toHaveBeenCalledWith('/unit-a-pilot');
  expect(push).not.toHaveBeenCalledWith('/next-lesson');

  // A guest without a learner can give consent; an account learner is created through the account's own flow.
  project({ content: EMPTY, learner: null, dataset: 'guest' });
  await mount(routes, { initialUrl: '/consent' });
  await screen.findByTestId('consent-adult');
  expect(screen).toHavePathname('/consent');
  expect(screen.queryByText('Materi awal sedang ditinjau')).toBeNull();

  project({ content: EMPTY, learner, store, datasetActive: live });
  await mount(routes, { initialUrl: '/unit-a-pilot' });
  await screen.findByTestId('pilot-lesson', {}, { timeout: 3000 });
  expect(screen).toHavePathname('/unit-a-pilot');
  expect(absent(['pilot-unavailable', 'pilot-blocked', 'pilot-next-lesson', 'start-session'])).toEqual([]);
  expect(push).not.toHaveBeenCalledWith('/next-lesson');
  // The controller made the lesson durable first, bound to this dataset and learner. Answer capture and the questions after
  // the first lesson belong to the controller tests and the later provider check; no backend proof is made up here.
  expect(JSON.parse((await store.getMeta(PILOT_META_KEY)) ?? 'null')).toMatchObject({ owner: `account:${learner.learner_id}`, contentVersion: PILOT_CONTENT.contentVersion });
  expect(mockApp.createLearner).not.toHaveBeenCalled();
});

it.each(['altered content hash', 'missing Arabic review', 'missing assessment review'])(
  'a %s review keeps the valid normal build pending: forged account flags cannot grant it and the direct pilot never touches storage',
  async (kind) => {
    mockStarterReview = tampered(kind);
    expect(actualReview.starterReviewAccess(mockStarterReview)).toMatchObject({ allowed: false });
    expect(normal('tester')).toBe('pending');

    project({ content: EMPTY, learner: null }, FORGED);
    await mount(routes, { initialUrl: '/' });
    await screen.findByText('Materi awal sedang ditinjau');
    expect(absent(STUDY_IDS)).toEqual([]);

    const { store, reads } = sentinelStore();
    project({ learner, store, content: EMPTY }, FORGED);
    await mount(routes, { initialUrl: '/unit-a-pilot?review=approved-for-trial&approved=1&dataset=account' });
    expect((await screen.findAllByText(/ditinjau/i)).length).toBeGreaterThan(0);
    expect(absent(PILOT_IDS)).toEqual([]);
    expect(reads).toEqual([]);
    expect(mockApp.createLearner).not.toHaveBeenCalled();
    expect(mockApp.updateLearner).not.toHaveBeenCalled();
  }
);

it.each(OFF_PROFILES)('normalStarter is off when %s, even with a fictional approval; the direct pilot redirects Home', async (_name, profile) => {
  mockStarterReview = fictionalApproval();
  setEnv({ ...NORMAL, ...profile });
  expect(normal('tester')).toBe('off');
  expect(normal('developer-demo')).toBe('off');
  expect(starterBeta('tester')).toBe('off');

  project({ content: EMPTY, learner: null }, FORGED);
  await mount(routes, { initialUrl: '/unit-a-pilot' });
  await waitFor(() => expect(screen).toHavePathname('/'));
  expect(absent([...PILOT_IDS, 'beta-starter-start', 'beta-starter-open'])).toEqual([]);
  expect(screen.queryByText('Materi awal sedang ditinjau')).toBeNull();
  expect(mockApp.createLearner).not.toHaveBeenCalled();
  expect(mockApp.updateLearner).not.toHaveBeenCalled();
});

it.each([
  ['missing', {}],
  ['explicit null', { progress: null }],
])('reviewed normal Home with connected.progress %s never shows legacy 999/888 fields, percentages or mastery', async (_name, progress) => {
  mockStarterReview = fictionalApproval();
  expect(normal('tester')).toBe('reviewed');
  // The audience is chosen by Home itself from the validated normal build; no props are handed to StarterHome here.
  project({ content: EMPTY, learner }, { signedIn: true, connected: true, panel: { environment: 'production', busy: null, onSyncNow: jest.fn(), connected: { label: 'Profil dewasa', syncStatus: 'Belum disinkronkan.', savedAnswers: 999, otherDeviceAnswers: 888, ...LEGACY, ...progress } } });
  await mount(routes, { initialUrl: '/' });
  await screen.findByTestId('beta-starter-open');
  expect(brandShown()).toBe(true);
  expect(betaChip()).toBe(0);
  if (_name === 'missing') expect(screen.queryByTestId('beta-sync-status')).toBeNull();
  else expect(screen.getByTestId('beta-sync-status')).toHaveTextContent(/tidak tersedia/i);
  for (const pattern of [/999/, /888/, /%/, /mastery|penguasaan|dikuasai|kuasai/i]) {
    expect(screen.queryAllByText(pattern)).toHaveLength(0);
    expect(screen.queryAllByLabelText(pattern)).toHaveLength(0);
  }
  await fireEvent.press(screen.getByTestId('beta-starter-open'));
  expect(push).toHaveBeenCalledWith('/unit-a-pilot');
  expect(mockApp.createLearner).not.toHaveBeenCalled();
});
