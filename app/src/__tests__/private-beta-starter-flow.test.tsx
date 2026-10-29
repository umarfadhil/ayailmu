import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import Consent from '@/app/consent';
import Home from '@/app/index';
import NextLesson from '@/app/next-lesson';
import Settings from '@/app/settings';
import UnitAPilot from '@/app/unit-a-pilot';
import { loadPrivateBetaConfig } from '@/config/privateBeta';
import { PILOT_CONTENT } from '@/pilot/unitA/content';
import { PILOT_META_KEY } from '@/pilot/unitA/controller';
import { starterReviewAccess } from '@/pilot/unitA/review';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';
import { sha256Hex } from '@/sync/sha256';

// MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF. Only the AppContext, AccountContext and useLearning hooks are
// replaced, with fixed values; the screens, routing, the real private beta config check and the real review verifier
// run. The compiled UNIT_A_STARTER_REVIEW value is swapped for a per-test record: the real pending record by default,
// or, for the counterfactual reviewed build only, a FICTIONAL approval built below. starterReviewAccess still runs
// the real verifier, only defaulting to that record. None of this is native, backend or linguistic approval proof:
// the source review stays pending, the source content stays a synthetic draft, and no account, mail or network is used.
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
const ENV_KEYS = [
  'EXPO_PUBLIC_PRIVATE_BETA',
  'EXPO_PUBLIC_APP_MODE',
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_PRIVATE_QA',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;
/** Test fixture: the explicit private beta profile (tester, staging, local-supabase, beta on, production off), fixture https roots. */
const BETA: Env = {
  EXPO_PUBLIC_PRIVATE_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.beta.example.com',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.beta.example.com',
};
/** Test fixture: the validated production profile, with the beta flag also set (it must not matter there). */
const PRODUCTION: Env = {
  ...BETA,
  EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_PRIVATE_QA: undefined,
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.example.org',
};
let saved: Env = {};
const setEnv = (env: Env) => {
  // process.env stringifies undefined, so an undefined value means "unset".
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
};

/** FICTIONAL approval of the exact draft content, for the counterfactual reviewed build only; not a real review. */
function fictionalApproval() {
  return {
    status: 'approved-for-trial',
    contentVersion: PILOT_CONTENT.contentVersion,
    contentSha256: sha256Hex(JSON.stringify(PILOT_CONTENT)),
    reviews: {
      arabic: { reviewer: 'Fictional Arabic Reviewer', reviewedAt: '2026-10-20T09:00:00.000Z' },
      indonesian: { reviewer: 'Fictional Indonesian Reviewer', reviewedAt: '2026-10-21T09:00:00.000Z' },
      assessment: { reviewer: 'Fictional Assessment Reviewer', reviewedAt: '2026-10-22T09:00:00.000Z' },
    },
  };
}

/** Test fixture learner (never created by the screens under test). */
const learner: Learner = {
  learner_id: 'private-beta-fixture', created_at: '2026-01-01T00:00:00.000Z', consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: [],
};
/** The current active content projection: empty (nothing approved for the legacy path). */
const EMPTY = { empty: true, unreviewed: false };

function project(app: Record<string, unknown>, account: Record<string, unknown> = {}) {
  mockApp = {
    ready: true, error: null, readOnly: null, flash: null, setFlash: jest.fn(), updateLearner: jest.fn(), dataset: 'guest',
    giveConsent: jest.fn(() => ({ fixture: true })), createLearner: jest.fn(async () => undefined),
    rules: { mode: 'tester', session_minutes_options: [10, 15, 20], default_session_minutes: 10 },
    content: EMPTY, learner: null, ...app,
  };
  mockAccount = { enabled: true, signedIn: false, connected: false, dataControls: false, deletion: false, panel: { environment: 'staging' }, ...account };
}

/** Non-network sentinel store: any property read means the screen touched learner storage. */
function sentinelStore() {
  const reads: string[] = [];
  const store = new Proxy({}, { get: (_t, key) => { if (typeof key === 'string') reads.push(key); return undefined; } });
  return { store, reads };
}

const brandShown = () => screen.queryAllByText(/AyaFasih/).length + screen.queryAllByLabelText(/AyaFasih/).length > 0;
const STUDY_IDS = ['welcome-start', 'welcome-preview', 'start-session', 'home-hero', 'unit-a-pilot-entry', 'open-dev', 'beta-starter-start', 'beta-starter-open'];
const absent = (ids: string[]) => ids.filter((id) => screen.queryByTestId(id) !== null);
let push: jest.SpyInstance;

/** Renders, then spies on router.push (the mounted routing bridge replaces the exported router's methods on mount). */
async function mount(...args: Parameters<typeof renderRouter>) {
  const result = await renderRouter(...args);
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
  return result;
}

beforeAll(() => {
  // Preconditions on the real gates, so a failure below is the UI's, not the fixture's.
  expect(loadPrivateBetaConfig(BETA)).toMatchObject({ enabled: true });
  expect(actualReview.UNIT_A_STARTER_REVIEW).toEqual({ status: 'pending' });
  expect(actualReview.starterReviewAccess(fictionalApproval())).toEqual({ allowed: true });
});
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  setEnv(BETA);
  mockStarterReview = actualReview.UNIT_A_STARTER_REVIEW;
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.restoreAllMocks();
});
afterAll(() => {
  // The fixture never touches the source: the compiled review stays pending and the content a synthetic draft.
  expect(actualReview.UNIT_A_STARTER_REVIEW).toEqual({ status: 'pending' });
  expect(PILOT_CONTENT).toMatchObject({ synthetic: true, constructed: true, reviewStatus: 'draft' });
});

it('beta Home with the compiled pending review shows the branded review state and the account entry, no study CTA', async () => {
  expect(starterReviewAccess()).toMatchObject({ allowed: false });
  for (const initialUrl of ['/', '/?review=approved-for-trial&starter=approved']) {
    project({ content: EMPTY, learner: null });
    await mount(routes, { initialUrl });
    await screen.findByText('Materi awal sedang ditinjau');
    expect(brandShown()).toBe(true);
    expect(absent(STUDY_IDS)).toEqual([]);
    expect(screen.queryAllByText(/\blab\b/i)).toHaveLength(0);
    expect(screen.queryAllByText(/pengembang/i)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('welcome-account'));
    expect(push).toHaveBeenCalledWith('/account');
    expect(mockApp.createLearner).not.toHaveBeenCalled();
    expect(mockApp.updateLearner).not.toHaveBeenCalled();
  }
});

it('pending review: direct /unit-a-pilot (query included) and /consent never mount teaching, read storage or create a learner', async () => {
  for (const initialUrl of ['/unit-a-pilot', '/unit-a-pilot?review=approved-for-trial&approved=1']) {
    const { store, reads } = sentinelStore();
    project({ learner, store, content: EMPTY });
    await mount(routes, { initialUrl });
    expect((await screen.findAllByText(/ditinjau/i)).length).toBeGreaterThan(0);
    expect(absent(['pilot-lesson', 'pilot-question', 'pilot-loading', 'pilot-unavailable', 'pilot-blocked', 'start-session'])).toEqual([]);
    expect(screen.queryAllByText(/pengembang/i)).toHaveLength(0);
    expect(reads).toEqual([]);
    expect(mockApp.updateLearner).not.toHaveBeenCalled();
  }
  project({ content: EMPTY, learner: null });
  await mount(routes, { initialUrl: '/consent?review=approved-for-trial' });
  await screen.findByText('Materi awal sedang ditinjau');
  expect(screen).toHavePathname('/');
  expect(screen.queryByTestId('consent-adult')).toBeNull();
  expect(mockApp.createLearner).not.toHaveBeenCalled();
});

it('fictional approved review, no learner: Home offers beta-starter-start to /consent, no learner created', async () => {
  mockStarterReview = fictionalApproval();
  project({ content: EMPTY, learner: null });
  await mount(routes, { initialUrl: '/' });
  await screen.findByTestId('beta-starter-start');
  expect(brandShown()).toBe(true);
  expect(absent(['beta-starter-open', 'start-session', 'home-hero', 'unit-a-pilot-entry', 'open-dev'])).toEqual([]);
  await fireEvent.press(screen.getByTestId('beta-starter-start'));
  expect(push).toHaveBeenCalledWith('/consent');
  expect(mockApp.createLearner).not.toHaveBeenCalled();
  expect(mockApp.giveConsent).not.toHaveBeenCalled();
});

it('fictional approved review: Consent stays despite empty legacy content and creates the learner only after both boxes and continue', async () => {
  mockStarterReview = fictionalApproval();
  project({ content: EMPTY, learner: null });
  await mount(routes, { initialUrl: '/consent' });
  await screen.findByTestId('consent-adult');
  expect(screen).toHavePathname('/consent');
  expect(screen.getByTestId('consent-continue')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('consent-continue'));
  await fireEvent.press(screen.getByTestId('consent-adult'));
  await fireEvent.press(screen.getByTestId('consent-continue'));
  expect(mockApp.giveConsent).not.toHaveBeenCalled();
  expect(mockApp.createLearner).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('consent-agree'));
  await fireEvent.press(screen.getByTestId('consent-continue'));
  await waitFor(() => expect(mockApp.createLearner).toHaveBeenCalledTimes(1));
  expect(mockApp.giveConsent).toHaveBeenCalledWith({ adult: true, agreed: true });
});

it('fictional approved review with a learner: Home offers beta-starter-open into /unit-a-pilot and no legacy lesson entry', async () => {
  mockStarterReview = fictionalApproval();
  project({ content: EMPTY, learner });
  await mount(routes, { initialUrl: '/' });
  await screen.findByTestId('beta-starter-open');
  expect(absent(['beta-starter-start', 'welcome-start', 'start-session', 'home-hero', 'home-path', 'unit-a-pilot-entry', 'open-dev'])).toEqual([]);
  expect(screen.queryAllByText(/Unit B/)).toHaveLength(0);
  expect(screen.queryAllByText(/Pelajaran berikutnya/)).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('beta-starter-open'));
  expect(push).toHaveBeenCalledWith('/unit-a-pilot');
});

it('fictional approved review: /unit-a-pilot runs the real starter controller on a real KvStore for this learner', async () => {
  mockStarterReview = fictionalApproval();
  const store = new KvStore(memoryKv());
  await store.init();
  project({ content: EMPTY, learner, store, dataset: 'guest' });
  await mount(routes, { initialUrl: '/unit-a-pilot' });
  await screen.findByTestId('pilot-lesson', {}, { timeout: 3000 });
  expect(absent(['pilot-unavailable', 'pilot-blocked', 'pilot-next-lesson'])).toEqual([]);
  // The controller made the lesson durable first, bound to this dataset and learner.
  const meta = await store.getMeta(PILOT_META_KEY);
  expect(JSON.parse(meta ?? 'null')).toMatchObject({ owner: `guest:${learner.learner_id}`, contentVersion: PILOT_CONTENT.contentVersion });
});

it('missing or invalid beta config never opens the beta path, even with an approval and a projection claiming beta', async () => {
  mockStarterReview = fictionalApproval();
  const invalid: Env[] = [
    { ...BETA, EXPO_PUBLIC_PRIVATE_BETA: undefined },
    { ...BETA, EXPO_PUBLIC_PRIVATE_QA: 'on' },
    { ...BETA, EXPO_PUBLIC_PRODUCTION_ACCOUNTS: undefined },
    { ...BETA, EXPO_PUBLIC_SUPABASE_AUTH_URL: BETA.EXPO_PUBLIC_API_BASE_URL },
  ];
  for (const env of invalid) {
    setEnv(env);
    const claim = { panel: { environment: 'staging' }, privateBeta: true, beta: { enabled: true } };
    project({ content: EMPTY, learner: null }, claim);
    await mount(routes, { initialUrl: '/' });
    await screen.findByText('Belum ada materi yang disetujui untuk uji coba');
    expect(screen.queryByText('Materi awal sedang ditinjau')).toBeNull();
    expect(absent(['beta-starter-start', 'beta-starter-open'])).toEqual([]);

    project({ content: EMPTY, learner: null }, claim);
    await mount(routes, { initialUrl: '/consent' });
    await screen.findByText('Belum ada materi yang disetujui untuk uji coba');
    expect(screen).toHavePathname('/');
    expect(mockApp.createLearner).not.toHaveBeenCalled();
  }
});

it('validated production presentation still redirects the developer pilot Home, even with the beta flag and an approval', async () => {
  setEnv(PRODUCTION);
  mockStarterReview = fictionalApproval();
  const { store, reads } = sentinelStore();
  project({ learner, store, content: EMPTY }, { panel: { environment: 'production' } });
  await mount(routes, { initialUrl: '/unit-a-pilot' });
  await screen.findByText('Materi sedang disiapkan');
  expect(screen).toHavePathname('/');
  expect(absent(['beta-starter-start', 'beta-starter-open', 'pilot-lesson'])).toEqual([]);
  expect(reads).toEqual([]);
});

it('pending review: direct /consent cannot bypass review even when the legacy content projection is nonempty', async () => {
  project({ content: { empty: false, unreviewed: false }, learner: null });
  await mount(routes, { initialUrl: '/consent' });
  await screen.findByText('Materi awal sedang ditinjau');
  expect(screen).toHavePathname('/');
  expect(screen.queryByTestId('consent-adult')).toBeNull();
  expect(mockApp.giveConsent).not.toHaveBeenCalled();
  expect(mockApp.createLearner).not.toHaveBeenCalled();
});

it('fictional approved review: the beta starter screen labels itself as private beta, never as an unreviewed draft', async () => {
  mockStarterReview = fictionalApproval();
  const store = new KvStore(memoryKv());
  await store.init();
  project({ content: EMPTY, learner, store, dataset: 'guest' });
  await mount(routes, { initialUrl: '/unit-a-pilot' });
  await screen.findByTestId('pilot-lesson', {}, { timeout: 3000 });
  expect(screen.queryAllByText(/Draf belum ditinjau/i)).toHaveLength(0);
  expect(screen.getByText('Beta privat · hasil sementara')).toBeTruthy();
});

it('fictional approved review, account dataset without a local learner: /consent routes to /account, not the guest consent form', async () => {
  mockStarterReview = fictionalApproval();
  // Stub account route: only the pathname is under test; the real account/profile consent stays in AccountContext.
  const AccountStub = () => null;
  project({ content: EMPTY, learner: null, dataset: 'account' });
  await mount({ ...routes, account: AccountStub }, { initialUrl: '/consent' });
  await waitFor(() => expect(screen).toHavePathname('/account'));
  expect(absent(['consent-adult', 'consent-agree', 'consent-continue'])).toEqual([]);
  expect(mockApp.giveConsent).not.toHaveBeenCalled();
  expect(mockApp.createLearner).not.toHaveBeenCalled();
});
