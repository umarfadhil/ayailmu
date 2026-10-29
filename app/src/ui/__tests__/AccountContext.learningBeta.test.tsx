// A learning-beta build in the app's account layer, RED. With EXPO_PUBLIC_ACCOUNT_ENV=learning-beta, EXPO_PUBLIC_LEARNING_BETA=on
// and EXPO_PUBLIC_APP_MODE=tester (beside EXPO_PUBLIC_AUTH_PROVIDER=local-supabase), the real AppProvider, AccountProvider, SDK,
// adapter, API client and KvStore datasets must offer ordinary email sign-in and nothing more: the provider has to give the API
// client its learning-beta capability, and the panel has to word the account as an ordinary one (not the local, staging or
// .test-account copy). The build sets all six flags EXPLICITLY to "off" (unset is refused by the config): production accounts,
// private QA, private beta, registration, Google sign-in and password recovery.
// Expected RED while the provider does not forward learningBeta to the API client: the render rejects; then, once it does,
// the panel's local copy fails the wording assertions.
// A local protocol fixture only: the fictional hosts (example.org) are answered by the frozen fakes of test/fakeAccountApi.ts,
// never resolved or contacted. No password or token reaches the device storage.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { fakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

/** A real-format address, known to the fake GoTrue only. */
const LEARNER: FakeUser = {
  email: 'learner@example.org',
  password: 'fixture-password-only',
  uid: 'uid-learning-beta-learner',
  token: 'legacy-fixture-token',
  accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
};

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_LEARNING_BETA',
  'EXPO_PUBLIC_APP_MODE',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_PRIVATE_QA',
  'EXPO_PUBLIC_PRIVATE_BETA',
  'EXPO_PUBLIC_ACCOUNT_REGISTRATION',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL',
  'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL',
  'EXPO_PUBLIC_REMEMBER_DEVICE',
  'EXPO_PUBLIC_PASSWORD_RECOVERY',
] as const;
/**
 * The learning-beta tester build: the six flags production accounts, private QA, private beta, registration, Google sign-in
 * and password recovery each EXPLICITLY "off" (the config refuses a build where any is unset); the remaining keys stay unset.
 */
const LEARNING_BETA_BUILD: Partial<Record<(typeof BUILD_KEYS)[number], string>> = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'learning-beta',
  EXPO_PUBLIC_LEARNING_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_PRIVATE_BETA: 'off',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'off',
  EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
  EXPO_PUBLIC_PASSWORD_RECOVERY: 'off',
  EXPO_PUBLIC_API_BASE_URL: PRODUCTION_API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: PRODUCTION_AUTH,
};
/** Flags a learning-beta build must refuse: set to anything but "off" beside it, the account layer is off. */
const FORBIDDEN_FLAGS = ['EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'EXPO_PUBLIC_GOOGLE_SIGN_IN', 'EXPO_PUBLIC_PASSWORD_RECOVERY'] as const;
/** The process's own values, put back after every test. */
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);
const realFetch = globalThis.fetch;

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const GUEST_KEY = GUEST_NAMESPACE.kvKey;

type Rendered = Awaited<ReturnType<typeof render>>;

let device: KvBackend = memoryKv();
/** Every entry written to the device storage in this test: no password or token may be among them. */
let written: string[] = [];
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let mounted: Rendered | null = null;

function recordingDevice(): KvBackend {
  const kv = memoryKv();
  return {
    getItem: (key) => kv.getItem(key),
    setItem: (key, value) => {
      written.push(`${key} ${value}`);
      kv.setItem(key, value);
    },
    removeItem: (key) => kv.removeItem(key),
  };
}

async function openGuest() {
  const guest = new KvStore(device);
  await guest.init();
  return guest;
}

function openAccountDataset(namespace: Namespace) {
  return openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });
}

/** Notes what the providers hand out, and shows the panel exactly as the account screen would. */
function Probe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue;
  }, [accountValue, appValue]);
  return <AccountPanel {...accountValue.panel} />;
}

/** The fake account server behind the fictional production roots; every request is noted, nothing else answers. */
function network(fake: ReturnType<typeof fakeAccountApi>) {
  const net = productionNetwork(fake.fetch as unknown as typeof fetch);
  globalThis.fetch = net.fetch;
  return net;
}

/** The real providers, rendered once the build's environment and fetch are set. The render itself is asserted to resolve. */
async function mountBuild(): Promise<Rendered> {
  const rendering = (async () =>
    render(
      <AppProvider storeFactory={openGuest}>
        <AccountProvider openDataset={openAccountDataset}>
          <Probe />
        </AccountProvider>
      </AppProvider>
    ))();
  await expect(rendering).resolves.toHaveProperty('unmount');
  mounted = await rendering;
  await waitFor(() => expect(app?.ready).toBe(true));
  return mounted;
}

beforeEach(() => {
  for (const key of BUILD_KEYS) {
    const value = LEARNING_BETA_BUILD[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  device = recordingDevice();
  written = [];
  account = null;
  app = null;
  mounted = null;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
  for (const [key, value] of BASELINE) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

it('a learning-beta build offers ordinary email sign-in only, worded as a normal account, and contacts nothing before the learner acts', async () => {
  const net = network(fakeAccountApi([LEARNER]));
  const view = await mountBuild();

  expect(account?.enabled).toBe(true);
  expect(net.requests).toEqual([]);

  // Ordinary email and account wording: never the local, staging or .test-account copy.
  const title = String(view.getByTestId('account-title').props.children);
  expect(title).toMatch(/^Akun/);
  expect(title).not.toMatch(/lokal|staging/i);
  expect(view.getByText('Email')).toBeTruthy();
  expect(view.getByPlaceholderText('nama@contoh.com')).toBeTruthy();
  for (const forbidden of [/\.test/i, /Email uji/, /lokal/i, /staging/i]) expect(view.queryByText(forbidden)).toBeNull();

  // No Google, sign-up or recovery offer, in the model or on the screen (the panel's own IDs and button texts).
  expect(account?.panel.signUp).toBe(false);
  expect(account?.panel.onGoogle).toBeUndefined();
  expect(account?.panel.registration ?? null).toBeNull();
  expect(account?.panel.recovery ?? null).toBeNull();
  for (const id of ['account-google', 'account-recovery-start']) expect(view.queryByTestId(id)).toBeNull();
  expect(view.queryByText(/Buat akun/)).toBeNull();
  expect(view.queryByText('Sudah punya akun')).toBeNull();
  expect(view.queryByText('Lanjutkan dengan Google')).toBeNull();
  expect(view.queryByText('Lupa kata sandi?')).toBeNull();

  // Looking at the screen is not an intent: still nothing was requested.
  expect(net.requests).toEqual([]);
});

it('a learning-beta build signs a conventional email in and verifies it at the API, creating and copying nothing, then signs out to the guest', async () => {
  const fake = fakeAccountApi([LEARNER]);
  const net = network(fake);
  const view = await mountBuild();
  const guestBytes = device.getItem(GUEST_KEY);
  expect(account?.enabled).toBe(true);
  expect(net.requests).toEqual([]);

  await act(async () => {
    account?.panel.onSubmit({ mode: 'signin', email: LEARNER.email, password: LEARNER.password });
  });
  await waitFor(
    () => {
      expect(account?.panel.error ?? null).toBeNull();
      expect(account?.signedIn).toBe(true);
      expect(account?.panel.busy ?? null).toBeNull();
    },
    { timeout: 5000 }
  );
  expect(net.requests).toEqual([`POST ${PRODUCTION_AUTH}/token?grant_type=password`, `GET ${PRODUCTION_API}/v1/me`]);
  expect(account?.panel.environment).toBe('learning-beta');
  expect(view.getByTestId('account-signout')).toBeTruthy();

  // Nothing is consented, created or copied, and the guest data is untouched.
  expect(app?.dataset).toBe('guest');
  expect(account?.connected).toBe(false);
  expect(account?.panel.connected ?? null).toBeNull();
  expect(fake.profiles).toHaveLength(0);
  expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
  expect(account?.panel.signUp).toBe(false);

  await act(async () => {
    account?.panel.onSignOut();
  });
  await waitFor(() => expect(account?.signedIn).toBe(false), { timeout: 5000 });
  expect(app?.dataset).toBe('guest');
  expect(account?.connected).toBe(false);
  expect(view.getByText('Belum masuk')).toBeTruthy();
  expect(device.getItem(GUEST_KEY)).toBe(guestBytes);

  // No password or token ever reached the device storage (compared as a boolean, so none is printed).
  const secrets = [LEARNER.password, ...fake.auth.issued()];
  expect(written.some((entry) => secrets.some((secret) => entry.includes(secret)))).toBe(false);
});

// A guard control: with the rest of the build valid, a flag that is not exactly "off" refuses it. These already hold, and
// must keep holding once the learning-beta capability is passed on.
it.each(FORBIDDEN_FLAGS)('a learning-beta build with %s switched on is off: it builds and requests nothing', async (flag) => {
  process.env[flag] = 'on';
  const fake = fakeAccountApi([LEARNER]);
  const net = network(fake);
  await mountBuild();

  expect(account?.enabled).toBe(false);
  expect(account?.signedIn).toBe(false);
  expect(net.requests).toEqual([]);
  expect(fake.auth.issued()).toEqual([]);
  expect(fake.profiles).toHaveLength(0);
});
