import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import Consent from '@/app/consent';
import Home from '@/app/index';
import NextLesson from '@/app/next-lesson';
import Settings from '@/app/settings';
import UnitAPilot from '@/app/unit-a-pilot';
import type { Learner } from '@/storage/types';

// MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF. Only the AppContext, AccountContext and useLearning hooks are
// replaced, with fixed values. The screens, ModeNote and the real loadSupabaseConfig environment checks still run.
// The account projection below can claim 'production' even when the environment says something else, which is the
// point: the screens have to trust the validated environment, not the projection. Nothing here approves bundled
// content, makes a network request, or uses a real account, SMTP or secret.
let mockApp: Record<string, unknown> = {};
let mockAccount: Record<string, unknown> = {};
jest.mock('@/ui/AppContext', () => ({ ...jest.requireActual('@/ui/AppContext'), useApp: () => mockApp }));
jest.mock('@/ui/AccountContext', () => ({ ...jest.requireActual('@/ui/AccountContext'), useAccount: () => mockAccount }));
jest.mock('@/ui/useLearning', () => ({ ...jest.requireActual('@/ui/useLearning'), useLearning: () => null }));

const routes = { index: Home, settings: Settings, consent: Consent, 'unit-a-pilot': UnitAPilot, 'next-lesson': NextLesson };
const ENV_KEYS = [
  'EXPO_PUBLIC_APP_MODE',
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;
/** Test fixture: the production profile, with distinct https API and auth origins. */
const PRODUCTION: Env = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.example.org',
};
/** Test fixture: a valid local profile (no account environment, loopback API and auth). */
const LOCAL: Env = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: undefined,
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321',
};
let saved: Env = {};
const setEnv = (env: Env) => {
  // process.env stringifies undefined, so an undefined value means "unset".
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
};

/** Test fixture learner (never created by the screens under test). */
const learner: Learner = {
  learner_id: 'release-presentation-fixture', created_at: '2026-01-01T00:00:00.000Z', consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: [],
};
const EMPTY = { empty: true, unreviewed: false };
/** Explicit approved, non-synthetic TEST fixture for Welcome only; it does not approve any bundled content. */
const APPROVED_TEST_FIXTURE = { empty: false, unreviewed: false, synthetic: false, approved: true };

function project(app: Record<string, unknown>, account: Record<string, unknown> = {}, environment = 'production') {
  mockApp = {
    ready: true, error: null, readOnly: null, flash: null, setFlash: jest.fn(), updateLearner: jest.fn(), dataset: 'guest',
    rules: { mode: 'tester', session_minutes_options: [10, 15, 20] }, content: EMPTY, learner: null, ...app,
  };
  mockAccount = {
    enabled: true, signedIn: false, connected: false, dataControls: false, deletion: false, panel: { environment }, ...account,
  };
}

const prototypeTexts = () => screen.queryAllByText(/Prototipe/);
const modeNoteShown = () => !!screen.queryByTestId('mode-note') || prototypeTexts().length > 0;
const brandShown = () => screen.queryAllByText(/AyaFasih/).length + screen.queryAllByLabelText(/AyaFasih/).length > 0;
let push: jest.SpyInstance;

/**
 * Renders, then spies on router.push. The mounted routing bridge Object.assigns a fresh imperative router onto the
 * exported `router` (and resets it on cleanup), so a spy installed before the mount is overwritten and sees no calls.
 */
async function mount(...args: Parameters<typeof renderRouter>) {
  const result = await renderRouter(...args);
  push = jest.spyOn(router, 'push').mockImplementation(() => {});
  return result;
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  setEnv(PRODUCTION);
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.restoreAllMocks();
});

it('production Home with no approved content shows the brand, a concise notice and the account entry, nothing invented', async () => {
  project({ content: EMPTY });
  await mount(routes, { initialUrl: '/' });
  await screen.findByText('Materi sedang disiapkan');
  expect(brandShown()).toBe(true);
  expect(modeNoteShown()).toBe(false);
  expect(screen.queryAllByText(/uji/i)).toHaveLength(0);
  expect(screen.queryByText('Belum ada materi yang disetujui untuk uji coba')).toBeNull();
  // No learner, lesson or material is fabricated for the empty gate.
  for (const id of ['welcome-start', 'welcome-preview', 'start-session', 'unit-title', 'home-hero']) {
    expect(screen.queryByTestId(id)).toBeNull();
  }
  await fireEvent.press(screen.getByTestId('welcome-account'));
  expect(push).toHaveBeenCalledWith('/account');
  expect(mockApp.updateLearner).not.toHaveBeenCalled();

  // Legacy tester gate stays when the production account cap is off or an origin is unsafe.
  for (const env of [{ ...PRODUCTION, EXPO_PUBLIC_PRODUCTION_ACCOUNTS: undefined }, { ...PRODUCTION, EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://auth.example.org' }]) {
    setEnv(env as Env);
    project({ content: EMPTY });
    await mount(routes, { initialUrl: '/' });
    await screen.findByText('Belum ada materi yang disetujui untuk uji coba');
    expect(screen.queryByText('Materi sedang disiapkan')).toBeNull();
    expect(modeNoteShown()).toBe(true);
  }
});

it.each(['/unit-a-pilot', '/next-lesson'])(
  'genuine tester production %s with no approved content redirects to the Home notice, no developer material',
  async (initialUrl) => {
    // Non-network sentinel store: any property read means the screen touched learner storage.
    const storeReads: string[] = [];
    const store = new Proxy({}, { get: (_t, key) => { if (typeof key === 'string') storeReads.push(key); return undefined; } });
    project({ learner, store, content: EMPTY });
    await mount(routes, { initialUrl });
    await screen.findByText('Materi sedang disiapkan');
    expect(screen).toHavePathname('/');
    expect(modeNoteShown()).toBe(false);
    expect(screen.queryAllByText(/\bpilot\b/i)).toHaveLength(0);
    expect(screen.queryAllByText(/\blab\b/i)).toHaveLength(0);
    expect(screen.queryAllByText(/Draf/)).toHaveLength(0);
    expect(storeReads).toEqual([]);
    expect(mockApp.updateLearner).not.toHaveBeenCalled();
  },
);

it('production Settings drops the placeholder reminder and empty Lainnya but keeps the data-rights warning truthful', async () => {
  // Signed in but not linked: account data controls exist, yet no connected profile is faked.
  project({ learner, content: APPROVED_TEST_FIXTURE }, { dataControls: true, signedIn: true, connected: false });
  await mount(routes, { initialUrl: '/settings' });
  await screen.findByText('Pengaturan');
  // A signed-in account must not be described as a guest whose data goes nowhere.
  expect(screen.queryByText('Tanpa akun. Data tidak dikirim ke mana pun.')).toBeNull();
  expect(screen.queryByText('Pengingat harian')).toBeNull();
  expect(screen.queryByText('Lainnya')).toBeNull();
  expect(screen.queryByTestId('open-dev')).toBeNull();
  expect(modeNoteShown()).toBe(false);
  await fireEvent.press(screen.getByTestId('settings-account-data'));
  expect(push).toHaveBeenCalledWith('/account-data');

  // Without data controls the legal gap is still stated, never hidden by the cleanup.
  project({ learner, content: APPROVED_TEST_FIXTURE }, { dataControls: false, deletion: false });
  await mount(routes, { initialUrl: '/settings' });
  await screen.findByText('Pengaturan');
  expect(screen.queryByTestId('settings-account-data')).toBeNull();
  expect(screen.getByText('Hapus data')).toBeTruthy();
  expect(screen.getByText(/Alamat kontak untuk permintaan penghapusan belum ditetapkan/)).toBeTruthy();
  expect(screen.getByText('Unduh data saya')).toBeTruthy();
  expect(screen.queryByText('Pengingat harian')).toBeNull();
});

it('validated production Welcome with an approved test fixture offers start and account without a Prototipe caption', async () => {
  project({ content: APPROVED_TEST_FIXTURE, learner: null });
  await mount(routes, { initialUrl: '/' });
  await screen.findByTestId('welcome-start');
  expect(prototypeTexts()).toHaveLength(0);
  expect(modeNoteShown()).toBe(false);
  expect(screen.queryByText(/Konten contoh/)).toBeNull();
  await fireEvent.press(screen.getByTestId('welcome-start'));
  expect(push).toHaveBeenCalledWith('/consent');
  await fireEvent.press(screen.getByTestId('welcome-account'));
  expect(push).toHaveBeenCalledWith('/account');
});

it('local, staging, forged, cap-off and developer-demo setups keep their truthful ModeNote', async () => {
  const cases: { name: string; env: Env; environment: string; mode?: string }[] = [
    { name: 'local', env: LOCAL, environment: 'local' },
    { name: 'staging', env: { ...PRODUCTION, EXPO_PUBLIC_ACCOUNT_ENV: 'staging', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: undefined }, environment: 'staging' },
    // Forged: the account projection claims production, the real (valid) environment says local.
    { name: 'forged', env: LOCAL, environment: 'production' },
    { name: 'cap-off', env: { ...PRODUCTION, EXPO_PUBLIC_PRODUCTION_ACCOUNTS: undefined }, environment: 'production' },
    { name: 'same-origin', env: { ...PRODUCTION, EXPO_PUBLIC_API_BASE_URL: 'https://auth.example.org' }, environment: 'production' },
    { name: 'developer-demo', env: PRODUCTION, environment: 'production', mode: 'developer-demo' },
  ];
  for (const c of cases) {
    setEnv(c.env);
    project({ learner, content: APPROVED_TEST_FIXTURE, rules: { mode: c.mode ?? 'tester', session_minutes_options: [10, 15, 20] } }, {}, c.environment);
    await mount(routes, { initialUrl: '/settings' });
    await screen.findByText('Pengaturan');
    expect({ name: c.name, modeNote: modeNoteShown() }).toEqual({ name: c.name, modeNote: true });
    if (c.mode === 'developer-demo') expect(screen.getByTestId('open-dev')).toBeTruthy();
  }
});

it('validated production Consent shows the plain Persetujuan heading, not the demo one, with its controls intact', async () => {
  const giveConsent = jest.fn();
  const createLearner = jest.fn();
  project({
    learner: null, content: APPROVED_TEST_FIXTURE, giveConsent, createLearner,
    rules: { mode: 'tester', session_minutes_options: [10, 15, 20], default_session_minutes: 10 },
  });
  await mount(routes, { initialUrl: '/consent' });
  await screen.findByText('Persetujuan');
  expect(screen.getByRole('header', { name: 'Persetujuan' })).toBeTruthy();
  expect(screen.queryByText('Persetujuan (versi demo)')).toBeNull();
  // The adult and agreement statements stay, and nothing can start until both are ticked.
  expect(screen.getByTestId('consent-adult')).toBeTruthy();
  expect(screen.getByTestId('consent-agree')).toBeTruthy();
  expect(screen.getByTestId('consent-continue')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('consent-continue'));
  expect(giveConsent).not.toHaveBeenCalled();
  expect(createLearner).not.toHaveBeenCalled();
});
