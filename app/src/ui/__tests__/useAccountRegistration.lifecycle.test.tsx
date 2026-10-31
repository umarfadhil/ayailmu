// The registration hook's own lifecycle under React 19, apart from the account provider. The actual useAccountRegistration
// and registration controller run; the only double is the createRegistration factory, a typed in-memory Registration per
// call (no SDK or Auth server is involved, so nothing here says anything about one). Each case is a model the hook handed
// out that must keep working, or stop, across a StrictMode remount, an availability change or a cancel.
import { act, render } from '@testing-library/react-native';
import { StrictMode, useEffect } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

import { loadSupabaseConfig, type SupabaseConfig } from '@/account/supabaseConfig';
import type { Registration, RegistrationOptions } from '@/auth/registration';
import { useAccountRegistration, type AccountRegistrationState } from '@/ui/useAccountRegistration';
import { FAKE_API, FAKE_GOTRUE } from '../../../test/fakeAccountApi';

// Only the factory is replaced; RegistrationError (which the real controller checks) stays the adapter's own.
const mockCreateRegistration = jest.fn<Registration, [RegistrationOptions]>();
jest.mock('@/auth/registration', () => ({
  ...jest.requireActual<typeof import('@/auth/registration')>('@/auth/registration'),
  createRegistration: (options: RegistrationOptions) => mockCreateRegistration(options),
}));

const EMAIL = 'murid.baru@ayailmu.test';
const PASSWORD = 'Sandi-Uji-8841-baru';
const CODE = '482913';

const KEYS = ['EXPO_PUBLIC_AUTH_PROVIDER', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL', 'EXPO_PUBLIC_ACCOUNT_ENV', 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'EXPO_PUBLIC_ACCOUNT_REGISTRATION'] as const;
/** A local build with the flag on, against the fake services' known addresses; the other variables unset. */
const LOCAL_ON: Partial<Record<(typeof KEYS)[number], string>> = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: FAKE_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: FAKE_GOTRUE, EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'on' };
/** The process's own values, put back after every test. */
const BASELINE = KEYS.map((key) => [key, process.env[key]] as const);
const setEnv = (entries: readonly (readonly [string, string | undefined])[]) =>
  entries.forEach(([key, value]) => (value === undefined ? delete process.env[key] : (process.env[key] = value)));
const CURRENT_STATE = Object.getOwnPropertyDescriptor(AppState, 'currentState');

/** One in-memory Registration per factory call: every call is recorded and answers at once. */
const newPort = () =>
  ({
    register: jest.fn<Promise<{ status: 'confirmation_required' }>, [string, string]>().mockResolvedValue({ status: 'confirmation_required' }),
    confirm: jest.fn<Promise<{ status: 'confirmed'; signInRequired: true }>, [string, string]>().mockResolvedValue({ status: 'confirmed', signInRequired: true }),
    resend: jest.fn<Promise<{ status: 'resent' }>, [string]>().mockResolvedValue({ status: 'resent' }),
    cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    dispose: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  }) satisfies Registration;

/** The provider's account services: one object for the whole test, so rerenders keep the same registration. */
const OWNER = {};
let ports: ReturnType<typeof newPort>[] = [];
let removes: jest.Mock[] = [];
let config: SupabaseConfig;
let onIntent: jest.Mock<void, []>;
let latest: AccountRegistrationState | null = null;

/** Hands the hook's actual result to the test after each commit. */
function Probe({ available }: { available: boolean }) {
  const result = useAccountRegistration({ config, owner: OWNER, available, onIntent });
  useEffect(() => void (latest = result));
  return null;
}

const panel = () => latest!.panel!;
const run = (call: () => void) => act(async () => (call(), await new Promise<void>((resolve) => setTimeout(resolve, 0))));
/** Every request any port was sent: sign-up, confirmation or resend. */
const sent = () => ports.flatMap((port) => [...port.register.mock.calls, ...port.confirm.mock.calls, ...port.resend.mock.calls]);

beforeEach(() => {
  setEnv(KEYS.map((key) => [key, LOCAL_ON[key]] as const));
  config = loadSupabaseConfig();
  onIntent = jest.fn();
  latest = null;
  ports = [];
  removes = [];
  mockCreateRegistration.mockReset().mockImplementation(() => {
    const port = newPort();
    ports.push(port);
    return port;
  });
  Object.defineProperty(AppState, 'currentState', { configurable: true, writable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => {
    const remove = jest.fn();
    removes.push(remove);
    return { remove } as unknown as NativeEventSubscription;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (CURRENT_STATE) Object.defineProperty(AppState, 'currentState', CURRENT_STATE);
  else delete (AppState as { currentState?: unknown }).currentState;
  setEnv(BASELINE);
});

describe('useAccountRegistration lifecycle', () => {
  it('is built from the validated local configuration with the flag on', async () => {
    expect(config).toMatchObject({ enabled: true });
    await render(<Probe available />);
    expect(panel()).toMatchObject({ stage: 'idle', available: true, busy: false });
    expect(mockCreateRegistration).toHaveBeenCalledWith(expect.objectContaining({ config }));
  });

  it('under StrictMode the model shown after the remount starts, and its requests reach a live registration; none after unmount', async () => {
    const view = await render(<StrictMode><Probe available /></StrictMode>);
    await run(() => panel().onStart());
    expect(panel().stage).toBe('email');
    await run(() => panel().onRegister(EMAIL, PASSWORD));
    expect(panel().stage).toBe('code');
    const used = ports.filter((port) => port.register.mock.calls.length > 0);
    expect(used.map((port) => port.register.mock.calls)).toEqual([[[EMAIL, PASSWORD]]]);
    expect(used[0].dispose).not.toHaveBeenCalled();

    const stale = panel();
    const intents = onIntent.mock.calls.length;
    await view.unmount();
    expect(used[0].dispose).toHaveBeenCalledTimes(1);
    removes.forEach((remove) => expect(remove).toHaveBeenCalled());
    await run(() => {
      stale.onStart();
      stale.onRegister(EMAIL, PASSWORD);
      stale.onUseCode(EMAIL);
      stale.onConfirm(CODE);
      stale.onResend();
    });
    expect(sent()).toEqual([[EMAIL, PASSWORD]]);
    expect(onIntent).toHaveBeenCalledTimes(intents);
  });

  it('a model handed out before registration became unavailable stays idle once it is available again; the fresh one starts', async () => {
    const view = await render(<Probe available />);
    const old = panel();
    await view.rerender(<Probe available={false} />);
    expect(panel().available).toBe(false);
    await view.rerender(<Probe available />);
    expect(panel().available).toBe(true);

    await run(() => old.onStart());
    expect(panel().stage).toBe('idle');
    expect(onIntent).not.toHaveBeenCalled();
    await run(() => panel().onStart());
    expect(panel().stage).toBe('email');
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual([]);
  });

  it('cancel resets the flow and fences the model it was pressed on; the current model can start again', async () => {
    await render(<Probe available />);
    await run(() => panel().onStart());
    const old = panel();
    expect(old.stage).toBe('email');
    await run(() => old.onCancel());
    expect(panel().stage).toBe('idle');

    await run(() => old.onUseCode(EMAIL));
    expect(panel().stage).toBe('idle');
    await run(() => old.onStart());
    expect(panel().stage).toBe('idle');
    await run(() => old.onRegister(EMAIL, PASSWORD));
    expect(panel().stage).toBe('idle');

    await run(() => panel().onStart());
    expect(panel().stage).toBe('email');
    expect(sent()).toEqual([]);
  });
});
