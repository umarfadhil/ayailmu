import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { PRIVATE_QA_REGISTRATION_POLICY } from '@/account/privateQa';
import Account from '@/app/account';
import Home from '@/app/index';
import type { PrivateQaNetworkFailure } from '@/auth/privateQaNetwork';
import type { AccountPanelProps } from '@/ui/account/AccountPanel';
import type { RegistrationPanelModel } from '@/ui/account/RegistrationPanel';

// MOCK PROJECTION / TEST FIXTURES, NOT NATIVE PROOF. The real Home and Account routes run under Expo Router's testing
// library, with the real loadSupabaseConfig environment checks and the real AccountPanel. Only the AppContext,
// AccountContext and useLearning hooks are replaced with fixed values, and the device port (the OS boundary) is a
// recorder that is never expected to be asked. "Ready" and "unavailable" here are what the account projection claims,
// not a bound native transport: nothing builds a client, loads a native module or CA, makes a request, signs in,
// registers or sends email. The routes have to trust the validated environment, and a private projection only within it.
let mockApp: Record<string, unknown> = {};
let mockAccount: Record<string, unknown> = {};
const mockDeviceCalls: unknown[] = [];
jest.mock('@/ui/AppContext', () => ({ ...jest.requireActual('@/ui/AppContext'), useApp: () => mockApp }));
jest.mock('@/ui/AccountContext', () => ({ ...jest.requireActual('@/ui/AccountContext'), useAccount: () => mockAccount }));
jest.mock('@/ui/useLearning', () => ({ ...jest.requireActual('@/ui/useLearning'), useLearning: () => null }));
jest.mock('@/auth/privateQaDevice', () => ({
  devicePrivateQaNetwork: (config: unknown) => {
    mockDeviceCalls.push(config);
    return { state: 'unavailable', reason: 'native' };
  },
}));

/** The context's private projection, until AccountContextValue names it (as in AccountContext.privateQa.test.tsx). */
type PrivateProjection = { privateQa?: true; unavailableReason?: PrivateQaNetworkFailure };
type Projection = Record<string, unknown> & PrivateProjection;

const routes = { index: Home, account: Account };
const ENV_KEYS = [
  'EXPO_PUBLIC_APP_MODE',
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_PRIVATE_QA',
  'EXPO_PUBLIC_ACCOUNT_REGISTRATION',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;
/** Test fixture: the private native QA profile, exactly as fixed (tester mode, two HTTPS loopback roots). */
const PRIVATE: Env = {
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'private-qa',
  EXPO_PUBLIC_PRIVATE_QA: 'on',
  EXPO_PUBLIC_API_BASE_URL: 'https://localhost:58444',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://localhost:58445',
};
/** Test fixture: a valid ordinary local profile (no account environment, loopback API and auth). */
const LOCAL: Env = {
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321',
};
/** Test fixture: an ordinary tester build with no account provider at all. */
const ACCOUNTS_OFF: Env = { EXPO_PUBLIC_APP_MODE: 'tester' };
let saved: Env = {};
const setEnv = (env: Env) => {
  // process.env stringifies undefined, so an undefined value means "unset".
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
};

const EMPTY = { empty: true, unreviewed: false };
const EMPTY_NOTICE = /^(Materi sedang disiapkan|Belum ada materi yang disetujui untuk uji coba)$/;
const LEGACY_EMPTY = 'Belum ada materi yang disetujui untuk uji coba';
const UNAVAILABLE_TEXT = 'Koneksi akun belum tersedia di build ini.';
const DISABLED_FALLBACK = 'Akun lokal tidak aktif di build ini. Belajar tetap bisa tanpa akun; data tetap di perangkat ini.';
/** A fake exception, CA path, fingerprint, origin and setting name: none of it may reach the screen. */
const LEAK_SENTINEL = 'TypeError: EXPO_PUBLIC_SECRET /data/user/0/private-qa/ca.pem sha256 https://localhost:58445';
const LEAKS = [
  /localhost/i, /5844\d/, /https?:\/\//i, /\.(pem|crt|cer|der|p12)\b/i, /sha-?256/i, /\bCA\b/, /certificate|sertifikat/i,
  /\bnative\b/i, /\bbinding\b/i, /error|exception/i, /EXPO_PUBLIC_/, /secret|rahasia/i,
];

/** A minimal valid signed-out private panel: idle private-policy registration, every callback a recorder. */
function readyPanel(): AccountPanelProps {
  const registration: RegistrationPanelModel = {
    stage: 'idle', busy: false, email: null, message: null, error: null, available: true, emailPolicy: PRIVATE_QA_REGISTRATION_POLICY,
    onStart: jest.fn(), onRegister: jest.fn(), onUseCode: jest.fn(), onConfirm: jest.fn(), onResend: jest.fn(), onCancel: jest.fn(), onSignIn: jest.fn(),
  };
  return {
    account: null, busy: null, error: null, environment: 'private-qa', registration,
    onSubmit: jest.fn(), onGuestCopy: jest.fn(), onGuestSkip: jest.fn(), onLinkProfile: jest.fn(), onCreateProfile: jest.fn(),
    onSyncNow: jest.fn(), onKeepLocalPrefs: jest.fn(), onUseServerPrefs: jest.fn(), onSignOut: jest.fn(),
  };
}
const ready = (): Projection => ({ enabled: true, privateQa: true, panel: readyPanel() });
const unavailable = (reason: PrivateQaNetworkFailure): Projection => ({
  enabled: false, privateQa: true, unavailableReason: reason, panel: { environment: 'private-qa', error: LEAK_SENTINEL },
});

function project(account: Projection, app: Record<string, unknown> = {}) {
  mockApp = {
    ready: true, error: null, readOnly: null, flash: null, setFlash: jest.fn(), updateLearner: jest.fn(), dataset: 'guest',
    rules: { mode: 'tester', session_minutes_options: [10, 15, 20] }, content: EMPTY, learner: null, ...app,
  };
  mockAccount = { enabled: false, signedIn: false, connected: false, dataControls: false, deletion: false, panel: {}, ...account };
}

/** No learner, lesson, completion or approved material is fabricated for the empty gate. */
function expectNothingInvented() {
  expect(screen.queryAllByText(EMPTY_NOTICE)).toHaveLength(1);
  for (const id of ['welcome-start', 'welcome-preview', 'start-session', 'home-summary', 'unit-title', 'home-hero', 'session-status', 'next-due']) {
    expect(screen.queryByTestId(id)).toBeNull();
  }
  expect(screen.queryAllByText(/Sesi hari ini selesai|Mulai sesi|Lanjutkan sesi/)).toHaveLength(0);
  expect(mockApp.updateLearner).not.toHaveBeenCalled();
}

function expectNoLeak() {
  for (const pattern of LEAKS) {
    const found = { pattern: String(pattern), text: screen.queryAllByText(pattern).length, label: screen.queryAllByLabelText(pattern).length };
    expect(found).toEqual({ pattern: String(pattern), text: 0, label: 0 });
  }
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  mockDeviceCalls.length = 0;
  setEnv(PRIVATE);
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.restoreAllMocks();
});

it.each([
  ['ready', () => ready()],
  ['unavailable (certificate)', () => unavailable('certificate')],
  ['unavailable (native)', () => unavailable('native')],
] as const)('validated private empty-content Home offers the account entry when %s, and it routes to /account, nothing invented', async (_name, projection) => {
  project(projection());
  await renderRouter(routes, { initialUrl: '/' });
  await screen.findByText(EMPTY_NOTICE);
  expectNothingInvented();
  await fireEvent.press(screen.getByTestId('welcome-account'));
  await waitFor(() => expect(screen).toHavePathname('/account'));
  expect(mockApp.updateLearner).not.toHaveBeenCalled();
  expect(mockDeviceCalls).toEqual([]);
});

it.each(['certificate', 'native'] as const)(
  'unavailable private account route (%s) states only that the connection is not in this build, with no form or leak, and Back works',
  async (reason) => {
    project(unavailable(reason));
    await renderRouter(routes, { initialUrl: '/account' });
    await screen.findByText(UNAVAILABLE_TEXT);
    // No normal sign-in or registration form, and nothing from the (sentinel) panel.
    for (const id of [
      'account-panel', 'account-form', 'account-email', 'account-password', 'account-submit', 'account-google', 'account-error',
      'account-registration-start', 'account-registration', 'account-recovery-start', 'account-data-open',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByLabelText('Kata sandi')).toBeNull();
    // Not the ordinary local fallback, and no promise that learning is there.
    expect(screen.queryAllByText(/Akun lokal/i)).toHaveLength(0);
    expect(screen.queryAllByText(/Belajar tetap bisa|bisa belajar|lanjut belajar|materi tersedia/i)).toHaveLength(0);
    expectNoLeak();
    await fireEvent.press(screen.getByLabelText('Kembali ke beranda'));
    await waitFor(() => expect(screen).toHavePathname('/'));
    expect(mockDeviceCalls).toEqual([]);
  },
);

it('ready private account route renders the actual AccountPanel with ordinary email sign-in, no .test or development wording', async () => {
  const panel = readyPanel();
  project({ enabled: true, privateQa: true, panel });
  await renderRouter(routes, { initialUrl: '/account' });
  await screen.findByTestId('account-panel');
  expect(screen.getByTestId('account-form')).toBeTruthy();
  expect(screen.getByLabelText('Email')).toBeTruthy();
  expect(screen.getByPlaceholderText('nama@contoh.com')).toBeTruthy();
  expect(screen.getByLabelText('Kata sandi')).toBeTruthy();
  // Empty fields: the submit is offered but cannot run; no sign-in success is faked or attempted.
  expect(screen.getByTestId('account-submit')).toBeDisabled();
  expect(screen.getByTestId('account-status')).toHaveTextContent('Belum masuk');
  expect(screen.getByTestId('account-registration-start')).toBeTruthy();
  expect(screen.queryByText(UNAVAILABLE_TEXT)).toBeNull();
  expect(screen.queryAllByText(/\.test\b/)).toHaveLength(0);
  expect(screen.queryByPlaceholderText(/\.test\b/)).toBeNull();
  expect(screen.queryAllByText(/\buji\b|pengembangan|development|developer/i)).toHaveLength(0);
  expect(panel.onSubmit).not.toHaveBeenCalled();
  expect(panel.registration?.onRegister).not.toHaveBeenCalled();
  expect(mockDeviceCalls).toEqual([]);
});

it.each([
  ['local', LOCAL],
  ['accounts-off', ACCOUNTS_OFF],
] as const)('ordinary disabled %s account route keeps the exact previous fallback', async (_name, env) => {
  setEnv(env);
  project({ enabled: false });
  await renderRouter(routes, { initialUrl: '/account' });
  await screen.findByTestId('account-disabled');
  expect(screen.getByText(DISABLED_FALLBACK)).toBeTruthy();
  expect(screen.queryByText(UNAVAILABLE_TEXT)).toBeNull();
  expect(screen.queryByTestId('account-form')).toBeNull();
});

it('ordinary empty-content tester Home gains no account entry, nor does a forged private projection or an unvalidated private profile', async () => {
  const cases: { name: string; env: Env; account: Projection }[] = [
    { name: 'local enabled', env: LOCAL, account: { enabled: true, panel: {} } },
    { name: 'local disabled', env: LOCAL, account: { enabled: false } },
    { name: 'accounts off', env: ACCOUNTS_OFF, account: { enabled: false } },
    // Forged: the projection claims the private capability, the real environment is ordinary.
    { name: 'forged unavailable under local', env: LOCAL, account: unavailable('certificate') },
    { name: 'forged ready under local', env: LOCAL, account: ready() },
    { name: 'forged unavailable, accounts off', env: ACCOUNTS_OFF, account: unavailable('native') },
    // Unvalidated: the private profile named, but not the whole fixed shape.
    { name: 'private flag unset', env: { ...PRIVATE, EXPO_PUBLIC_PRIVATE_QA: undefined }, account: unavailable('native') },
    { name: 'private API drifted', env: { ...PRIVATE, EXPO_PUBLIC_API_BASE_URL: 'https://localhost:58446' }, account: ready() },
    { name: 'private with production flag', env: { ...PRIVATE, EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on' }, account: ready() },
  ];
  for (const c of cases) {
    setEnv(c.env);
    project(c.account);
    await renderRouter(routes, { initialUrl: '/' });
    await screen.findByText(LEGACY_EMPTY);
    expect({ name: c.name, entry: screen.queryByTestId('welcome-account') !== null }).toEqual({ name: c.name, entry: false });
    expectNothingInvented();
  }
  expect(mockDeviceCalls).toEqual([]);
});
