// Registration as the account panel will show it, written before the panel offers it. A test harness (not the app's
// account context, whose hook wiring is tested separately) binds the real registration controller to a fake Registration
// (no SDK, network or storage) and hands the panel a future optional `registration` model: the controller's state,
// `available`, and callbacks that only delegate to it; onSignIn cancels to idle, never signs in. Sign-up is off.
import { useEffect, useState, type ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { RegistrationError, type Registration } from '@/auth/registration';
import { AccountPanel, type AccountPanelProps } from '@/ui/account/AccountPanel';
import { createRegistrationController, type RegistrationState } from '@/ui/account/registrationController';

// The shared UI components import the app's storage module; registering must never open the store.
const mockOpenStore = jest.fn();
jest.mock('@/storage/openStore', () => ({ STORAGE_KIND: 'test-memory', openStore: (...args: unknown[]) => mockOpenStore(...args) }));

const EMAIL = 'murid.satu@ayangaji.test';
const PASSWORD = 'Sandi-Uji-7319-rahasia';
const CODE = '483920';
const ANI = { key: 'session-1', label: 'ani@ayailmu.test' };
const NO_DELIVERY_CLAIM = /terkirim|telah dikirim|sudah dikirim|\bsent\b|delivered/i;

/** The future panel model: the controller's state, whether registration may run now, and delegating callbacks. */
type RegistrationPanelModel = RegistrationState & Record<'onStart' | 'onResend' | 'onCancel' | 'onSignIn', () => void> & {
  available: boolean; onRegister(email: string, password: string): void; onUseCode(email: string): void; onConfirm(code: string): void };
type FutureProps = AccountPanelProps & { registration?: RegistrationPanelModel };
const Panel = AccountPanel as unknown as (props: FutureProps) => ReactElement;

/** A Registration whose calls are recorded; the next call can be held open or made to fail. */
function fakeRegistration() {
  const calls: string[][] = [];
  const held: (() => void)[] = [];
  const failures: unknown[] = [];
  let holdNext = false;
  function op<T>(name: string, args: string[], value: T): Promise<T> {
    calls.push([name, ...args]);
    if (failures.length > 0) return Promise.reject(failures.shift());
    if (!holdNext) return Promise.resolve(value);
    holdNext = false;
    return new Promise<T>((resolve) => held.push(() => resolve(value)));
  }
  const registration = {
    register: (email: string, password: string) => op('register', [email, password], { status: 'confirmation_required' as const }),
    confirm: (email: string, code: string) => op('confirm', [email, code], { status: 'confirmed' as const, signInRequired: true as const }),
    resend: (email: string) => op('resend', [email], { status: 'resent' as const }),
    cancel: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
  } satisfies Registration;
  return { registration, calls, held, hold: () => void (holdNext = true), fail: (error: unknown) => void failures.push(error) };
}
type Fake = ReturnType<typeof fakeRegistration>;

const baseProps = (overrides: Partial<FutureProps> = {}): FutureProps => ({
  account: null, signUp: false, onSubmit: jest.fn(), onGuestCopy: jest.fn(), onGuestSkip: jest.fn(), onLinkProfile: jest.fn(),
  onCreateProfile: jest.fn(), onSyncNow: jest.fn(), onKeepLocalPrefs: jest.fn(), onUseServerPrefs: jest.fn(), onSignOut: jest.fn(),
  ...overrides,
});

function Harness({ fake, available = true, ...props }: { fake: Fake; available?: boolean } & Partial<FutureProps>) {
  const [state, setState] = useState<RegistrationState>({ stage: 'idle', busy: false, email: null, message: null, error: null });
  const [controller] = useState(() => createRegistrationController({ registration: fake.registration, active: () => true, onChange: setState }));
  useEffect(() => () => controller.dispose(), [controller]);
  const model: RegistrationPanelModel = {
    ...state, available,
    onStart: () => controller.start(), onRegister: (email, password) => void controller.register(email, password),
    onUseCode: (email) => controller.useCode(email), onConfirm: (code) => void controller.confirm(code),
    onResend: () => void controller.resend(), onCancel: () => controller.cancel(), onSignIn: () => controller.cancel(),
  };
  return <Panel {...baseProps(props)} registration={model} />;
}

const reg = (part: string) => `account-registration-${part}`;
const byId = (testID: string) => screen.getByTestId(testID);
const none = (testID: string) => expect(screen.queryByTestId(testID)).toBeNull();
const press = (part: string) => fireEvent.press(byId(reg(part)));
const type = (part: string, value: string) => fireEvent.changeText(byId(reg(part)), value);
const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
/** Lets the held adapter call answer now. */
const release = (fake: Fake) => act(async () => new Promise<void>((resolve) => { fake.held.shift()?.(); setTimeout(resolve, 0); }));
const confirmWith = async (code: string) => (await type('code', code), await press('confirm'), await flush());

async function openForm(fake: Fake, props: Partial<FutureProps> = {}, password?: string) {
  const view = await render(<Harness fake={fake} {...props} />);
  await press('start');
  await type('email', EMAIL);
  if (password !== undefined) await type('password', password);
  return view;
}

afterEach(() => (jest.restoreAllMocks(), mockOpenStore.mockClear()));

it('is offered only with a model outside production; its intro then drops the «not available» warning', async () => {
  const fake = fakeRegistration();
  const view = await render(<AccountPanel {...baseProps()} />);
  none(reg('start'));
  expect(screen.getByText(/pendaftaran baru tidak tersedia/)).toBeTruthy(); // the legacy copy, unchanged
  await view.rerender(<Harness fake={fake} environment="production" />);
  none(reg('start'));
  expect(byId('account-form')).toBeTruthy();
  for (const environment of [undefined, 'staging'] as const) {
    await view.rerender(<Harness key={environment ?? 'local'} fake={fake} environment={environment} />);
    expect(byId(reg('start'))).toBeEnabled();
    expect(byId('account-form')).toBeTruthy(); // the normal sign-in stays beside the entry
    expect(screen.queryByText(/pendaftaran baru tidak tersedia/)).toBeNull();
  }
});

it('registers through secure fields only: the exact address and password go once, and the password leaves at once', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method));
  const fake = fakeRegistration();
  const view = await openForm(fake, { environment: 'staging' }, PASSWORD);
  for (const legacy of ['account-form', 'account-email', 'account-password', 'account-submit']) none(legacy);
  expect(byId(reg('password')).props.secureTextEntry).toBe(true);
  fake.hold();
  await press('submit');
  expect(byId(reg('password')).props.value).toBe('');
  expect(byId(reg('submit'))).toBeDisabled();
  await press('submit');
  await release(fake);
  expect(fake.calls).toEqual([['register', EMAIL, PASSWORD]]);
  // The code stage names the test mailbox, claims no delivery to a real inbox, and keeps the normal sign-in away.
  expect(byId(reg('code'))).toBeTruthy();
  expect(byId(reg('status'))).toHaveTextContent(/kotak masuk uji/);
  expect(byId('account-panel')).not.toHaveTextContent(NO_DELIVERY_CLAIM);
  for (const gone of [reg('password'), 'account-form']) none(gone);
  expect(JSON.stringify(view.toJSON())).not.toContain(PASSWORD);
  for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
});

it('confirms the exact code into a password sign-in prompt only: still signed out, and «Masuk» returns the normal form', async () => {
  const fake = fakeRegistration();
  const onSubmit = jest.fn();
  const view = await openForm(fake, { onSubmit }, PASSWORD);
  await press('submit');
  await flush();
  await confirmWith(CODE);
  expect(fake.calls).toEqual([['register', EMAIL, PASSWORD], ['confirm', EMAIL, CODE]]);
  expect(byId(reg('status'))).toHaveTextContent(/kata sandi/);
  none(reg('code'));
  expect(byId('account-status')).toHaveTextContent('Belum masuk');
  await press('signin');
  expect(byId('account-form')).toBeTruthy();
  expect(byId('account-password').props.value).toBe('');
  expect(onSubmit).not.toHaveBeenCalled();
  expect(JSON.stringify(view.toJSON())).not.toContain(CODE);
});

it('after a reload, a .test address alone re-enters the code stage: no sign-up, password or request', async () => {
  const fake = fakeRegistration();
  await openForm(fake);
  await type('email', 'ani@gmail.com');
  await press('use-code');
  expect(byId(reg('status'))).toHaveTextContent('Gunakan alamat email uji yang berakhiran .test.');
  none(reg('code'));
  await type('email', EMAIL);
  expect(byId(reg('use-code'))).toBeEnabled(); // no password typed
  await press('use-code');
  expect(fake.calls).toEqual([]);
  expect(byId(reg('status'))).toHaveTextContent(/kotak masuk uji/);
  await confirmWith(CODE);
  expect(fake.calls).toEqual([['confirm', EMAIL, CODE]]);
  expect(mockOpenStore).not.toHaveBeenCalled();
});

it('runs one request at a time, and a malformed or refused reply shows a fixed Indonesian status, open to retry', async () => {
  const fake = fakeRegistration();
  await openForm(fake);
  await press('use-code');
  fake.hold();
  await press('resend');
  for (const part of ['resend', 'confirm']) expect(byId(reg(part))).toBeDisabled();
  await press('resend');
  await release(fake);
  expect(fake.calls).toEqual([['resend', EMAIL]]);
  expect(byId(reg('status'))).toHaveTextContent(/kotak masuk uji/);
  expect(byId('account-panel')).not.toHaveTextContent(NO_DELIVERY_CLAIM);
  for (const [failure, code, status] of [
    [new Error('GoTrue 500: upstream failure at /verify'), CODE, 'Jawaban server akun tidak dikenali. Coba lagi.'],
    [new RegistrationError('invalid_code'), '111111', 'Kode tidak cocok atau sudah kedaluwarsa. Coba lagi.'],
  ] as const) {
    fake.fail(failure);
    await confirmWith(code);
    expect(byId(reg('status'))).toHaveTextContent(status);
    expect(byId('account-panel')).not.toHaveTextContent(/GoTrue|upstream|Account registration problem|invalid_code/);
    expect(byId(reg('confirm'))).toBeEnabled();
  }
  await confirmWith(CODE);
  expect(byId(reg('status'))).toHaveTextContent(/kata sandi/);
  expect(fake.calls.slice(1)).toEqual([['confirm', EMAIL, CODE], ['confirm', EMAIL, '111111'], ['confirm', EMAIL, CODE]]);
});

it('cancel while a sign-up is pending clears the form and returns the normal view; the late reply revives nothing', async () => {
  const fake = fakeRegistration();
  await openForm(fake, {}, PASSWORD);
  fake.hold();
  await press('submit');
  await press('cancel'); // available while the request is pending
  expect(byId('account-form')).toBeTruthy();
  none(reg('email'));
  expect(fake.registration.cancel).toHaveBeenCalled();
  await release(fake);
  none(reg('code'));
  expect(byId('account-form')).toBeTruthy();
  await press('start');
  expect(byId(reg('email')).props.value).toBe('');
  expect(byId(reg('password')).props.value).toBe('');
  expect(fake.calls).toEqual([['register', EMAIL, PASSWORD]]);
});

it('is held back while unavailable or the main sign-in is busy, and never shown to an account signed in elsewhere', async () => {
  const fake = fakeRegistration();
  const view = await render(<Harness fake={fake} available={false} />);
  expect(byId(reg('start'))).toBeDisabled();
  await view.rerender(<Harness fake={fake} busy="auth" />);
  expect(byId(reg('start'))).toBeDisabled();
  await view.rerender(<Harness fake={fake} />);
  await press('start');
  await type('email', EMAIL);
  await type('password', PASSWORD);
  await view.rerender(<Harness fake={fake} available={false} />);
  for (const part of ['submit', 'use-code']) expect(byId(reg(part))).toBeDisabled();
  await view.rerender(<Harness fake={fake} account={ANI} />);
  for (const part of ['start', 'email', 'password', 'submit', 'code']) none(reg(part));
  expect(byId('account-signout')).toBeTruthy();
  expect(fake.calls).toEqual([]);
});
