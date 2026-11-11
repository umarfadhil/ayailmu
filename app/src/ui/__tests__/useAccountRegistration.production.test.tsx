// The registration hook in a production build with confirmed-email registration on. The actual useAccountRegistration,
// registration controller and AccountPanel run; the only double is the createRegistration factory, a typed in-memory
// Registration per call (no SDK, Auth server or network is involved). Addresses are reserved example.org ones and the
// password and code are fixtures that exist only here.
import { act, fireEvent, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { loadSupabaseConfig, type SupabaseConfig } from '@/account/supabaseConfig';
import type { Registration, RegistrationOptions } from '@/auth/registration';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { useAccountRegistration, type AccountRegistrationState } from '@/ui/useAccountRegistration';

// Only the factory is replaced; RegistrationError and the adapter's helpers stay its own.
const mockCreateRegistration = jest.fn<Registration, [RegistrationOptions]>();
jest.mock('@/auth/registration', () => ({
  ...jest.requireActual<typeof import('@/auth/registration')>('@/auth/registration'),
  createRegistration: (options: RegistrationOptions) => mockCreateRegistration(options),
}));

const EMAIL = 'learner@example.org';
const PASSWORD = 'fixture-only-Pw-7731';
const CODE = '640275';

const KEYS = ['EXPO_PUBLIC_AUTH_PROVIDER', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL', 'EXPO_PUBLIC_ACCOUNT_ENV', 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'EXPO_PUBLIC_ACCOUNT_REGISTRATION'] as const;
/** A production build with production accounts and confirmed-email registration on. */
const PRODUCTION: Record<(typeof KEYS)[number], string> = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.example.org',
  EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'confirmed-email',
};
const BASELINE = KEYS.map((key) => [key, process.env[key]] as const);
const setEnv = (entries: readonly (readonly [string, string | undefined])[]) =>
  entries.forEach(([key, value]) => (value === undefined ? delete process.env[key] : (process.env[key] = value)));
const CURRENT_STATE = Object.getOwnPropertyDescriptor(AppState, 'currentState');

const newPort = () =>
  ({
    register: jest.fn<Promise<{ status: 'confirmation_required' }>, [string, string]>().mockResolvedValue({ status: 'confirmation_required' }),
    confirm: jest.fn<Promise<{ status: 'confirmed'; signInRequired: true }>, [string, string]>().mockResolvedValue({ status: 'confirmed', signInRequired: true }),
    resend: jest.fn<Promise<{ status: 'resent' }>, [string]>().mockResolvedValue({ status: 'resent' }),
    cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    dispose: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  }) satisfies Registration;

/** Stable across rerenders, as the account provider's services are. */
const OWNER = {};
let ports: ReturnType<typeof newPort>[] = [];
let listeners: ((state: AppStateStatus) => void)[] = [];
let config: SupabaseConfig;
let onIntent: jest.Mock<void, []>;
let latest: AccountRegistrationState | null = null;

const noop = () => undefined;

/** The actual hook feeding the actual production account panel, signed out with sign-up off; the result reaches the test after each commit. */
function Host() {
  const result = useAccountRegistration({ config, owner: OWNER, available: true, onIntent });
  useEffect(() => void (latest = result));
  return (
    <AccountPanel
      account={null} signUp={false} environment="production" registration={result.panel ?? undefined}
      onSubmit={noop} onGuestCopy={noop} onGuestSkip={noop} onLinkProfile={noop} onCreateProfile={noop}
      onSyncNow={noop} onKeepLocalPrefs={noop} onUseServerPrefs={noop} onSignOut={noop}
    />
  );
}

const panel = () => latest!.panel!;
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const run = async (call: () => unknown) => (await act(async () => void (await call())), await flush());
const sent = () => ports.flatMap((port) => [...port.register.mock.calls, ...port.confirm.mock.calls, ...port.resend.mock.calls]);
/** Development-only copy: the test-account wording, the .test rule and the private test inbox. */
const DEV_COPY = /\buji\b|\.test\b|kotak masuk|pribadi/i;

beforeEach(() => {
  setEnv(KEYS.map((key) => [key, PRODUCTION[key]] as const));
  config = loadSupabaseConfig();
  onIntent = jest.fn();
  latest = null;
  ports = [];
  listeners = [];
  mockCreateRegistration.mockReset().mockImplementation(() => {
    const port = newPort();
    ports.push(port);
    return port;
  });
  Object.defineProperty(AppState, 'currentState', { configurable: true, writable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove: jest.fn() } as unknown as NativeEventSubscription;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (CURRENT_STATE) Object.defineProperty(AppState, 'currentState', CURRENT_STATE);
  else delete (AppState as { currentState?: unknown }).currentState;
  setEnv(BASELINE);
});

describe('useAccountRegistration in production with confirmed-email registration', () => {
  it('builds from the production configuration, marks the model confirmed-email and passes that policy to the factory', async () => {
    expect(config).toMatchObject({ enabled: true, provider: 'local-supabase', environment: 'production', productionAccounts: true, apiBaseUrl: 'https://api.example.org', authUrl: 'https://auth.example.org' });
    await render(<Host />);
    expect(panel()).toMatchObject({ stage: 'idle', available: true, busy: false, emailPolicy: 'confirmed-email' });
    expect(mockCreateRegistration).toHaveBeenCalledWith(expect.objectContaining({ config, emailPolicy: 'confirmed-email' }));
  });

  it('the rendered panel uses normal copy and runs register, resend and confirm back to the normal sign-in, keeping no secrets', async () => {
    const view = await render(<Host />);
    const noDevCopy = () => (expect(view.queryAllByText(DEV_COPY)).toEqual([]), expect(view.queryAllByPlaceholderText(DEV_COPY)).toEqual([]));
    expect(view.getByText(/^Daftar akun/)).toBeTruthy();
    noDevCopy();

    await run(() => fireEvent.press(view.getByTestId('account-registration-start')));
    expect(view.getByText('Email')).toBeTruthy();
    noDevCopy();
    await run(() => fireEvent.changeText(view.getByTestId('account-registration-email'), EMAIL));
    await run(() => fireEvent.changeText(view.getByTestId('account-registration-password'), PASSWORD));
    await run(() => fireEvent.press(view.getByTestId('account-registration-submit')));
    expect(panel().stage).toBe('code');
    expect(view.queryByTestId('account-registration-password')).toBeNull();
    noDevCopy();

    await run(() => fireEvent.changeText(view.getByTestId('account-registration-code'), '000000'));
    await run(() => fireEvent.press(view.getByTestId('account-registration-resend')));
    expect(view.getByTestId('account-registration-code').props.value).toBe('');
    await run(() => fireEvent.changeText(view.getByTestId('account-registration-code'), CODE));
    await run(() => fireEvent.press(view.getByTestId('account-registration-confirm')));
    expect(view.queryByTestId('account-registration-code')).toBeNull();
    noDevCopy();

    const [port, ...others] = ports.filter((each) => each.register.mock.calls.length > 0);
    expect(others).toEqual([]);
    expect(port.register.mock.calls).toEqual([[EMAIL, PASSWORD]]);
    expect(port.resend.mock.calls).toEqual([[EMAIL]]);
    expect(port.confirm.mock.calls).toEqual([[EMAIL, CODE]]);
    const stored = JSON.stringify(latest);
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(CODE);

    await run(() => fireEvent.press(view.getByTestId('account-registration-signin')));
    expect(panel().stage).toBe('idle');
    expect(view.getByTestId('account-registration-start')).toBeTruthy();
    expect(sent()).toHaveLength(3);
  });

  it('a pending production sign-up sent to the background and cancelled fences its late reply and the stale model', async () => {
    let reply: (value: { status: 'confirmation_required' }) => void = () => undefined;
    await render(<Host />);
    await run(() => panel().onStart());
    const port = ports[ports.length - 1];
    port.register.mockImplementation(() => new Promise((resolve) => (reply = resolve)));
    await run(() => panel().onRegister(EMAIL, PASSWORD));
    expect(panel().busy).toBe(true);
    const stale = panel();

    await run(() => listeners.forEach((listener) => listener('background')));
    await run(() => latest!.cancel());
    expect(port.cancel).toHaveBeenCalled();
    expect(panel()).toMatchObject({ stage: 'idle', busy: false });

    await run(() => reply({ status: 'confirmation_required' }));
    expect(panel()).toMatchObject({ stage: 'idle', busy: false });
    await run(() => (stale.onUseCode(EMAIL), stale.onConfirm(CODE), stale.onResend(), stale.onStart()));
    expect(panel().stage).toBe('idle');
    expect(sent()).toEqual([[EMAIL, PASSWORD]]);
    expect(JSON.stringify(latest)).not.toContain(PASSWORD);
  });
});
