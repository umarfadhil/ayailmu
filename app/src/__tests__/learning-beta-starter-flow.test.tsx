import { fireEvent, screen } from '@testing-library/react-native';
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
import { starterBeta } from '@/pilot/unitA/StarterHome';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';
import { sha256Hex } from '@/sync/sha256';

// Learning beta twin of private-beta-starter-flow.test.tsx: the same starter, gates and screens under the normal-email
// learning beta profile (LEARNING_BETA on, PRIVATE_BETA explicitly off). MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF.
// Only the AppContext, AccountContext and useLearning hooks are replaced, with fixed values; the screens, routing, the
// real env config, the real review verifier, the real Unit A controller and a real KvStore run. The compiled
// UNIT_A_STARTER_REVIEW is swapped for a per-test record: an explicit pending TEST FIXTURE by default (the actual compiled
// record is now approved, so it cannot serve as the pending case), or a FICTIONAL approval built below for the reviewed
// cases. The actual compiled record is an owner-authorized, AI-only trial acceptance of the current content: not human or
// expert review, not 3 independent people, and no efficacy, native or backend proof. The content stays a synthetic,
// constructed draft, and these mocks and fixtures are not backend proof; no account, mail or network is used.
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
const OFF_KEYS = [
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_PRIVATE_QA',
  'EXPO_PUBLIC_PRIVATE_BETA',
  'EXPO_PUBLIC_ACCOUNT_REGISTRATION',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_PASSWORD_RECOVERY',
] as const;
const ENV_KEYS = [
  'EXPO_PUBLIC_LEARNING_BETA',
  'EXPO_PUBLIC_APP_MODE',
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  ...OFF_KEYS,
] as const;
type EnvKey = (typeof ENV_KEYS)[number];
type Env = Partial<Record<EnvKey, string>>;
/** Test fixture: the explicit learning beta profile (tester, local-supabase, every other surface explicitly off), fixture https roots. */
const LEARNING: Env = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'learning-beta',
  EXPO_PUBLIC_LEARNING_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_PRIVATE_BETA: 'off',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'off',
  EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
  EXPO_PUBLIC_PASSWORD_RECOVERY: 'off',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.beta.example.com',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.beta.example.com',
};
const change = (key: EnvKey, value: string | undefined): Env => ({ [key]: value });
/** Invalid profiles: each one differs from LEARNING in exactly one setting. A missing off switch is not off. */
const INVALID: [string, Env][] = [
  ['LEARNING_BETA is missing', change('EXPO_PUBLIC_LEARNING_BETA', undefined)],
  ['LEARNING_BETA is not exactly on', change('EXPO_PUBLIC_LEARNING_BETA', 'true')],
  ['APP_MODE is developer-demo', change('EXPO_PUBLIC_APP_MODE', 'developer-demo')],
  ['AUTH_PROVIDER is missing', change('EXPO_PUBLIC_AUTH_PROVIDER', undefined)],
  ['AUTH_PROVIDER is another provider', change('EXPO_PUBLIC_AUTH_PROVIDER', 'firebase')],
  ['ACCOUNT_ENV is production', change('EXPO_PUBLIC_ACCOUNT_ENV', 'production')],
  ['API origin is http', change('EXPO_PUBLIC_API_BASE_URL', 'http://api.beta.example.com')],
  ['Auth origin is missing', change('EXPO_PUBLIC_SUPABASE_AUTH_URL', undefined)],
  ['Auth origin equals the API origin', change('EXPO_PUBLIC_SUPABASE_AUTH_URL', 'https://api.beta.example.com')],
  ...OFF_KEYS.flatMap((key): [string, Env][] => [
    [`${key} is missing`, change(key, undefined)],
    [`${key} is on`, change(key, 'on')],
  ]),
];
/** The few invalid profiles also rendered through Home and Consent; every one is checked through starterBeta. */
const RENDERED: Env[] = [
  change('EXPO_PUBLIC_LEARNING_BETA', undefined),
  change('EXPO_PUBLIC_PRIVATE_BETA', undefined),
  change('EXPO_PUBLIC_ACCOUNT_REGISTRATION', 'on'),
  change('EXPO_PUBLIC_SUPABASE_AUTH_URL', 'https://api.beta.example.com'),
];
let saved: Env = {};
const setEnv = (env: Env) => {
  // process.env stringifies undefined, so an undefined value means "unset".
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
};

/** FICTIONAL approval of the exact draft content, a per-test fixture for the same generic validator; not a real review. */
function fictionalApproval() {
  return {
    status: 'approved-for-trial',
    contentVersion: PILOT_CONTENT.contentVersion,
    contentSha256: sha256Hex(JSON.stringify(PILOT_CONTENT)),
    reviews: {
      arabic: { reviewer: 'FICTIONAL FIXTURE, not a real Arabic review', reviewedAt: '2026-10-20T09:00:00.000Z' },
      indonesian: { reviewer: 'FICTIONAL FIXTURE, not a real Indonesian review', reviewedAt: '2026-10-21T09:00:00.000Z' },
      assessment: { reviewer: 'FICTIONAL FIXTURE, not a real assessment review', reviewedAt: '2026-10-22T09:00:00.000Z' },
    },
  };
}

/** The actual compiled record's current content fingerprint and review timestamp (all 3 sections). */
const ACTUAL_SHA256 = '5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e';
const ACTUAL_REVIEWED_AT = '2026-10-30T10:25:22.000Z';

/** EXPLICIT PENDING TEST FIXTURE, not the compiled record: pending behavior needs a pending review and the actual one is approved. */
const pendingFixture = () => ({ status: 'pending' as const });

/**
 * Pre/postcondition on the ACTUAL compiled record, which no test here may change: approved-for-trial for the current
 * content fingerprint, by one AI-only coordinating reviewer in all 3 sections. Not human or expert review, not 3
 * independent people and no efficacy, native or backend proof; the actual content itself stays a synthetic, constructed draft.
 */
function expectActualCompiledApproval() {
  const section = { reviewer: expect.stringMatching(/\/root\/check_fasih_expo.*AI-only/), reviewedAt: ACTUAL_REVIEWED_AT };
  expect(actualReview.UNIT_A_STARTER_REVIEW).toMatchObject({
    status: 'approved-for-trial',
    contentSha256: ACTUAL_SHA256,
    reviews: { arabic: section, indonesian: section, assessment: section },
  });
  expect(actualReview.unitAContentFingerprint()).toBe(ACTUAL_SHA256);
  expect(actualReview.starterReviewAccess(actualReview.UNIT_A_STARTER_REVIEW)).toEqual({ allowed: true });
  expect(PILOT_CONTENT).toMatchObject({ synthetic: true, constructed: true, reviewStatus: 'draft' });
}

/** Test fixture learner (never created by the screens under test). */
const learner: Learner = {
  learner_id: 'learning-beta-fixture', created_at: '2026-01-01T00:00:00.000Z', consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: [],
};
/** The current active content projection: empty (nothing approved for the legacy path). */
const EMPTY = { empty: true, unreviewed: false };
/** A projection that claims the learning beta; it is ignored, only the real build configuration and review count. */
const CLAIM = { panel: { environment: 'staging' }, privateBeta: true, learningBeta: true, provider: 'local-supabase', beta: { enabled: true } };

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
  expectActualCompiledApproval();
  expect(actualReview.starterReviewAccess(fictionalApproval())).toEqual({ allowed: true });
});
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  setEnv(LEARNING);
  // Explicit pending TEST FIXTURE by default, not the (now approved) actual compiled record; approved cases set their own.
  mockStarterReview = pendingFixture();
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.restoreAllMocks();
});
afterAll(() => {
  // The fixtures never touch the source: the actual compiled record is unchanged and the content is still a synthetic draft.
  expectActualCompiledApproval();
});

it('learning beta Home with an explicit pending review TEST FIXTURE shows the branded review state and the account entry, no study CTA', async () => {
  expect(starterReviewAccess()).toMatchObject({ allowed: false });
  expect(starterBeta('tester')).toBe('pending');
  expect(starterBeta('developer-demo')).toBe('off');
  for (const initialUrl of ['/', '/?review=approved-for-trial&starter=approved&learning-beta=on']) {
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

it('explicit pending TEST FIXTURE: direct /unit-a-pilot and /consent, query spoofing included, never read storage, teach or create a learner', async () => {
  const spoof = 'review=approved-for-trial&approved=1&learning-beta=on&dataset=account';
  for (const initialUrl of ['/unit-a-pilot', `/unit-a-pilot?${spoof}`]) {
    const { store, reads } = sentinelStore();
    project({ learner, store, content: EMPTY });
    await mount(routes, { initialUrl });
    expect((await screen.findAllByText(/ditinjau/i)).length).toBeGreaterThan(0);
    expect(absent(['pilot-lesson', 'pilot-question', 'pilot-loading', 'pilot-unavailable', 'pilot-blocked', 'start-session'])).toEqual([]);
    expect(screen.queryAllByText(/pengembang/i)).toHaveLength(0);
    expect(reads).toEqual([]);
    expect(mockApp.updateLearner).not.toHaveBeenCalled();
  }
  for (const initialUrl of ['/consent', `/consent?${spoof}`]) {
    project({ content: EMPTY, learner: null });
    await mount(routes, { initialUrl });
    await screen.findByText('Materi awal sedang ditinjau');
    expect(screen).toHavePathname('/');
    expect(screen.queryByTestId('consent-adult')).toBeNull();
    expect(mockApp.giveConsent).not.toHaveBeenCalled();
    expect(mockApp.createLearner).not.toHaveBeenCalled();
  }
});

it('an account or provider projection claiming learning beta and approval cannot make an explicit pending TEST FIXTURE starter reviewed', async () => {
  const claim = { ...CLAIM, starterReview: 'approved-for-trial', approved: true };
  expect(starterBeta('tester')).toBe('pending');
  project({ content: EMPTY, learner: null }, claim);
  await mount(routes, { initialUrl: '/' });
  await screen.findByText('Materi awal sedang ditinjau');
  expect(absent(STUDY_IDS)).toEqual([]);
  project({ content: EMPTY, learner: null }, claim);
  await mount(routes, { initialUrl: '/consent' });
  await screen.findByText('Materi awal sedang ditinjau');
  expect(screen).toHavePathname('/');
  expect(mockApp.createLearner).not.toHaveBeenCalled();
});

it('fictional approved review: Home offers only Unit A, Mulai to /consent without a learner and Buka Unit A to /unit-a-pilot with one', async () => {
  mockStarterReview = fictionalApproval();
  expect(starterBeta('tester')).toBe('reviewed');
  expect(starterBeta('developer-demo')).toBe('off');
  const legacy = ['welcome-start', 'welcome-preview', 'start-session', 'home-hero', 'home-path', 'unit-a-pilot-entry', 'open-dev'];
  const states = [
    { who: null, shown: 'beta-starter-start', other: 'beta-starter-open', target: '/consent' },
    { who: learner, shown: 'beta-starter-open', other: 'beta-starter-start', target: '/unit-a-pilot' },
  ];
  for (const { who, shown, other, target } of states) {
    project({ content: EMPTY, learner: who });
    await mount(routes, { initialUrl: '/' });
    await screen.findByTestId(shown);
    expect(brandShown()).toBe(true);
    expect(absent([...legacy, other])).toEqual([]);
    expect(screen.queryAllByText(/Unit B/)).toHaveLength(0);
    expect(screen.queryAllByText(/Pelajaran berikutnya/)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId(shown));
    expect(push).toHaveBeenCalledWith(target);
    expect(push).not.toHaveBeenCalledWith('/next-lesson');
    expect(mockApp.createLearner).not.toHaveBeenCalled();
    expect(mockApp.giveConsent).not.toHaveBeenCalled();
  }
});

it.each(['guest', 'account'])(
  'fictional approved review: /unit-a-pilot runs the real controller on a real KvStore, owner-bound to the %s dataset, never to a next lesson',
  async (dataset) => {
    mockStarterReview = fictionalApproval();
    const store = new KvStore(memoryKv());
    await store.init();
    await store.saveLearner(learner);
    // Simulated hook projection of the real AppContext binding: the dataset is live only while this exact store, dataset and
    // learner are the current ones and the app is not read-only. The screen's (datasetActive ?? inactive) guard is untouched.
    project({
      content: EMPTY, learner, store, dataset, answersSaved: jest.fn(),
      datasetActive: () => mockApp.store === store && mockApp.dataset === dataset && mockApp.learner === learner && mockApp.readOnly === null,
    });
    await mount(routes, { initialUrl: '/unit-a-pilot' });
    await screen.findByTestId('pilot-lesson', {}, { timeout: 3000 });
    expect(screen).toHavePathname('/unit-a-pilot');
    expect(absent(['pilot-unavailable', 'pilot-blocked', 'pilot-next-lesson', 'start-session'])).toEqual([]);
    expect(screen.queryAllByText(/Pelajaran berikutnya/)).toHaveLength(0);
    expect(push).not.toHaveBeenCalledWith('/next-lesson');
    // The controller made the lesson durable first, bound to this dataset and learner.
    const meta = await store.getMeta(PILOT_META_KEY);
    expect(JSON.parse(meta ?? 'null')).toMatchObject({ owner: `${dataset}:${learner.learner_id}`, contentVersion: PILOT_CONTENT.contentVersion });
    expect(mockApp.createLearner).not.toHaveBeenCalled();
  }
);

it.each(INVALID)('starterBeta stays off when %s, even with a fictional approval', (_name, invalid) => {
  mockStarterReview = fictionalApproval();
  setEnv({ ...LEARNING, ...invalid });
  expect(starterBeta('tester')).toBe('off');
  expect(starterBeta('developer-demo')).toBe('off');
});

it('invalid learning beta config never opens the starter through Home or Consent, even with an approval and a projection claiming it', async () => {
  mockStarterReview = fictionalApproval();
  for (const invalid of RENDERED) {
    setEnv({ ...LEARNING, ...invalid });
    project({ content: EMPTY, learner: null }, CLAIM);
    await mount(routes, { initialUrl: '/' });
    await screen.findByText('Belum ada materi yang disetujui untuk uji coba');
    expect(screen.queryByText('Materi awal sedang ditinjau')).toBeNull();
    expect(absent(['beta-starter-start', 'beta-starter-open'])).toEqual([]);

    project({ content: EMPTY, learner: null }, CLAIM);
    await mount(routes, { initialUrl: '/consent' });
    await screen.findByText('Belum ada materi yang disetujui untuk uji coba');
    expect(screen).toHavePathname('/');
    expect(mockApp.giveConsent).not.toHaveBeenCalled();
    expect(mockApp.createLearner).not.toHaveBeenCalled();
  }
});
