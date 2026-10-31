// The account panel only says what its build can keep. No remote-service panel (production, staging, private QA,
// learning beta) promises that learning works without an account; the private QA build is not the local service; and a
// connected profile without verified sync progress shows its count as unavailable, never a stale legacy number.
// All fixtures are fictional.
import { render, screen } from '@testing-library/react-native';

import type { AccountSyncProgress } from '@/sync/accountProgress';
import { AccountPanel, type AccountPanelProps, type ConnectedProfile, type RecoveryPanelModel } from '@/ui/account/AccountPanel';

// The shared UI components import the app's storage module; the panel must never open the store.
const mockOpenStore = jest.fn();
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: (...args: unknown[]) => mockOpenStore(...args),
}));

const ANI = { key: 'session-1', label: 'ani@contoh.test' };
const ENVIRONMENTS = ['production', 'staging', 'private-qa', 'learning-beta'] as const;
const GUEST_LEARNING_CLAIM = /belajar tetap bisa|tanpa akun/i;

/** A signed-out panel whose callbacks are all mocks, unless overridden. */
function panelProps(overrides: Partial<AccountPanelProps> = {}): AccountPanelProps {
  return {
    account: null,
    onSubmit: jest.fn(),
    onGuestCopy: jest.fn(),
    onGuestSkip: jest.fn(),
    onLinkProfile: jest.fn(),
    onCreateProfile: jest.fn(),
    onSyncNow: jest.fn(),
    onKeepLocalPrefs: jest.fn(),
    onUseServerPrefs: jest.fn(),
    onSignOut: jest.fn(),
    ...overrides,
  };
}

const idleRecovery = (): RecoveryPanelModel => ({
  stage: 'idle',
  busy: false,
  message: null,
  available: true,
  platform: 'native',
  onStart: jest.fn(),
  onRequest: jest.fn(),
  onUpdate: jest.fn(),
  onCancel: jest.fn(),
  onBack: jest.fn(),
});

beforeEach(() => mockOpenStore.mockClear());

/** The session note says only what is true: sign in again after a close, unless the opt-in memory is offered and chosen. */
function expectSessionNote(remembering: boolean) {
  expect(screen.queryAllByText(GUEST_LEARNING_CLAIM)).toHaveLength(0);
  expect(screen.getAllByText(/Anda perlu masuk lagi/)).toHaveLength(1);
  expect(screen.queryAllByText(/memilih mengingat sesi masuk dengan email di perangkat ini/)).toHaveLength(remembering ? 1 : 0);
}

const NOTE_CASES = ENVIRONMENTS.flatMap((environment) => [false, true].map((rememberChoice) => ({ environment, rememberChoice })));
it.each(NOTE_CASES)('$environment, remember $rememberChoice: never promises learning without an account; the session note stays truthful', async ({ environment, rememberChoice }) => {
  const view = await render(<AccountPanel {...panelProps({ environment, rememberChoice, signUp: false })} />);
  expectSessionNote(rememberChoice);
  if (rememberChoice) expect(screen.getByTestId('account-remember')).not.toBeChecked(); // opt-in: never ticked for the learner
  else expect(screen.queryByTestId('account-remember')).toBeNull();

  // The same note heads the signed-in panel.
  await view.rerender(<AccountPanel {...panelProps({ environment, rememberChoice, signUp: false, account: ANI })} />);
  expectSessionNote(rememberChoice);
  expect(mockOpenStore).not.toHaveBeenCalled();
});

it('private-qa is titled Akun with an ordinary sign-in: never the local service, no sign-up, no production or backend claim', async () => {
  const props = panelProps({ environment: 'private-qa', signUp: false });
  const view = await render(<AccountPanel {...props} />);
  expect(screen.getByTestId('account-title')).toHaveTextContent(/^Akun$/);
  expect(screen.getByTestId('account-submit')).toHaveTextContent(/Masuk/);
  expect(screen.getByTestId('account-submit')).not.toHaveTextContent(/lokal|Buat akun/i);
  expect(screen.queryByTestId('account-mode-create')).toBeNull();
  expect(screen.queryAllByText(/akun lokal|layanan lokal/i)).toHaveLength(0);
  expect(screen.queryAllByText(/produksi|production|backend|berhasil/i)).toHaveLength(0);

  // The wait for the sign-in names the account, not the local service.
  await view.rerender(<AccountPanel {...props} busy="auth" />);
  expect(screen.getByTestId('account-busy')).toHaveTextContent(/Sedang masuk/);
  expect(screen.getByTestId('account-busy')).not.toHaveTextContent(/lokal/i);
});

it('learning-beta keeps its sign-in-only restrictions, whatever the caller hands over', async () => {
  await render(<AccountPanel {...panelProps({ environment: 'learning-beta', signUp: true, recovery: idleRecovery(), onGoogle: jest.fn() })} />);
  expect(screen.getByTestId('account-title')).toHaveTextContent(/^Akun$/);
  expect(screen.getByTestId('account-submit')).toHaveTextContent(/Masuk/);
  for (const id of ['account-mode-create', 'account-mode-signin', 'account-recovery-start', 'account-google']) expect(screen.queryByTestId(id)).toBeNull();
});

// Stale legacy numbers: what an old caller still hands over beside (or instead of) the factual progress.
const LEGACY: ConnectedProfile = { label: 'Profil dewasa', syncStatus: 'Belum disinkronkan dari perangkat ini.', savedAnswers: 999, otherDeviceAnswers: 888 };
const WITHOUT_PROGRESS: { shape: string; connected: ConnectedProfile }[] = [
  { shape: 'absent', connected: { ...LEGACY } },
  { shape: 'null', connected: { ...LEGACY, progress: null } },
];
const UNAVAILABLE_CASES = ENVIRONMENTS.flatMap((environment) => WITHOUT_PROGRESS.map(({ shape, connected }) => ({ environment, shape, connected })));

it.each(UNAVAILABLE_CASES)('$environment, progress $shape: the account count is unavailable, with no legacy answer facts', async ({ environment, connected }) => {
  await render(<AccountPanel {...panelProps({ environment, account: ANI, connected })} />);
  expect(screen.getByTestId('account-progress-events')).toHaveTextContent(/^Tidak tersedia$/);
  for (const id of ['account-remote-count', 'account-progress-last-known', 'sync-queued', 'sync-blocked', 'sync-conflicts']) expect(screen.queryByTestId(id)).toBeNull();
  expect(screen.queryAllByText(/999|888/)).toHaveLength(0);
  expect(screen.queryAllByText(/\d+ jawaban/)).toHaveLength(0); // no count at all, so no zero either
  expect(screen.queryAllByText(/verifi/i)).toHaveLength(0);
  expect(screen.getByTestId('account-progress-learned')).toHaveTextContent('Belum dinilai');
  expect(mockOpenStore).not.toHaveBeenCalled();
});

const VERIFIED = {
  queued: 2,
  blocked: 0,
  conflicts: 0,
  capturePending: false,
  server: { state: 'verified', total: 7, checkedAt: '2026-10-27T12:00:00.000Z' },
} as AccountSyncProgress;

it.each(ENVIRONMENTS)('%s: a verified server total still wins over the legacy numeric fields', async (environment) => {
  await render(<AccountPanel {...panelProps({ environment, account: ANI, connected: { ...LEGACY, progress: VERIFIED } })} />);
  expect(screen.getByTestId('account-progress-events')).toHaveTextContent(/^7 jawaban$/);
  expect(screen.queryAllByText(/999/)).toHaveLength(0);
  expect(screen.queryByTestId('account-progress-last-known')).toBeNull(); // a verified count is current: nothing to add
});
