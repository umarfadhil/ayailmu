import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import Settings from '@/app/settings';
import type { Learner } from '@/storage/types';

// MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF. Only useApp and useAccount are replaced; Settings,
// isReleasePresentation and loadSupabaseConfig run for real. UI-only cleanup: no consent approval or version migration.
let mockApp: Record<string, unknown> = {};
let mockAccount: Record<string, unknown> = {};
jest.mock('@/ui/AppContext', () => ({ ...jest.requireActual('@/ui/AppContext'), useApp: () => mockApp }));
jest.mock('@/ui/AccountContext', () => ({ ...jest.requireActual('@/ui/AccountContext'), useAccount: () => mockAccount }));

const ENV_KEYS = ['EXPO_PUBLIC_APP_MODE', 'EXPO_PUBLIC_AUTH_PROVIDER', 'EXPO_PUBLIC_ACCOUNT_ENV', 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL'] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;
const PRODUCTION: Env = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.example.org',
};
const LOCAL: Env = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321' };
const STAGING: Env = { ...PRODUCTION, EXPO_PUBLIC_ACCOUNT_ENV: 'staging', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: undefined };
let saved: Env = {};
const setEnv = (env: Env) => {
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
};

/** Test fixture learner; midday UTC so the displayed local date is stable across time zones. */
const learner: Learner = {
  learner_id: 'consent-metadata-fixture', created_at: '2026-03-15T12:00:00.000Z', consent_version: 'draft-production-account-sync-consent-0.1',
  consent_at: '2026-03-15T12:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: [],
};
const snapshot = JSON.parse(JSON.stringify(learner)) as Learner;
const date = new Date(learner.consent_at).toLocaleDateString('id-ID');

async function renderSettings(environment: string) {
  mockApp = {
    ready: true, error: null, readOnly: null, flash: null, setFlash: jest.fn(), updateLearner: jest.fn(), giveConsent: jest.fn(),
    createLearner: jest.fn(), dataset: 'guest', rules: { mode: 'tester', session_minutes_options: [10, 15, 20] },
    content: { empty: false, unreviewed: false, synthetic: false, approved: true }, learner,
  };
  mockAccount = { enabled: true, signedIn: true, connected: true, dataControls: true, deletion: true, panel: { environment } };
  await renderRouter({ settings: Settings }, { initialUrl: '/settings' });
  await screen.findByText('Pengaturan');
}
const nothingPersisted = () => {
  for (const fn of ['updateLearner', 'giveConsent', 'createLearner']) expect(mockApp[fn]).not.toHaveBeenCalled();
  expect(learner).toEqual(snapshot);
};

beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => { setEnv(saved); jest.restoreAllMocks(); });

it('genuine release Settings shows the consent date only, never the raw technical version ID', async () => {
  setEnv(PRODUCTION);
  await renderSettings('production');
  expect(screen.getByText('Persetujuan')).toBeTruthy();
  expect(screen.getAllByText(date, { exact: false }).length).toBeGreaterThan(0);
  expect(screen.queryAllByText(learner.consent_version, { exact: false })).toHaveLength(0);
  expect(screen.queryAllByText(/\b(?:demo|draft)-/)).toHaveLength(0);
  // Deletion and sync/privacy statements stay intact.
  expect(screen.getByTestId('settings-account-data')).toBeTruthy();
  expect(screen.getByText('Data tamu tetap terpisah dari akun.')).toBeTruthy();
  expect(screen.getByText('Jawaban dan pengaturan dikirim ke layanan akun saat Anda menekan «Sinkronkan sekarang».')).toBeTruthy();
  nothingPersisted();
});

it('legacy local and staging Settings keep the original version and date text', async () => {
  for (const [env, environment] of [[LOCAL, 'local'], [STAGING, 'staging']] as const) {
    setEnv(env);
    await renderSettings(environment);
    expect(screen.getByText(`Versi ${learner.consent_version} · ${date}`)).toBeTruthy();
    nothingPersisted();
  }
});
