// The local account panel is presentational: the caller owns sign-in, profiles and sync. These tests check
// what the learner sees and what reaches the callbacks: typed values once per submit with no password kept;
// explicit ticks before guest data is copied or a profile is created; nothing private while signed out.
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { AccountPanel, type AccountPanelProps } from '@/ui/account/AccountPanel';

// The shared UI components import the app's storage module; the panel must never open the store.
const mockOpenStore = jest.fn();
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: (...args: unknown[]) => mockOpenStore(...args),
}));

const ANI = { key: 'session-1', label: 'ani@ayailmu.test' };
const BUDI = { key: 'session-2', label: 'budi@ayailmu.test' };
const SECRET = 'pw-local-only-7';

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
const calls = (callback: unknown) => (callback as jest.Mock).mock.calls;

beforeEach(() => mockOpenStore.mockClear());

it('the form hands the typed values over once per submit and keeps no password: empty again after sign-in and sign-out, never logged', async () => {
  const consoleSpies = [
    jest.spyOn(console, 'log'),
    jest.spyOn(console, 'info'),
    jest.spyOn(console, 'warn'),
    jest.spyOn(console, 'error'),
    jest.spyOn(console, 'debug'),
  ];
  try {
    const props = panelProps();
    const view = await render(<AccountPanel {...props} />);
    expect(screen.getByTestId('account-title')).toHaveTextContent('Akun lokal');
    expect(screen.getByTestId('account-status')).toHaveTextContent('Belum masuk');
    expect(screen.getByTestId('account-submit')).toBeDisabled(); // nothing typed yet

    await fireEvent.press(screen.getByTestId('account-mode-signin'));
    expect(screen.getByTestId('account-submit')).toHaveTextContent(/Masuk ke akun lokal/); // (the button also holds its icon)
    await fireEvent.changeText(screen.getByTestId('account-email'), ' ani@ayailmu.test ');
    await fireEvent.changeText(screen.getByTestId('account-password'), SECRET);
    expect(screen.getByTestId('account-password').props.secureTextEntry).toBe(true);

    // While the caller is signing in, a second submit is not possible and the wait is announced.
    await view.rerender(<AccountPanel {...props} busy="auth" />);
    expect(screen.getByTestId('account-submit')).toBeDisabled();
    expect(screen.getByTestId('account-busy')).toHaveTextContent(/Sedang masuk/);
    await view.rerender(<AccountPanel {...props} />);

    await fireEvent.press(screen.getByTestId('account-submit'));
    expect(calls(props.onSubmit)).toEqual([[{ mode: 'signin', email: 'ani@ayailmu.test', password: SECRET }]]);
    expect(screen.getByTestId('account-password').props.value).toBe('');

    // A refused attempt: the caller's message is an alert; the address stays, the password must be typed again.
    await view.rerender(<AccountPanel {...props} error="Email atau kata sandi tidak cocok." />);
    expect(screen.getByTestId('account-error').props.role).toBe('alert');
    expect(screen.getByTestId('account-error')).toHaveTextContent(/Email atau kata sandi tidak cocok\./);
    expect(screen.getByTestId('account-email').props.value).toContain('ani@ayailmu.test');
    expect(screen.getByTestId('account-password').props.value).toBe('');

    // Signed in: the form, with anything typed in it, is gone.
    await view.rerender(<AccountPanel {...props} account={ANI} />);
    expect(screen.getByTestId('account-status')).toHaveTextContent('Masuk sebagai ani@ayailmu.test');
    expect(screen.queryByTestId('account-email')).toBeNull();
    expect(screen.queryByTestId('account-password')).toBeNull();

    // Signed out again: a fresh, empty form.
    await view.rerender(<AccountPanel {...props} account={null} />);
    expect(screen.getByTestId('account-email').props.value).toBe('');
    expect(screen.getByTestId('account-password').props.value).toBe('');
    expect(calls(props.onSubmit)).toHaveLength(1);
    expect(mockOpenStore).not.toHaveBeenCalled();
    for (const spy of consoleSpies) for (const args of spy.mock.calls) expect(args.map(String).join(' ')).not.toContain(SECRET);
  } finally {
    for (const spy of consoleSpies) spy.mockRestore();
  }
});

const GATES: {
  gate: string;
  shown: Partial<AccountPanelProps>;
  ticks: string[];
  action: string;
  callback: 'onGuestCopy' | 'onCreateProfile';
  args: unknown[];
}[] = [
  { gate: 'Copying guest data', shown: { guestCopy: { answers: 2 } }, ticks: ['guest-copy-consent'], action: 'guest-copy-confirm', callback: 'onGuestCopy', args: [] },
  {
    gate: 'Creating an adult profile',
    shown: {},
    ticks: ['profile-adult', 'profile-agree'],
    action: 'profile-create',
    callback: 'onCreateProfile',
    args: [{ adult: true, agreed: true }],
  },
];
it.each(GATES)('$gate waits for every explicit tick, then calls back once; another sign-in starts unticked', async ({ shown, ticks, action, callback, args }) => {
  const props = panelProps({ account: ANI, ...shown });
  const view = await render(<AccountPanel {...props} />);
  for (const tick of ticks) {
    expect(screen.getByTestId(tick)).not.toBeChecked();
    expect(screen.getByTestId(action)).toBeDisabled();
    await fireEvent.press(screen.getByTestId(action)); // not yet: nothing happens
    await fireEvent.press(screen.getByTestId(tick));
    expect(screen.getByTestId(tick)).toBeChecked();
  }
  expect(calls(props[callback])).toHaveLength(0);
  await fireEvent.press(screen.getByTestId(action));
  expect(calls(props[callback])).toEqual([args]);

  // Another account (a new session key): no tick carries over.
  await view.rerender(<AccountPanel {...props} account={BUDI} />);
  for (const tick of ticks) expect(screen.getByTestId(tick)).not.toBeChecked();
  expect(screen.getByTestId(action)).toBeDisabled();
});

const PRIVATE = [
  'account-signout',
  'guest-copy-consent',
  'guest-copy-confirm',
  'guest-copy-skip',
  'guest-copy-result',
  'profile-choice',
  'profile-adult',
  'profile-agree',
  'profile-create',
  'profile-link-p-1',
  'sync-panel',
  'sync-status',
  'sync-now',
  'account-progress',
  'account-progress-events',
  'account-progress-learned',
  'account-remote-count',
  'prefs-conflict',
  'prefs-keep-local',
  'prefs-use-server',
];

it('signed out, nothing private is shown or offered, even when the caller passes it', async () => {
  await render(
    <AccountPanel
      {...panelProps({
        guestCopy: { answers: 3, result: '3 jawaban tamu disalin.' },
        profiles: [{ id: 'p-1', label: 'Profil dewasa · dibuat 17 Okt' }],
        connected: { label: 'Profil dewasa', syncStatus: 'Terakhir disinkronkan 10.42', savedAnswers: 12, otherDeviceAnswers: 4 },
        prefsConflict: { detail: 'Lama sesi berbeda.' },
      })}
    />
  );
  for (const id of PRIVATE) expect(screen.queryByTestId(id)).toBeNull();
  for (const text of [/Profil dewasa/, /disinkronkan/, /disalin/, /Lama sesi/, /\d+ jawaban/]) expect(screen.queryAllByText(text)).toHaveLength(0);
  expect(screen.getByTestId('account-status')).toHaveTextContent('Belum masuk');
  expect(screen.getByTestId('account-email')).toBeTruthy();
  expect(mockOpenStore).not.toHaveBeenCalled();
});

it('signed in: a profile id goes back unchanged; connected: the caller’s facts as given, a busy sync, explicit choices and sign-out', async () => {
  const OPAQUE = 'prof_8f3a-2c';
  const props = panelProps({ account: ANI, guestCopy: { answers: 0 }, profiles: [{ id: OPAQUE, label: 'Profil dewasa · dibuat 17 Okt' }] });
  const view = await render(<AccountPanel {...props} />);
  // No guest data on this device: no copy is offered.
  for (const id of ['guest-copy-consent', 'guest-copy-confirm', 'guest-copy-skip']) expect(screen.queryByTestId(id)).toBeNull();
  // Signed in and not connected: one profile chooser holds the account's profiles and the new adult profile.
  const chooser = within(screen.getByTestId('profile-choice'));
  expect(chooser.getByTestId(`profile-link-${OPAQUE}`)).toBeTruthy();
  expect(chooser.getByTestId('profile-create')).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`profile-link-${OPAQUE}`));
  expect(calls(props.onLinkProfile)).toEqual([[OPAQUE]]);
  expect(screen.queryByTestId('sync-panel')).toBeNull();

  // Guest data to copy: declining is an explicit choice too.
  await view.rerender(<AccountPanel {...props} guestCopy={{ answers: 2 }} />);
  await fireEvent.press(screen.getByTestId('guest-copy-skip'));
  expect(calls(props.onGuestSkip)).toHaveLength(1);
  expect(calls(props.onGuestCopy)).toHaveLength(0);

  const connected: AccountPanelProps = {
    ...props,
    guestCopy: { answers: 2, result: '2 jawaban tamu disalin ke profil ini.' },
    connected: { label: 'Profil dewasa', syncStatus: 'Belum disinkronkan dari perangkat ini.', savedAnswers: 12, otherDeviceAnswers: 4 },
    prefsConflict: { detail: 'Lama sesi: 15 menit di perangkat ini, 20 menit di akun.' },
  };
  await view.rerender(<AccountPanel {...connected} />);
  expect(screen.queryByTestId('profile-choice')).toBeNull();
  expect(screen.queryByTestId(`profile-link-${OPAQUE}`)).toBeNull();
  expect(screen.getByTestId('guest-copy-result')).toHaveTextContent(/2 jawaban tamu disalin ke profil ini\./);
  expect(screen.queryByTestId('guest-copy-confirm')).toBeNull();
  expect(screen.getByTestId('sync-status')).toHaveTextContent('Belum disinkronkan dari perangkat ini.');
  expect(screen.getByTestId('account-progress-events')).toHaveTextContent('12 jawaban');
  expect(screen.getByTestId('account-remote-count')).toHaveTextContent('4 jawaban');
  expect(screen.getByTestId('account-progress-learned')).toHaveTextContent('Belum dinilai');
  expect(screen.queryAllByText(/dikuasai|%|streak|otomatis/i)).toHaveLength(0);

  await fireEvent.press(screen.getByTestId('prefs-keep-local'));
  await fireEvent.press(screen.getByTestId('prefs-use-server'));
  await fireEvent.press(screen.getByTestId('sync-now'));
  expect([calls(props.onKeepLocalPrefs), calls(props.onUseServerPrefs), calls(props.onSyncNow)].map((c) => c.length)).toEqual([1, 1, 1]);

  // While syncing: no second sync, and the wait is announced; signing out stays possible.
  await view.rerender(<AccountPanel {...connected} busy="sync" />);
  expect(screen.getByTestId('sync-now')).toBeDisabled();
  expect(screen.getByTestId('account-busy')).toHaveTextContent(/menyinkronkan/);
  await fireEvent.press(screen.getByTestId('sync-now'));
  expect(calls(props.onSyncNow)).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('account-signout'));
  expect(calls(props.onSignOut)).toHaveLength(1);
});
