import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import Settings from '@/app/settings';
import type { Learner } from '@/storage/types';

// MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF. Only useApp and useAccount are replaced; Settings, ModeNote,
// isReleasePresentation and the learning-beta config run for real. No auth, storage or network is touched.
let mockApp: Record<string, unknown> = {};
let mockAccount: Record<string, unknown> = {};
jest.mock('@/ui/AppContext', () => ({ ...jest.requireActual('@/ui/AppContext'), useApp: () => mockApp }));
jest.mock('@/ui/AccountContext', () => ({ ...jest.requireActual('@/ui/AccountContext'), useAccount: () => mockAccount }));

const ENV_KEYS = [
  'AUTH_PROVIDER', 'ACCOUNT_ENV', 'LEARNING_BETA', 'APP_MODE', 'PRODUCTION_ACCOUNTS', 'PRIVATE_QA',
  'PRIVATE_BETA', 'ACCOUNT_REGISTRATION', 'GOOGLE_SIGN_IN', 'PASSWORD_RECOVERY', 'API_BASE_URL', 'SUPABASE_AUTH_URL',
].map((key) => `EXPO_PUBLIC_${key}`);
type Env = Record<string, string | undefined>;
const LEARNING_BETA: Env = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_ACCOUNT_ENV: 'learning-beta', EXPO_PUBLIC_LEARNING_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off', EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_PRIVATE_BETA: 'off', EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'off', EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
  EXPO_PUBLIC_PASSWORD_RECOVERY: 'off', EXPO_PUBLIC_API_BASE_URL: 'https://api.beta.example.com',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.beta.example.com',
};
// Existing tester/local constants, unchanged: learning beta is off (unset), so the old presentation applies.
const LOCAL: Env = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321' };
let saved: Env = {};
const setEnv = (env: Env) => {
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
};

/** Test fixture learner; midday UTC so the displayed local date is stable across time zones. */
const learner: Learner = {
  learner_id: 'learning-beta-presentation-fixture', created_at: '2026-03-15T12:00:00.000Z', consent_version: 'draft-production-account-sync-consent-0.1',
  consent_at: '2026-03-15T12:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: [],
};
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

beforeEach(() => { saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => { setEnv(saved); jest.restoreAllMocks(); });

it('learning-beta Settings is an honest private beta: normal account and date, no prototype, raw consent ID or developer stubs', async () => {
  setEnv(LEARNING_BETA);
  await renderSettings('learning-beta');
  expect(screen.getAllByText('Akun', { exact: true }).length).toBeGreaterThan(0);
  expect(screen.getAllByText(date, { exact: false }).length).toBeGreaterThan(0);
  expect(screen.getByText(/Beta privat/)).toBeTruthy();
  expect(screen.queryAllByText(learner.consent_version, { exact: false })).toHaveLength(0);
  expect(screen.queryAllByText(/\b(?:demo|draft)-/)).toHaveLength(0);
  expect(screen.queryAllByText(/Pengingat harian/)).toHaveLength(0);
  expect(screen.queryAllByText(/Data pengembang/)).toHaveLength(0);
  expect(screen.queryAllByText(/Prototipe/)).toHaveLength(0);
});

it('tester/local Settings with learning beta off keeps the raw version, prototype note and reminder unchanged', async () => {
  setEnv(LOCAL);
  await renderSettings('local');
  expect(screen.getByText(`Versi ${learner.consent_version} · ${date}`)).toBeTruthy();
  expect(screen.getAllByText(/Prototipe/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Pengingat harian/).length).toBeGreaterThan(0);
  expect(screen.queryAllByText(/Beta privat/)).toHaveLength(0);
});
