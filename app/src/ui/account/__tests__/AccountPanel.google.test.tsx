// Continue with Google in the presentational account panel, written before it (phase 10). The panel offers it only
// when its caller does (onGoogle), beside the existing password form and never instead of it; pressing it hands nothing
// over (no typed address or password) and leaves no typed password behind; it waits while the caller is busy, and is
// gone once signed in. Everything after the press belongs to the caller. The legacy panel tests stay unchanged.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AccountPanel, type AccountPanelProps } from '@/ui/account/AccountPanel';

// The shared UI components import the app's storage module; the panel must never open the store.
const mockOpenStore = jest.fn();
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: (...args: unknown[]) => mockOpenStore(...args),
}));

const SECRET = 'pw-local-only-8';

/** A signed-out panel whose callbacks are all mocks, unless overridden. */
function panelProps(overrides: Partial<AccountPanelProps> = {}): AccountPanelProps {
  return {
    account: null,
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

beforeEach(() => mockOpenStore.mockClear());

it('offers Continue with Google only when the caller does, beside the password form; pressing it hands nothing over and keeps no typed password', async () => {
  const props = panelProps();
  const view = await render(<AccountPanel {...props} />);
  // Not offered by the caller: the panel is exactly the password pilot's.
  expect(screen.queryByTestId('account-google')).toBeNull();
  expect(screen.getByTestId('account-form')).toBeTruthy();

  const onGoogle = jest.fn();
  await view.rerender(<AccountPanel {...props} onGoogle={onGoogle} />);
  const google = screen.getByTestId('account-google');
  expect(google).toHaveTextContent(/Google/);
  expect(google).toBeEnabled();
  // The password form stays as it was, next to it.
  expect(screen.getByTestId('account-email')).toBeTruthy();
  expect(screen.getByTestId('account-password')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('account-email'), 'ani@ayailmu.test');
  await fireEvent.changeText(screen.getByTestId('account-password'), SECRET);
  await fireEvent.press(screen.getByTestId('account-google'));

  expect(onGoogle).toHaveBeenCalledTimes(1);
  expect(onGoogle).toHaveBeenCalledWith(); // nothing typed is handed over
  expect(props.onSubmit).not.toHaveBeenCalled();
  expect(screen.getByTestId('account-password').props.value).toBe('');
  expect(mockOpenStore).not.toHaveBeenCalled();
});

it('waits while the caller is busy, shows its message as before, and is gone once signed in', async () => {
  const onGoogle = jest.fn();
  const props = panelProps({ onGoogle });
  const view = await render(<AccountPanel {...props} busy="auth" />);
  expect(screen.getByTestId('account-google')).toBeDisabled();
  expect(screen.getByTestId('account-busy')).toHaveTextContent(/Sedang masuk/);
  await fireEvent.press(screen.getByTestId('account-google'));
  expect(onGoogle).not.toHaveBeenCalled();

  // A refused attempt: the caller's message is the alert, and Google can be tried again.
  await view.rerender(<AccountPanel {...props} error="Masuk dengan Google dibatalkan." />);
  expect(screen.getByTestId('account-error').props.role).toBe('alert');
  expect(screen.getByTestId('account-google')).toBeEnabled();

  // Signed in (with the Google account's own address): neither the form nor the Google action is shown.
  await view.rerender(<AccountPanel {...props} account={{ key: 'google-1', label: 'ani.learner@example.com' }} />);
  expect(screen.getByTestId('account-status')).toHaveTextContent('Masuk sebagai ani.learner@example.com');
  expect(screen.queryByTestId('account-google')).toBeNull();
  expect(screen.queryByTestId('account-form')).toBeNull();
});
