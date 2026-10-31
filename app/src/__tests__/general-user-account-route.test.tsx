import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import Account from '@/app/account';
import type { AccountContextValue } from '@/ui/AccountContext';
import type { RegistrationPanelModel } from '@/ui/account/RegistrationPanel';

let mockAccount: AccountContextValue;

jest.mock('@/ui/AccountContext', () => ({
  ...jest.requireActual('@/ui/AccountContext'),
  useAccount: () => mockAccount,
}));
jest.mock('@/ui/Hydration', () => ({
  HydrationGate: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/ui/BackLink', () => ({ BackLink: () => null }));
jest.mock('@/storage/openStore', () => ({ STORAGE_KIND: 'test-memory', openStore: jest.fn() }));
jest.mock('@/ui/components', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('@/ui/components'),
    Page: ({ children }: { children: ReactNode }) => React.createElement(View, null, children),
  };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));

const ENV_KEYS = ['EXPO_PUBLIC_APP_MODE', 'EXPO_PUBLIC_AUTH_PROVIDER'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.EXPO_PUBLIC_APP_MODE = 'tester';
  process.env.EXPO_PUBLIC_AUTH_PROVIDER = 'off';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const makeRegistration = (): RegistrationPanelModel => ({
  stage: 'idle',
  busy: false,
  email: null,
  message: null,
  error: null,
  available: true,
  emailPolicy: 'confirmed-email',
  onStart: jest.fn(),
  onRegister: jest.fn(),
  onUseCode: jest.fn(),
  onConfirm: jest.fn(),
  onResend: jest.fn(),
  onCancel: jest.fn(),
  onSignIn: jest.fn(),
});

const makeAccount = (enabled: boolean, registration?: RegistrationPanelModel): AccountContextValue => ({
  enabled,
  signedIn: false,
  connected: false,
  panel: {
    account: null,
    signUp: false,
    environment: 'production',
    registration,
    onSubmit: jest.fn(),
    onGuestCopy: jest.fn(),
    onGuestSkip: jest.fn(),
    onLinkProfile: jest.fn(),
    onCreateProfile: jest.fn(),
    onSyncNow: jest.fn(),
    onKeepLocalPrefs: jest.fn(),
    onUseServerPrefs: jest.fn(),
    onSignOut: jest.fn(),
  },
});

const screenText = () => JSON.stringify(screen.toJSON());

describe('general-user account route', () => {
  it('says the account service is unavailable without local-account or fake-login copy', async () => {
    mockAccount = makeAccount(false);
    await render(<Account />);

    expect(screen.getByTestId('account-disabled')).toBeTruthy();
    expect(screenText()).toMatch(/akun/i);
    expect(screenText()).toMatch(/tidak aktif|tidak tersedia|belum tersedia|dinonaktifkan/i);
    expect(screenText()).not.toMatch(/Akun lokal|Belajar tetap bisa tanpa akun/i);
    expect(screen.queryByText(/^(Masuk|Daftar)/i)).toBeNull();
    expect(screen.queryByTestId('account-registration-start')).toBeNull();
    expect(screen.queryByTestId('account-progress')).toBeNull();
  });

  it('offers normal email/password registration in production with no tester copy', async () => {
    const registration = makeRegistration();
    mockAccount = makeAccount(true, registration);
    await render(<Account />);

    expect(screenText()).toMatch(/email/i);
    expect(screenText()).toMatch(/kata sandi|password/i);
    expect(screen.queryAllByText(/Daftar akun/i).length).toBeGreaterThan(0);
    expect(screenText()).not.toMatch(/\.test|uji coba|Akun lokal/i);

    await fireEvent.press(screen.getByTestId('account-registration-start'));

    expect(registration.onStart).toHaveBeenCalledTimes(1);
    for (const handler of [
      registration.onRegister,
      registration.onUseCode,
      registration.onConfirm,
      registration.onResend,
      registration.onCancel,
      registration.onSignIn,
      mockAccount.panel.onSubmit,
    ]) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it('never surfaces a registration model when the account is disabled', async () => {
    const registration = makeRegistration();
    mockAccount = makeAccount(false, registration);
    await render(<Account />);

    expect(screen.getByTestId('account-disabled')).toBeTruthy();
    expect(screen.queryByTestId('account-registration-start')).toBeNull();
    expect(registration.onStart).not.toHaveBeenCalled();
  });
});
