// A production build in the app's account layer, RED. With both explicit opt-ins (EXPO_PUBLIC_ACCOUNT_ENV=production and
// EXPO_PUBLIC_PRODUCTION_ACCOUNTS=on, beside EXPO_PUBLIC_AUTH_PROVIDER=local-supabase) the real AppProvider,
// AccountProvider, SDK, adapter, API client and KvStore datasets sign a real-format address in at the production Auth
// root and verify it at the production API, then sign out; nothing is created or copied, and the guest data is untouched.
// A local protocol fixture only: the fictional hosts (example.org) are answered by the frozen fakes of
// test/fakeAccountApi.ts, never resolved or contacted. No password or token reaches the device storage.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
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
  uid: 'uid-production-learner',
  token: 'legacy-fixture-token',
  accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
};

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
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
/** The production build: Google sign-in, remembering and password recovery all unset, so off. */
const PRODUCTION_BUILD: Partial<Record<(typeof BUILD_KEYS)[number], string>> = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_API_BASE_URL: PRODUCTION_API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: PRODUCTION_AUTH,
};
/** The process's own values, put back after every test. */
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);
const realFetch = globalThis.fetch;

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const GUEST_KEY = GUEST_NAMESPACE.kvKey;

let device: KvBackend = memoryKv();
/** Every entry written to the device storage in this test: no password or token may be among them. */
let written: string[] = [];
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;

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

function Probe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue;
  }, [accountValue, appValue]);
  return null;
}

beforeEach(() => {
  for (const key of BUILD_KEYS) {
    const value = PRODUCTION_BUILD[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  device = recordingDevice();
  written = [];
  account = null;
  app = null;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of BASELINE) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

it('a production build signs a real-format address in at the production Auth root and verifies it at the production API, creating and copying nothing', async () => {
  const fake = fakeAccountApi([LEARNER]);
  const net = productionNetwork(fake.fetch as unknown as typeof fetch);
  globalThis.fetch = net.fetch;
  let view: Awaited<ReturnType<typeof render>> | null = null;
  try {
    view = await render(
      <AppProvider storeFactory={openGuest}>
        <AccountProvider openDataset={openAccountDataset}>
          <Probe />
        </AccountProvider>
      </AppProvider>
    );
    await waitFor(() => expect(app?.ready).toBe(true));
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

    // Nothing is consented, created or copied, and the guest data is untouched.
    expect(app?.dataset).toBe('guest');
    expect(account?.connected).toBe(false);
    expect(fake.profiles).toHaveLength(0);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(account?.panel.signUp).toBe(false);
    expect(account?.panel.environment).toBe('production');

    await act(async () => {
      account?.panel.onSignOut();
    });
    await waitFor(() => expect(account?.signedIn).toBe(false), { timeout: 5000 });

    // No password or token ever reached the device storage (compared as a boolean, so none is printed).
    const secrets = [LEARNER.password, ...fake.auth.issued()];
    expect(written.some((entry) => secrets.some((secret) => entry.includes(secret)))).toBe(false);
  } finally {
    view?.unmount();
  }
});
