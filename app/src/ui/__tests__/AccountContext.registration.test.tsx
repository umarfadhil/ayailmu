// Test-account registration as the app's account layer will offer it, written before that wiring. The real AppProvider,
// AccountProvider, AccountPanel, RegistrationPanel and registration controller run here; the account context is to hand
// the panel its optional `registration` model. The only doubles are the createRegistration factory (a typed fake
// Registration whose calls can be held open: no SDK, Auth server or mailbox, so nothing here is a live registration), the
// network for the normal sign-in (test/fakeAccountApi.ts, unchanged: two prepared users, sign-up off), the device storage
// and the lock manager. OUTSTANDING: leaving the route (blur) is not covered here; it needs its own small route guard
// test once the hook and context are wired.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { openKvDataset, type Namespace } from '@/account/datasets';
import { loadSupabaseConfig } from '@/account/supabaseConfig';
import { RegistrationError, type Registration, type RegistrationOptions } from '@/auth/registration';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountPanel } from '@/ui/account/AccountPanel';
import type { RegistrationPanelModel } from '@/ui/account/RegistrationPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';

jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

// Only the factory is replaced; RegistrationError (which the real controller checks) stays the adapter's own.
const mockCreateRegistration = jest.fn<Registration, [RegistrationOptions]>();
jest.mock('@/auth/registration', () => ({
  ...jest.requireActual<typeof import('@/auth/registration')>('@/auth/registration'),
  createRegistration: (options: RegistrationOptions) => mockCreateRegistration(options),
}));

jest.setTimeout(30_000);

const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-gotrue-1', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };
const BUDI: FakeUser = { email: 'budi@ayailmu.test', password: 'pw-budi-gotrue-2', uid: 'uid-budi', token: 'legacy-id-token-budi', accountId: '7c2e2a5f-3d4b-4e6f-9a71-82b3c4d5e6f7' };
const EMAIL = 'murid.baru@ayailmu.test';
const PASSWORD = 'Sandi-Uji-8841-baru';
const CODE = '482913';

const KEYS = ['EXPO_PUBLIC_AUTH_PROVIDER', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL', 'EXPO_PUBLIC_ACCOUNT_ENV', 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'EXPO_PUBLIC_ACCOUNT_REGISTRATION'] as const;
type Build = Partial<Record<(typeof KEYS)[number], string>>;
const LOCAL: Build = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: FAKE_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: FAKE_GOTRUE };
const LOCAL_ON: Build = { ...LOCAL, EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'on' };
const REMOTE: Build = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: 'https://api.ayailmu.id', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.ayailmu.id', EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'on' };
const STAGING_ON: Build = { ...REMOTE, EXPO_PUBLIC_ACCOUNT_ENV: 'staging' };
const PRODUCTION_ON: Build = { ...REMOTE, EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on' };
/** The process's own values, put back after every test. */
const BASELINE = KEYS.map((key) => [key, process.env[key]] as const);
const setEnv = (entries: readonly (readonly [string, string | undefined])[]) =>
  entries.forEach(([key, value]) => (value === undefined ? delete process.env[key] : (process.env[key] = value)));
/** This test's build: exactly these variables, the others unset. */
const build = (values: Build) => setEnv(KEYS.map((key) => [key, values[key]] as const));

const REGISTERED = { status: 'confirmation_required' as const };
const CONFIRMED = { status: 'confirmed' as const, signInRequired: true as const };
/** The fake Registration every factory call returns: its calls are recorded, and a sign-up can be held open. */
const reg = {
  register: jest.fn<Promise<typeof REGISTERED>, [string, string]>(),
  confirm: jest.fn<Promise<typeof CONFIRMED>, [string, string]>(),
  resend: jest.fn<Promise<{ status: 'resent' }>, [string]>(),
  cancel: jest.fn<Promise<void>, []>(),
  dispose: jest.fn<Promise<void>, []>(),
} satisfies Registration;
/** Holds the next sign-up open; the returned function answers it (whoever still listens). */
function holdRegister() {
  let resolve!: (value: typeof REGISTERED) => void;
  reg.register.mockReturnValueOnce(new Promise((yes) => (resolve = yes)));
  return () => act(async () => (resolve(REGISTERED), await pause()));
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 50));
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const openAccount = (namespace: Namespace) => openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });
let device: KvBackend = memoryKv();
/** Every entry written to the device storage in this test. */
let written: string[] = [];
let fake: FakeAccountApi = fakeAccountApi([ANI, BUDI]);
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let opens = jest.fn(openAccount);
/** The AppState change listeners the app has registered and not removed. */
const appListeners = new Set<(state: AppStateStatus) => void>();
/** The platform's own addEventListener, taken once before any spy: the preset mock's implementation, else the method. */
let platformAddListener: typeof AppState.addEventListener | undefined;
const realFetch = globalThis.fetch;

function recordingDevice(): KvBackend {
  const kv = memoryKv();
  return { getItem: (key) => kv.getItem(key), setItem: (key, value) => (written.push(`${key} ${value}`), kv.setItem(key, value)), removeItem: (key) => kv.removeItem(key) };
}

async function openGuest() {
  const store = new KvStore(device);
  await store.init();
  return store;
}

/** Hands both contexts to the test after each render, and renders the actual account panel. */
function Probe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => void ((account = accountValue), (app = appValue)), [accountValue, appValue]);
  return <AccountPanel {...accountValue.panel} />;
}

async function mount() {
  account = null;
  app = null;
  const view = await render(<AppProvider storeFactory={openGuest}><AccountProvider openDataset={opens}><Probe /></AccountProvider></AppProvider>);
  await waitFor(() => expect(app?.ready).toBe(true));
  return view;
}

const byId = (part: string) => screen.getByTestId(`account-registration-${part}`);
const none = (...parts: string[]) => parts.forEach((part) => expect(screen.queryByTestId(`account-registration-${part}`)).toBeNull());
const press = async (part: string) => void (await fireEvent.press(byId(part)));
const type = async (part: string, value: string) => void (await fireEvent.changeText(byId(part), value));
const settle = () => act(pause);
const model = (): RegistrationPanelModel | undefined => account?.panel.registration;
const stage = () => model()?.stage ?? 'idle';
const authSent = () => fake.auth.sent.map((r) => `${r.method} ${r.path}?${r.query}`);
const storedASecret = () => written.some((entry) => [PASSWORD, CODE].some((secret) => entry.includes(secret)));
/** Hands every registered AppState listener a change, as the platform would. */
const deliver = (state: AppStateStatus) => act(async () => [...appListeners].forEach((listener) => listener(state)));

async function openForm(email = EMAIL, password = PASSWORD) {
  await press('start');
  await type('email', email);
  await type('password', password);
}

async function confirmWith(code: string) {
  await type('code', code);
  await press('confirm');
  await settle();
}

/** The normal password sign-in, through the panel's own onSubmit as it is now. */
async function signIn(user: FakeUser) {
  await act(async () => account!.panel.onSubmit({ mode: 'signin', email: user.email, password: user.password }));
  await waitFor(() => {
    expect(account?.panel.error ?? null).toBeNull();
    expect(account?.panel.account?.label).toBe(user.email);
    expect(account?.panel.busy ?? null).toBeNull();
  }, { timeout: 5000 });
}

async function signOut() {
  await act(async () => account!.panel.onSignOut());
  await waitFor(() => expect([account?.signedIn, app?.dataset, account?.panel.busy ?? null]).toEqual([false, 'guest', null]), { timeout: 5000 });
}

beforeEach(() => {
  build({});
  written = [];
  device = recordingDevice();
  fake = fakeAccountApi([ANI, BUDI]);
  globalThis.fetch = fake.fetch;
  opens = jest.fn(openAccount);
  reg.register.mockReset().mockResolvedValue(REGISTERED);
  reg.confirm.mockReset().mockResolvedValue(CONFIRMED);
  reg.resend.mockReset().mockResolvedValue({ status: 'resent' });
  reg.cancel.mockReset().mockResolvedValue(undefined);
  reg.dispose.mockReset().mockResolvedValue(undefined);
  mockCreateRegistration.mockReset().mockReturnValue(reg);
  appListeners.clear();
  // spyOn reuses a preset jest.fn, so calling the method itself from its new implementation would recurse.
  const current = AppState.addEventListener;
  platformAddListener ??= (jest.isMockFunction(current) ? current.getMockImplementation() : current) ?? (() => ({ remove: () => undefined }) as NativeEventSubscription);
  const original = platformAddListener;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((kind, listener) => {
    const subscription = original.call(AppState, kind, listener);
    if (kind !== 'change') return subscription;
    const own = listener as (state: AppStateStatus) => void;
    appListeners.add(own);
    return { remove: () => (appListeners.delete(own), subscription?.remove()) } as NativeEventSubscription;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  globalThis.fetch = realFetch;
  setEnv(BASELINE);
});

describe('test-account registration in the app account layer', () => {
  it('is never built or offered with the flag absent or off, nor in production even with it on', async () => {
    for (const values of [LOCAL, { ...LOCAL, EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'off' }, PRODUCTION_ON]) {
      build(values);
      const view = await mount();
      expect(account!.enabled).toBe(true);
      expect(model()).toBeUndefined();
      none('start', 'email', 'code');
      expect(screen.getByTestId('account-form')).toBeTruthy();
      await view.unmount();
    }
    expect(mockCreateRegistration).not.toHaveBeenCalled();
    expect(fake.wire).toEqual([]);
  });

  it('a staging build with the flag on builds it from the validated staging configuration and offers it beside sign-in', async () => {
    build(STAGING_ON);
    expect(loadSupabaseConfig()).toMatchObject({ enabled: true, environment: 'staging' });
    await mount();
    expect(model()).toMatchObject({ stage: 'idle', available: true, busy: false });
    expect(byId('start')).toBeEnabled();
    expect(screen.getByTestId('account-form')).toBeTruthy();
    await openForm();
    await press('submit');
    await settle();
    expect(mockCreateRegistration).toHaveBeenCalledWith(expect.objectContaining({ config: loadSupabaseConfig() }));
    expect(reg.register.mock.calls).toEqual([[EMAIL, PASSWORD]]);
    expect(byId('code')).toBeTruthy();
    expect(fake.wire).toEqual([]); // stopped before any normal sign-in
  });

  it('registers and confirms without signing in or touching a dataset; then the learner signs in and out normally', async () => {
    build(LOCAL_ON);
    const view = await mount();
    const guestBefore = [...written];
    await openForm();
    const answer = holdRegister();
    await press('submit');
    expect(byId('password').props.value).toBe('');
    await press('submit'); // pending: a second press sends nothing
    await answer();
    expect(reg.register.mock.calls).toEqual([[EMAIL, PASSWORD]]);
    expect(mockCreateRegistration).toHaveBeenCalledWith(expect.objectContaining({ config: loadSupabaseConfig() }));
    expect(stage()).toBe('code');
    expect(byId('status')).toHaveTextContent(/kotak masuk uji/);

    await confirmWith(CODE);
    expect(reg.confirm.mock.calls).toEqual([[EMAIL, CODE]]);
    expect(stage()).toBe('confirmed');
    expect(byId('status')).toHaveTextContent(/kata sandi/);
    // Confirmation is not a sign-in: no account, profile, dataset, request or stored secret; the guest's data untouched.
    expect([account!.signedIn, account!.panel.account, account!.panel.profiles ?? [], app!.dataset]).toEqual([false, null, [], 'guest']);
    expect(opens).not.toHaveBeenCalled();
    expect(fake.wire).toEqual([]);
    expect(written).toEqual(guestBefore);
    expect(JSON.stringify(view.toJSON())).not.toContain(CODE);

    await press('signin');
    expect(stage()).toBe('idle');
    expect(screen.getByTestId('account-form')).toBeTruthy();
    expect(account!.signedIn).toBe(false);
    await signIn(ANI); // the normal password sign-in, only now
    expect(account!.signedIn).toBe(true);
    expect(opens).toHaveBeenCalledTimes(1);
    expect(authSent()).toEqual(['POST /token?grant_type=password']);
    none('start', 'email', 'code');
    await signOut();
    expect(byId('start')).toBeEnabled();
    expect(reg.register).toHaveBeenCalledTimes(1);
    expect(storedASecret()).toBe(false);
  });

  it('shows each refusal and stays open to retry; returning with «Sudah punya kode» signs nothing up', async () => {
    build(LOCAL_ON);
    await mount();
    await openForm('murid@gmail.com');
    await press('submit');
    expect(byId('status')).toHaveTextContent('Gunakan alamat email uji yang berakhiran .test.');
    reg.register.mockRejectedValueOnce(new RegistrationError('weak_password'));
    await type('email', EMAIL);
    await type('password', 'pendek');
    await press('submit');
    await settle();
    expect(byId('status')).toHaveTextContent(/Kata sandi terlalu lemah/);
    expect(stage()).toBe('email');

    await press('use-code');
    expect(stage()).toBe('code');
    for (const [failure, status] of [
      [new Error('GoTrue 500 at /verify'), 'Jawaban server akun tidak dikenali. Coba lagi.'],
      [new RegistrationError('invalid_code'), 'Kode tidak cocok atau sudah kedaluwarsa. Coba lagi.'],
    ] as const) {
      reg.confirm.mockRejectedValueOnce(failure);
      await confirmWith('111111');
      expect(byId('status')).toHaveTextContent(status);
      expect(screen.getByTestId('account-panel')).not.toHaveTextContent(/GoTrue|invalid_code|Account registration problem/);
      expect(byId('confirm')).toBeEnabled();
    }
    await confirmWith(CODE);
    expect(stage()).toBe('confirmed');
    expect(reg.register.mock.calls).toEqual([[EMAIL, 'pendek']]); // nothing for the use-code path
    expect(reg.confirm.mock.calls.map(([, code]) => code)).toEqual(['111111', '111111', CODE]);
    expect(account!.signedIn).toBe(false);
    expect(opens).not.toHaveBeenCalled();
  });

  it('going to the background cancels and clears a pending registration; its late reply revives nothing', async () => {
    build(LOCAL_ON);
    await mount();
    await openForm();
    const answer = holdRegister();
    await press('submit');
    expect(model()?.busy).toBe(true);
    await deliver('background');
    expect(reg.cancel).toHaveBeenCalled();
    expect(stage()).toBe('idle');
    none('email', 'password', 'code');
    await answer();
    expect(stage()).toBe('idle');
    none('code');

    await deliver('active');
    await press('start');
    expect([byId('email').props.value, byId('password').props.value]).toEqual(['', '']);
    expect(reg.register).toHaveBeenCalledTimes(1);
    expect(account!.signedIn).toBe(false);
  });

  it('a normal sign-in while registration is pending cancels it; neither its late reply nor the old model reaches the account', async () => {
    build(LOCAL_ON);
    await mount();
    await openForm();
    const answer = holdRegister();
    await press('submit');
    const stale = model()!;
    expect(stale.busy).toBe(true);

    await signIn(ANI);
    expect(reg.cancel).toHaveBeenCalled();
    expect(stage()).toBe('idle');
    await answer();
    await act(async () => {
      stale.onStart();
      stale.onRegister(EMAIL, PASSWORD);
      stale.onUseCode(EMAIL);
      stale.onConfirm(CODE);
      stale.onResend();
      await pause();
    });
    expect(stage()).toBe('idle');
    none('start', 'email', 'code', 'status');
    expect([reg.register.mock.calls.length, reg.confirm.mock.calls.length, reg.resend.mock.calls.length]).toEqual([1, 0, 0]);
    expect(account!.panel.account?.label).toBe(ANI.email);
    expect(account!.panel.error ?? null).toBeNull();
    expect(authSent()).toEqual(['POST /token?grant_type=password']);

    // Another account signs in: the flow stays dropped, and the newer account is the one shown.
    await signOut();
    await signIn(BUDI);
    expect(stage()).toBe('idle');
    expect(reg.register).toHaveBeenCalledTimes(1);
    expect(storedASecret()).toBe(false);
  });

  it('unmounting the provider disposes the registration once; a late reply publishes nothing', async () => {
    build(LOCAL_ON);
    const view = await mount();
    await openForm();
    const answer = holdRegister();
    await press('submit');
    const errors = jest.spyOn(console, 'error');
    await view.unmount();
    expect(reg.dispose).toHaveBeenCalledTimes(1);
    const last = account;
    await answer();
    expect(account).toBe(last);
    expect([reg.dispose.mock.calls.length, reg.register.mock.calls.length]).toEqual([1, 1]);
    expect(errors).not.toHaveBeenCalled();
    expect(opens).not.toHaveBeenCalled();
    expect(storedASecret()).toBe(false);
  });
});
