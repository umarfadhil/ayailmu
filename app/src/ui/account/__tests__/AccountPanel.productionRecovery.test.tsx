// Password recovery in a production build's account panel, RED. The address form asks plainly for any address (no
// .test, local, staging or trial advice) and hands the trimmed address to the recovery controller once, never to the
// normal sign-in. On a native device the attempt now survives in the secure store, so the hint only says to open the
// link on this device; the web hint is unchanged. A recovery request refused as invalid_email goes back to the address
// with a plain message. Presentational only: no network, native module or real data.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AuthError } from '@/auth/types';
import { AccountPanel, type AccountPanelProps, type RecoveryPanelModel } from '@/ui/account/AccountPanel';
import { recoveryFailure } from '@/ui/recoveryMessages';

// The shared UI components import the app's storage module; the panel must never open the store.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: jest.fn(),
}));

/** Words of the local or staging builds that a production panel never shows. */
const NOT_PRODUCTION = /\.test|uji coba|lokal|staging/i;

/** A signed-out production panel, sign-up off, at recovery's address step on `platform`; every callback a mock. */
function productionRecovery(platform: RecoveryPanelModel['platform']) {
  const onRequest = jest.fn();
  const onSubmit = jest.fn();
  const recovery: RecoveryPanelModel = {
    stage: 'email',
    busy: false,
    message: null,
    available: true,
    platform,
    onStart: jest.fn(),
    onRequest,
    onUpdate: jest.fn(),
    onCancel: jest.fn(),
    onBack: jest.fn(),
  };
  const panel: AccountPanelProps = {
    account: null,
    environment: 'production',
    signUp: false,
    recovery,
    onSubmit,
    onGuestCopy: jest.fn(),
    onGuestSkip: jest.fn(),
    onLinkProfile: jest.fn(),
    onCreateProfile: jest.fn(),
    onSyncNow: jest.fn(),
    onKeepLocalPrefs: jest.fn(),
    onUseServerPrefs: jest.fn(),
    onSignOut: jest.fn(),
  };
  return { panel, onRequest, onSubmit };
}

it.each([
  ['web', 'Buka tautan pemulihan di tab ini, pada peramban yang sama.'],
  ['native', 'Buka tautan pemulihan di perangkat ini.'],
] as const)('production %s recovery asks plainly for an address and hands it over once, trimmed, never to the sign-in', async (platform, hint) => {
  const { panel, onRequest, onSubmit } = productionRecovery(platform);
  await render(<AccountPanel {...panel} />);
  expect(screen.getByTestId('account-recovery-email').props.placeholder).toBe('nama@contoh.com');
  expect(screen.getByText(hint)).toBeTruthy();
  expect(screen.queryAllByText(NOT_PRODUCTION)).toHaveLength(0);

  await fireEvent.changeText(screen.getByTestId('account-recovery-email'), '  learner@example.org ');
  await fireEvent.press(screen.getByTestId('account-recovery-request'));
  expect(onRequest.mock.calls).toEqual([['learner@example.org']]);
  expect(onSubmit).not.toHaveBeenCalled();
});

it('a recovery request refused as invalid_email goes back to the address with a plain message and no .test advice', () => {
  const failure = recoveryFailure(new AuthError('invalid_email'), 'request');
  expect(failure).toMatchObject({ stage: 'email', message: 'Periksa alamat email.' });
  expect(JSON.stringify(failure)).not.toMatch(NOT_PRODUCTION);
});
