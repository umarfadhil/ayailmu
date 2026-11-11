// Source-only regression: real providers, readiness preparation, Home, Account route and account panel.
// The native bridge and all network I/O are fixtures. This is not native, device or live-service proof.
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useEffect } from 'react';

import type { SupabaseConfig } from '@/account/supabaseConfig';
import { accountNamespace, openKvDataset, type Namespace } from '@/account/datasets';
import Account from '@/app/account';
import type { PrivateQaBridge, PrivateQaNativeReply, PrivateQaNativeRequest } from '@/auth/privateQaTransport';
import type { SessionVault } from '@/auth/types';
import { StarterHome } from '@/pilot/unitA/StarterHome';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';

const HASH = 'a'.repeat(64);
let mockBridge: PrivateQaBridge | null = null;
const mockLoadBridge = jest.fn(() => mockBridge);
jest.mock('@/auth/localDevelopmentNetwork', () => {
  const actual = jest.requireActual('@/auth/localDevelopmentNetwork');
  return {
    ...actual,
    deviceLocalDevelopmentNetwork: (config: SupabaseConfig) => actual.prepareLocalDevelopmentNetwork(config, {
      platform: 'ios', expectedCaSha256: 'a'.repeat(64), loadBridge: mockLoadBridge,
    }),
  };
});
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory', openStore: async () => { throw Error('This test supplies its guest store.'); },
}));

const BUILD = {
  EXPO_PUBLIC_APP_MODE: 'tester', EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_ACCOUNT_ENV: 'local-development',
  EXPO_PUBLIC_LOCAL_DEVELOPMENT: 'on', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off', EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_PRIVATE_BETA: 'off', EXPO_PUBLIC_LEARNING_BETA: 'off', EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
  EXPO_PUBLIC_PASSWORD_RECOVERY: 'off', EXPO_PUBLIC_REMEMBER_DEVICE: 'off', EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'confirmed-email',
  EXPO_PUBLIC_NORMAL_USER_STARTER: 'on', EXPO_PUBLIC_API_BASE_URL: 'https://localhost:58444',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://localhost:58445',
};
const baseline = Object.keys(BUILD).map((key) => [key, process.env[key]] as const);
const originalFetch = globalThis.fetch;
const fallback = jest.fn(() => Promise.reject(Error('Global network access is forbidden in this fixture.')));
const request = jest.fn<Promise<PrivateQaNativeReply>, [PrivateQaNativeRequest]>();
let latest: AccountContextValue | undefined;
let app: ReturnType<typeof useApp> | undefined;

function Probe() {
  const account = useAccount();
  const appValue = useApp();
  useEffect(() => { latest = account; app = appValue; }, [account, appValue]);
  return null;
}

function readyBridge(): PrivateQaBridge {
  return {
    binding: () => ({ enabled: true, apiOrigin: BUILD.EXPO_PUBLIC_API_BASE_URL, authOrigin: BUILD.EXPO_PUBLIC_SUPABASE_AUTH_URL, caSha256: HASH }),
    request, cancel: jest.fn(),
  };
}

async function mount(initialUrl = '/', reviewed = true, options: { sessionVault?: SessionVault; hydration?: Promise<void> } = {}) {
  const kv = memoryKv();
  const guest = new KvStore(kv);
  await guest.init();
  const opened: Namespace[] = [];
  const locks: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
  const openDataset = (namespace: Namespace) => { opened.push(namespace); return openKvDataset({ kv, locks, namespace }); };
  const storeFactory = async () => { await options.hydration; return guest; };
  function Layout() {
    return <AppProvider storeFactory={storeFactory}><AccountProvider openDataset={openDataset} sessionVault={options.sessionVault}><Probe /><Slot /></AccountProvider></AppProvider>;
  }
  await renderRouter({
    _layout: Layout,
    index: () => <StarterHome reviewed={reviewed} audience="normal-user" />,
    account: Account,
  }, { initialUrl });
  await waitFor(() => expect(options.hydration ? latest !== undefined : app?.ready).toBe(true));
  return { opened };
}

function expectNoTransportDetails() {
  const text = JSON.stringify(screen.toJSON());
  expect(text).not.toMatch(/localhost|172\.20\.10\.2|5844[45]|https?:\/\/|sha256|certificate|sertifikat|native|binding|EXPO_PUBLIC_/i);
  expect(text).not.toContain(HASH);
}

beforeEach(() => {
  Object.assign(process.env, BUILD);
  latest = undefined; app = undefined; mockBridge = null;
  mockLoadBridge.mockClear(); request.mockReset().mockImplementation(() => Promise.reject(Error('Fixture connection unavailable.'))); fallback.mockClear();
  globalThis.fetch = fallback as unknown as typeof fetch;
});
afterEach(() => {
  for (const [key, value] of baseline) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
});

it('keeps account access visible while transport is unavailable; retry rechecks all gates before showing sign-in', async () => {
  await mount();
  expect(latest?.enabled).toBe(false);
  expect(screen.getByTestId('welcome-account')).toHaveTextContent('Akun');
  expect(screen.getByTestId('account-connection-unavailable')).toHaveTextContent(/koneksi akun belum siap/i);
  expect(screen.getByTestId('beta-starter-start')).toHaveTextContent(/Mulai/);
  expectNoTransportDetails();
  await fireEvent.press(screen.getByTestId('welcome-account'));
  await waitFor(() => expect(screen).toHavePathname('/account'));
  expect(screen.getByTestId('account-connection-unavailable')).toHaveTextContent(/data tetap tersimpan di perangkat ini/i);
  expect(screen.queryByTestId('account-form')).toBeNull();
  expect(screen.queryByTestId('account-disabled')).toBeNull();

  // A module with the wrong certificate binding is still unavailable after an explicit retry.
  mockBridge = { ...readyBridge(), binding: () => ({ ...readyBridge().binding()!, caSha256: 'b'.repeat(64) }) };
  await fireEvent.press(screen.getByTestId('account-connection-retry'));
  expect(latest?.enabled).toBe(false);
  expect(screen.getByTestId('account-connection-unavailable')).toBeTruthy();
  expect(screen.queryByTestId('account-form')).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  expectNoTransportDetails();

  mockBridge = readyBridge();
  await fireEvent.press(screen.getByTestId('account-connection-retry'));
  await waitFor(() => expect(screen.getByTestId('account-form')).toBeTruthy());
  expect(latest?.enabled).toBe(true);
  expect(latest?.signedIn).toBe(false);
  expect(latest?.connected).toBe(false);
  expect(screen.getByTestId('account-status')).toHaveTextContent('Belum masuk');
  expect(screen.getByTestId('account-registration-start')).toBeTruthy();
  expect(screen.queryByTestId('account-connection-unavailable')).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

it('keeps pending learning review blocked while explaining unavailable account transport', async () => {
  await mount('/', false);
  expect(screen.getByText('Materi awal sedang ditinjau')).toBeTruthy();
  expect(screen.queryByTestId('beta-starter-start')).toBeNull();
  expect(screen.queryByTestId('beta-starter-open')).toBeNull();
  expect(screen.getByTestId('account-connection-unavailable')).toBeTruthy();
  expect(screen.getByTestId('welcome-account')).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

it('distinguishes a disabled backend configuration from unavailable local transport and offers no readiness retry', async () => {
  process.env.EXPO_PUBLIC_AUTH_PROVIDER = 'off';
  await mount('/account');
  expect(latest?.enabled).toBe(false);
  expect(screen.getByTestId('account-disabled')).toHaveTextContent(/layanan akun belum tersedia di build ini/i);
  expect(screen.queryByTestId('account-connection-unavailable')).toBeNull();
  expect(screen.queryByTestId('account-connection-retry')).toBeNull();
  expect(screen.queryByTestId('account-form')).toBeNull();
  expect(mockLoadBridge).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
});

it('keeps ready, signed-out account access and retries a temporary connection failure through the normal sign-in form', async () => {
  mockBridge = readyBridge();
  await mount();
  expect(screen.getByTestId('welcome-account')).toHaveTextContent('Masuk ke akun');
  expect(screen.queryByTestId('account-connection-unavailable')).toBeNull();
  await fireEvent.press(screen.getByTestId('welcome-account'));
  await waitFor(() => expect(screen).toHavePathname('/account'));
  await fireEvent.changeText(screen.getByTestId('account-email'), 'fixture@example.org');
  await fireEvent.changeText(screen.getByTestId('account-password'), 'fixture-only-password');
  await fireEvent.press(screen.getByTestId('account-submit'));
  await waitFor(() => expect(screen.getByTestId('account-error')).toHaveTextContent(/tidak terjangkau/i));
  expect(latest?.enabled).toBe(true);
  expect(latest?.signedIn).toBe(false);
  expect(screen.queryByTestId('account-connection-unavailable')).toBeNull();
  await waitFor(() => expect(latest?.panel.busy).toBeNull());
  expect(screen.getByTestId('account-password')).toHaveDisplayValue('');
  expect(request).toHaveBeenCalledTimes(1);
  await fireEvent.changeText(screen.getByTestId('account-password'), 'fixture-only-password');
  expect(screen.getByTestId('account-submit')).not.toBeDisabled();
  await fireEvent.press(screen.getByTestId('account-submit'));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(latest?.panel.busy).toBeNull());
  expect(fallback).not.toHaveBeenCalled();
  expectNoTransportDetails();
});

const REMEMBERED: FakeUser = { email: 'remembered@fixture.test', password: 'fixture-password-a', uid: 'remembered-A', token: 'unused-fixture-token-a', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };
const EXPLICIT: FakeUser = { email: 'explicit@fixture.test', password: 'fixture-password-b', uid: 'explicit-B', token: 'unused-fixture-token-b', accountId: '7c2e2a5f-3d4b-4e6f-9a71-82b3c4d5e6f7' };

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function savedVault(fake: FakeAccountApi) {
  // A session minted by an earlier fixture run, bound to this exact installation/profile and account.
  const response = await fake.fetch(`${FAKE_GOTRUE}/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: REMEMBERED.email, password: REMEMBERED.password }),
  });
  const body = await response.json() as { refresh_token: string };
  const state = { text: JSON.stringify({
    v: 1, kind: 'password', installation: 'availability-fixture-installation',
    auth: BUILD.EXPO_PUBLIC_SUPABASE_AUTH_URL, api: BUILD.EXPO_PUBLIC_API_BASE_URL, profile: 'local-development',
    uid: providerUserId(REMEMBERED), email: REMEMBERED.email, accountId: REMEMBERED.accountId,
    refreshToken: body.refresh_token, savedAt: new Date().toISOString(),
  }) as string | null, reads: 0, writes: 0 };
  const port: SessionVault = {
    installation: () => 'availability-fixture-installation',
    read: () => { state.reads += 1; return state.text; },
    write: (text) => { state.writes += 1; state.text = text; },
    clear: () => { state.text = null; },
  };
  return { state, port };
}

function fixtureNetwork(fake: FakeAccountApi, holdRefresh?: { promise: Promise<void>; received: boolean; returned: boolean }) {
  request.mockImplementation(async (asked) => {
    const local = asked.url.startsWith(`${BUILD.EXPO_PUBLIC_API_BASE_URL}/`)
      ? FAKE_API + asked.url.slice(BUILD.EXPO_PUBLIC_API_BASE_URL.length)
      : asked.url.startsWith(`${BUILD.EXPO_PUBLIC_SUPABASE_AUTH_URL}/`)
        ? FAKE_GOTRUE + asked.url.slice(BUILD.EXPO_PUBLIC_SUPABASE_AUTH_URL.length)
        : null;
    if (local === null) throw Error('Unexpected fixture origin.');
    const response = await fake.fetch(local, { method: asked.method, headers: asked.headers, body: asked.body });
    const reply = { status: response.status, headers: { 'content-type': 'application/json' }, body: await response.text(), url: asked.url };
    if (holdRefresh && asked.url.endsWith('/token?grant_type=refresh_token')) {
      holdRefresh.received = true;
      await holdRefresh.promise;
      holdRefresh.returned = true;
    }
    return reply;
  });
}

it('defers the one remembered restore until transport retry is ready, then verifies that account without choosing a learning profile', async () => {
  process.env.EXPO_PUBLIC_REMEMBER_DEVICE = 'on';
  const fake = fakeAccountApi([REMEMBERED]);
  const vault = await savedVault(fake);
  const from = fake.wire.length;
  const { opened } = await mount('/account', true, { sessionVault: vault.port });
  expect(latest?.enabled).toBe(false);
  expect(vault.state.reads).toBe(0);
  fixtureNetwork(fake);

  mockBridge = { ...readyBridge(), binding: () => ({ ...readyBridge().binding()!, caSha256: 'b'.repeat(64) }) };
  await fireEvent.press(screen.getByTestId('account-connection-retry'));
  expect(latest?.enabled).toBe(false);
  expect(vault.state.reads).toBe(0);
  expect(request).not.toHaveBeenCalled();

  mockBridge = readyBridge();
  await fireEvent.press(screen.getByTestId('account-connection-retry'));
  await waitFor(() => expect(latest?.panel.account?.label).toBe(REMEMBERED.email));
  await waitFor(() => expect(latest?.panel.busy).toBeNull());
  expect(fake.wire.slice(from).filter((wire) => wire.query === 'grant_type=refresh_token')).toHaveLength(1);
  expect(fake.wire.slice(from).filter((wire) => wire.query === 'grant_type=password')).toHaveLength(0);
  expect(fake.wire.slice(from).filter((wire) => wire.path === '/v1/me')).toHaveLength(1);
  expect(vault.state.reads).toBe(1);
  expect(vault.state.writes).toBe(1);
  expect(opened).toEqual([accountNamespace(REMEMBERED.accountId)]);
  expect(latest?.signedIn).toBe(true);
  expect(latest?.connected).toBe(false);
  expect(app?.dataset).toBe('guest');
  expect(fake.profiles).toHaveLength(0);
  await fireEvent.press(screen.getByLabelText('Kembali ke beranda'));
  await waitFor(() => expect(screen).toHavePathname('/'));
  expect(fake.wire.slice(from).filter((wire) => wire.query === 'grant_type=refresh_token')).toHaveLength(1);
  expect(fallback).not.toHaveBeenCalled();
});

it('does not bypass guest hydration when transport becomes ready with a remembered session waiting', async () => {
  process.env.EXPO_PUBLIC_REMEMBER_DEVICE = 'on';
  const fake = fakeAccountApi([REMEMBERED]);
  const vault = await savedVault(fake);
  const hydration = deferred();
  await mount('/account', true, { sessionVault: vault.port, hydration: hydration.promise });
  fixtureNetwork(fake);
  mockBridge = readyBridge();
  await act(async () => { latest?.connectionUnavailable?.onRetry(); });
  expect(latest?.enabled).toBe(true);
  expect(app?.ready).toBe(false);
  expect(vault.state.reads).toBe(0);
  expect(request).not.toHaveBeenCalled();
  await act(async () => { hydration.release(); });
  await waitFor(() => expect(latest?.panel.account?.label).toBe(REMEMBERED.email));
  expect(vault.state.reads).toBe(1);
  expect(latest?.connected).toBe(false);
  expect(app?.dataset).toBe('guest');
  expect(fallback).not.toHaveBeenCalled();
});

it('keeps a newer explicit sign-in when a remembered refresh started by transport retry returns late', async () => {
  process.env.EXPO_PUBLIC_REMEMBER_DEVICE = 'on';
  const fake = fakeAccountApi([REMEMBERED, EXPLICIT]);
  const vault = await savedVault(fake);
  const gate = deferred();
  const hold = { promise: gate.promise, received: false, returned: false };
  const { opened } = await mount('/account', true, { sessionVault: vault.port });
  fixtureNetwork(fake, hold);
  mockBridge = readyBridge();
  await fireEvent.press(screen.getByTestId('account-connection-retry'));
  await waitFor(() => expect(hold.received).toBe(true));
  expect(latest?.signedIn).toBe(false);
  await fireEvent.changeText(screen.getByTestId('account-email'), EXPLICIT.email);
  await fireEvent.changeText(screen.getByTestId('account-password'), EXPLICIT.password);
  await fireEvent.press(screen.getByTestId('account-submit'));
  await waitFor(() => expect(latest?.panel.account?.label).toBe(EXPLICIT.email));
  await act(async () => { gate.release(); });
  await waitFor(() => expect(hold.returned).toBe(true));
  await waitFor(() => expect(latest?.panel.busy).toBeNull());
  expect(latest?.panel.account?.label).toBe(EXPLICIT.email);
  expect(opened).toEqual([accountNamespace(EXPLICIT.accountId)]);
  expect(vault.state.text).toBeNull();
  expect(vault.state.writes).toBe(0);
  expect(latest?.connected).toBe(false);
  expect(app?.dataset).toBe('guest');
  expect(fallback).not.toHaveBeenCalled();
});
