// The account panel in a production build, RED. The panel stays presentational: the caller owns sign-in, profiles and
// sync. With environment 'production' and sign-up off it speaks plainly to a learner with an existing account: no local or
// staging words, no advice to use a .test address, no claim about mail, and no sign-up offer. The typed values still reach
// the caller once per submit with no password kept, and the adult-profile consent says where the answers go and waits for
// both explicit ticks exactly as before. It asserts no release-approved legal policy or final consent version.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AccountPanel, type AccountPanelProps } from '@/ui/account/AccountPanel';

// The shared UI components import the app's storage module; the panel must never open the store.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: jest.fn(),
}));

const LEARNER = { key: 'session-1', label: 'learner@example.org' };
const SECRET = 'fixture-password-only';
/** Words of the local or staging builds that a production panel never shows. */
const NOT_PRODUCTION = /\.test|uji coba|lokal|staging/i;

/** A signed-out production panel with sign-up off, whose callbacks are all mocks, unless overridden. */
function productionProps(overrides: Partial<AccountPanelProps> = {}): AccountPanelProps {
  return {
    account: null,
    environment: 'production',
    signUp: false,
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

it('signed out: a plain production sign-in form, without test-address advice or sign-up, hands the typed values over once', async () => {
  const props = productionProps();
  await render(<AccountPanel {...props} />);
  expect(screen.getByTestId('account-title')).toHaveTextContent(/^Akun$/);
  expect(screen.getByText('Masuk dengan akun yang sudah terdaftar. Pendaftaran belum dibuka.')).toBeTruthy();
  expect(screen.getByText('Email')).toBeTruthy();
  expect(screen.getByTestId('account-email').props.placeholder).toBe('nama@contoh.com');
  expect(screen.getByText('Isi email dan kata sandi untuk melanjutkan.')).toBeTruthy();
  expect(screen.queryByTestId('account-mode-create')).toBeNull();
  expect(screen.queryAllByText(NOT_PRODUCTION)).toHaveLength(0);
  // No claim that mail cannot be sent: no sentence pairs email with a negation.
  expect(screen.queryAllByText(/(email|surel)[^.]*\b(tidak|tak)\b|\b(tidak|tak)\b[^.]*(email|surel)/i)).toHaveLength(0);

  await fireEvent.changeText(screen.getByTestId('account-email'), 'learner@example.org');
  await fireEvent.changeText(screen.getByTestId('account-password'), SECRET);
  await fireEvent.press(screen.getByTestId('account-submit'));
  expect(calls(props.onSubmit)).toEqual([[{ mode: 'signin', email: 'learner@example.org', password: SECRET }]]);
  expect(screen.getByTestId('account-password').props.value).toBe('');
});

it('signed in: the adult-profile consent says where the answers go, starts unticked and waits for both ticks', async () => {
  const props = productionProps({ account: LEARNER, profiles: [] });
  await render(<AccountPanel {...props} />);
  expect(screen.getByTestId('profile-agree')).toHaveTextContent(/Saya setuju jawaban dan pengaturan saya dikirim ke server dan disimpan di akun ini\./);
  expect(screen.queryAllByText(NOT_PRODUCTION)).toHaveLength(0);

  for (const tick of ['profile-adult', 'profile-agree']) {
    expect(screen.getByTestId(tick)).not.toBeChecked();
    expect(screen.getByTestId('profile-create')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('profile-create')); // not yet: nothing happens
    await fireEvent.press(screen.getByTestId(tick));
    expect(screen.getByTestId(tick)).toBeChecked();
  }
  expect(calls(props.onCreateProfile)).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('profile-create'));
  expect(calls(props.onCreateProfile)).toEqual([[{ adult: true, agreed: true }]]);
});
