/**
 * Capability-note regression tests for AccountPanel.
 *
 * Targets the planned optional prop
 * `AccountPanelProps.unavailableFeatures?: { google?: string; recovery?: string }`.
 * The strings are caller-worded diagnostics only: they are not a new panel mode
 * and the panel does not interpret them.
 *
 * Tests 1 and 4 are written ahead of the implementation (the notes are not
 * rendered yet and there is no recovery capability guard), so they are the RED
 * cases. Tests 2 and 3 pin behavior that must hold before and after the change.
 * Presentational proof only: no network, no store, no provider acceptance.
 * All fixture values use example.org.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  AccountPanel,
  type AccountPanelProps,
  type RecoveryPanelModel,
} from '../AccountPanel';

jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: jest.fn(),
}));

const GOOGLE_NOTE = 'Google belum tersedia di Expo Go.';
const RECOVERY_NOTE = 'Pemulihan kata sandi belum tersedia di perangkat ini.';
const EMAIL = 'fixture@example.org';
const PASSWORD = 'fixture-only';

const makeProps = (overrides: Partial<AccountPanelProps> = {}): AccountPanelProps => ({
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
});

const makeRecovery = (overrides: Partial<RecoveryPanelModel> = {}): RecoveryPanelModel => ({
  stage: 'idle',
  busy: false,
  message: null,
  available: true,
  platform: 'web',
  onStart: jest.fn(),
  onCancel: jest.fn(),
  onRequest: jest.fn(),
  onUpdate: jest.fn(),
  onBack: jest.fn(),
  ...overrides,
});

const BOTH_NOTES = { google: GOOGLE_NOTE, recovery: RECOVERY_NOTE };

describe('AccountPanel capability notes', () => {
  it('shows both notes instead of Google/recovery controls and keeps password sign-in working', async () => {
    const props = makeProps({ unavailableFeatures: BOTH_NOTES });
    await render(<AccountPanel {...props} />);

    expect(screen.getByTestId('account-google-unavailable')).toBeTruthy();
    expect(screen.getByText(GOOGLE_NOTE)).toBeTruthy();
    expect(screen.getByTestId('account-recovery-unavailable')).toBeTruthy();
    expect(screen.getByText(RECOVERY_NOTE)).toBeTruthy();
    expect(screen.queryByTestId('account-google')).toBeNull();
    expect(screen.queryByTestId('account-recovery-start')).toBeNull();
    expect(screen.getByTestId('account-form')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('account-email'), `  ${EMAIL}  `);
    await fireEvent.changeText(screen.getByTestId('account-password'), PASSWORD);
    await fireEvent.press(screen.getByTestId('account-submit'));

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith({ mode: 'signin', email: EMAIL, password: PASSWORD });
    expect(screen.getByTestId('account-password').props.value).toBe('');
    // Typed values go to onSubmit only; no other handler (Google included) receives them.
    expect(props.onGuestCopy).not.toHaveBeenCalled();
    expect(props.onGuestSkip).not.toHaveBeenCalled();
    expect(props.onLinkProfile).not.toHaveBeenCalled();
    expect(props.onCreateProfile).not.toHaveBeenCalled();
  });

  it('hides both notes and the password form for a signed-in account', async () => {
    const props = makeProps({
      account: { key: 'fixture', label: EMAIL },
      unavailableFeatures: BOTH_NOTES,
    });
    await render(<AccountPanel {...props} />);

    expect(screen.queryByTestId('account-google-unavailable')).toBeNull();
    expect(screen.queryByTestId('account-recovery-unavailable')).toBeNull();
    expect(screen.queryByText(GOOGLE_NOTE)).toBeNull();
    expect(screen.queryByText(RECOVERY_NOTE)).toBeNull();
    expect(screen.queryByTestId('account-form')).toBeNull();
    expect(screen.queryByTestId('account-email')).toBeNull();
    expect(screen.queryByTestId('account-password')).toBeNull();
  });

  it('lets available Google and recovery override stale unavailableFeatures', async () => {
    const onGoogle = jest.fn();
    const recovery = makeRecovery();
    const props = makeProps({ onGoogle, recovery, unavailableFeatures: BOTH_NOTES });
    await render(<AccountPanel {...props} />);

    expect(screen.queryByTestId('account-google-unavailable')).toBeNull();
    expect(screen.queryByTestId('account-recovery-unavailable')).toBeNull();
    expect(screen.queryByText(GOOGLE_NOTE)).toBeNull();
    expect(screen.queryByText(RECOVERY_NOTE)).toBeNull();

    await fireEvent.press(screen.getByTestId('account-google'));
    expect(onGoogle).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('account-recovery-start'));
    expect(recovery.onStart).toHaveBeenCalledTimes(1);
  });

  it('does not show an enabled forgot-password button when recovery is unavailable', async () => {
    const recovery = makeRecovery({ available: false });
    const props = makeProps({ recovery, unavailableFeatures: { recovery: RECOVERY_NOTE } });
    await render(<AccountPanel {...props} />);

    expect(screen.queryByTestId('account-recovery-start')).toBeNull();
    expect(screen.getByTestId('account-recovery-unavailable')).toBeTruthy();
    expect(screen.getByText(RECOVERY_NOTE)).toBeTruthy();
    expect(screen.getByTestId('account-form')).toBeTruthy();
    expect(screen.getByTestId('account-email')).toBeTruthy();
    expect(screen.getByTestId('account-password')).toBeTruthy();
    expect(recovery.onStart).not.toHaveBeenCalled();
  });
});
