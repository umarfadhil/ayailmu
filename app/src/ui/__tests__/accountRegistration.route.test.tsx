// The real account route ends the registration it shows when it loses focus or unmounts, through that registration's own
// onCancel: once per focus cycle, never for an ordinary model rerender, and for the owner it captured, not a later one.
import { act, render } from '@testing-library/react-native';
import Account from '@/app/account';
import type { AccountContextValue } from '@/ui/AccountContext';
import type { RegistrationPanelModel } from '@/ui/account/RegistrationPanel';

/** A useFocusEffect harness: subscribes the route's callback while focused, cleans up on blur, change of callback or unmount. */
const mockFocus = { focused: true, calls: 0, subscriptions: 0, effects: [] as unknown[], listeners: new Set<(focused: boolean) => void>() };
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (effect: () => void | (() => void)) => {
      mockFocus.calls += 1;
      const [focused, setFocused] = React.useState(mockFocus.focused);
      React.useEffect(() => {
        mockFocus.listeners.add(setFocused);
        return () => void mockFocus.listeners.delete(setFocused);
      }, []);
      React.useEffect(() => {
        if (!focused) return;
        mockFocus.subscriptions += 1;
        mockFocus.effects.push(effect);
        const cleanup = effect();
        return () => { if (typeof cleanup === 'function') cleanup(); };
      }, [focused, effect]);
    },
  };
});
let mockAccount: AccountContextValue;
jest.mock('@/ui/AccountContext', () => ({ useAccount: () => mockAccount }));
jest.mock('@/ui/Hydration', () => ({ HydrationGate: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/ui/BackLink', () => ({ BackLink: () => null }));
jest.mock('@/ui/components', () => {
  const actual = jest.requireActual('@/ui/components');
  const { View } = jest.requireActual('react-native');
  return { ...actual, Page: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});

/** A registration model whose actions do nothing: no adapter, SDK or service stands behind it. */
const registration = (onCancel: () => void, patch: Partial<RegistrationPanelModel> = {}): RegistrationPanelModel => ({
  stage: 'email', busy: false, email: null, message: null, error: null, available: true,
  onStart: jest.fn(), onRegister: jest.fn(), onUseCode: jest.fn(), onConfirm: jest.fn(), onResend: jest.fn(), onCancel, onSignIn: jest.fn(),
  ...patch,
});
const signedOut = (model?: RegistrationPanelModel): AccountContextValue => ({
  enabled: true, signedIn: false, connected: false,
  panel: {
    account: null, onSubmit: jest.fn(), onGuestCopy: jest.fn(), onGuestSkip: jest.fn(), onLinkProfile: jest.fn(), onCreateProfile: jest.fn(),
    onSyncNow: jest.fn(), onKeepLocalPrefs: jest.fn(), onUseServerPrefs: jest.fn(), onSignOut: jest.fn(),
    ...(model ? { registration: model } : {}),
  },
});
const setFocused = (focused: boolean) => act(async () => { mockFocus.focused = focused; mockFocus.listeners.forEach((listen) => listen(focused)); });

beforeEach(() => {
  Object.assign(mockFocus, { focused: true, calls: 0, subscriptions: 0, effects: [] });
  mockFocus.listeners.clear();
});

it('blurring the route cancels the shown registration once, and a later unmount does not cancel again', async () => {
  const cancel = jest.fn();
  mockAccount = signedOut(registration(cancel));
  const view = await render(<Account />);
  expect(mockFocus.calls).toBeGreaterThan(0);
  expect(mockFocus.subscriptions).toBe(1);
  expect(cancel).not.toHaveBeenCalled();
  await setFocused(false);
  expect(cancel).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('unmounting the focused route cancels the shown registration once', async () => {
  const cancel = jest.fn();
  mockAccount = signedOut(registration(cancel, { stage: 'code', email: 'nama@ayailmu.test' }));
  const view = await render(<Account />);
  expect(mockFocus.calls).toBeGreaterThan(0);
  await view.unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('an ordinary stage or busy rerender with the same onCancel neither cancels nor resubscribes', async () => {
  const cancel = jest.fn();
  mockAccount = signedOut(registration(cancel));
  const view = await render(<Account />);
  mockAccount = signedOut(registration(cancel, { busy: true }));
  await view.rerender(<Account />);
  mockAccount = signedOut(registration(cancel, { stage: 'code', email: 'nama@ayailmu.test', message: 'Masukkan kode dari kotak masuk uji.' }));
  await view.rerender(<Account />);
  expect(mockFocus.calls).toBeGreaterThan(2);
  expect(mockFocus.subscriptions).toBe(1);
  expect(cancel).not.toHaveBeenCalled();
  await setFocused(false);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('a replaced owner cancels only the captured old registration, and the next blur reaches the new one', async () => {
  const oldCancel = jest.fn();
  const newCancel = jest.fn();
  mockAccount = signedOut(registration(oldCancel, { stage: 'code', email: 'lama@ayailmu.test' }));
  const view = await render(<Account />);
  mockAccount = signedOut(registration(newCancel));
  await view.rerender(<Account />);
  expect(mockFocus.subscriptions).toBe(2);
  expect(mockFocus.effects[1]).not.toBe(mockFocus.effects[0]);
  expect(oldCancel).toHaveBeenCalledTimes(1);
  expect(newCancel).not.toHaveBeenCalled();
  await setFocused(false);
  expect(oldCancel).toHaveBeenCalledTimes(1);
  expect(newCancel).toHaveBeenCalledTimes(1);
});

it('without a registration the route still subscribes, blur and unmount do nothing, and the sign-in form renders', async () => {
  mockAccount = signedOut();
  const view = await render(<Account />);
  expect(mockFocus.calls).toBeGreaterThan(0);
  expect(view.getByTestId('account-email')).toBeTruthy();
  expect(view.getByTestId('account-password')).toBeTruthy();
  await setFocused(false);
  await setFocused(true);
  await view.unmount();
  for (const handler of Object.values(mockAccount.panel)) if (jest.isMockFunction(handler)) expect(handler).not.toHaveBeenCalled();
});

it('each focus cycle cancels at most once, even while registration is not available now', async () => {
  const cancel = jest.fn();
  mockAccount = signedOut(registration(cancel, { available: false, busy: true }));
  const view = await render(<Account />);
  await setFocused(false);
  await setFocused(false);
  expect(cancel).toHaveBeenCalledTimes(1);
  await setFocused(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(mockFocus.subscriptions).toBe(2);
  await setFocused(false);
  expect(cancel).toHaveBeenCalledTimes(2);
  await view.unmount();
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(mockFocus.calls).toBeGreaterThan(0);
});
