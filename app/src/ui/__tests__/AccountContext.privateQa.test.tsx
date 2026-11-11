// A private native QA build in the app's account layer, RED. With EXPO_PUBLIC_ACCOUNT_ENV=private-qa and
// EXPO_PUBLIC_PRIVATE_QA=on the real AppProvider and AccountProvider ask the device port (devicePrivateQaNetwork, the
// only double of the native boundary here) which fetch the account clients get. Ready: the actual Auth adapter, API
// client and registration factories are built with that one bound fetch and never the global one. Unavailable: no
// account client is built at all. Ordinary local and production builds keep their usual transport. Only constructors
// are observed: nothing signs in, registers or sends; both fetches refuse any request. Memory storage only, no CA, no
// real credential (the approved recipient is the profile's own constant, answered by an in-memory port only).
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Component, useEffect, type ReactNode } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { openKvDataset, type Namespace } from '@/account/datasets';
import { PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN, PRIVATE_QA_RECIPIENT, PRIVATE_QA_REGISTRATION_POLICY } from '@/account/privateQa';
import { loadSupabaseConfig, type SupabaseConfig } from '@/account/supabaseConfig';
import type { createApiClient } from '@/api/client';
import type { PrivateQaNetwork, PrivateQaNetworkFailure } from '@/auth/privateQaNetwork';
import type { Registration, RegistrationOptions } from '@/auth/registration';
import type { createSupabaseAuth } from '@/auth/supabaseAuth';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { useAccountRegistration, type AccountRegistrationState } from '@/ui/useAccountRegistration';

/** The Auth adapter's options as constructed. */
type AuthOptions = Parameters<typeof createSupabaseAuth>[0];
/** The API client's options, with the private transport and capability until ApiClientOptions names them. */
type ApiOptions = Parameters<typeof createApiClient>[0] & { fetch?: typeof fetch; privateQa?: true };
/** The registration factory's options, with its transport until RegistrationOptions names it. */
type RegistrationCall = RegistrationOptions & { fetch?: typeof fetch; emailPolicy?: unknown };
/** The context's private projection, until AccountContextValue names it. */
type PrivateAccountValue = AccountContextValue & { privateQa?: true; unavailableReason?: PrivateQaNetworkFailure };
/** The hook's options with the provider's transport, until useAccountRegistration takes it. */
type HookOptions = Parameters<typeof useAccountRegistration>[0] & { fetch?: typeof fetch };

// The device port: the only native boundary, answered per test.
const mockDevicePrivateQaNetwork = jest.fn<PrivateQaNetwork, [SupabaseConfig]>();
jest.mock('@/auth/privateQaDevice', () => ({
  devicePrivateQaNetwork: (config: SupabaseConfig) => mockDevicePrivateQaNetwork(config),
}));

// The actual factories, observed: each records its options, then the real constructor runs.
const mockAuthOptions = jest.fn<void, [AuthOptions]>();
jest.mock('@/auth/supabaseAuth', () => {
  const actual = jest.requireActual<typeof import('@/auth/supabaseAuth')>('@/auth/supabaseAuth');
  return { ...actual, createSupabaseAuth: (options: AuthOptions) => (mockAuthOptions(options), actual.createSupabaseAuth(options)) };
});
const mockApiOptions = jest.fn<void, [ApiOptions]>();
jest.mock('@/api/client', () => {
  const actual = jest.requireActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, createApiClient: (options: ApiOptions) => (mockApiOptions(options), actual.createApiClient(options)) };
});
// Registration's factory is the actual one by default; the hook case swaps in an in-memory port.
const mockCreateRegistration = jest.fn<Registration, [RegistrationCall]>();
jest.mock('@/auth/registration', () => ({
  ...jest.requireActual<typeof import('@/auth/registration')>('@/auth/registration'),
  createRegistration: (options: RegistrationCall) => mockCreateRegistration(options),
}));
const actualRegistration = jest.requireActual<typeof import('@/auth/registration')>('@/auth/registration');

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_PRIVATE_QA',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL',
  'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL',
  'EXPO_PUBLIC_REMEMBER_DEVICE',
  'EXPO_PUBLIC_PASSWORD_RECOVERY',
  'EXPO_PUBLIC_ACCOUNT_REGISTRATION',
] as const;
type Build = Partial<Record<(typeof BUILD_KEYS)[number], string>>;
/** The private QA build: Google sign-in, remembering, recovery and registration all unset, so off. */
const PRIVATE_BUILD: Build = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'private-qa',
  EXPO_PUBLIC_PRIVATE_QA: 'on',
  EXPO_PUBLIC_API_BASE_URL: PRIVATE_QA_API_ORIGIN,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: PRIVATE_QA_AUTH_ORIGIN,
};
/** The same build with its own registration policy on. */
const PRIVATE_REGISTERING: Build = { ...PRIVATE_BUILD, EXPO_PUBLIC_ACCOUNT_REGISTRATION: PRIVATE_QA_REGISTRATION_POLICY };
/** Ordinary builds, each with the private flag set beside it, which changes nothing there. */
const LOCAL_BUILD: Build = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_PRIVATE_QA: 'on',
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321',
};
const PRODUCTION_BUILD: Build = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
  EXPO_PUBLIC_PRIVATE_QA: 'on',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.example.org',
};
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);
const useBuild = (build: Build) =>
  BUILD_KEYS.forEach((key) => (build[key] === undefined ? delete process.env[key] : (process.env[key] = build[key])));
const realFetch = globalThis.fetch;

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
/** Development-only copy: the test-account wording, the .test rule and the private test inbox. */
const DEV_COPY = /\buji\b|\.test\b|kotak masuk|pribadi/i;
const PASSWORD = 'fixture-only-Pw-7731';

let device: KvBackend = memoryKv();
let account: PrivateAccountValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let caught: Error | null = null;
/** The global fetch while a test runs: it refuses, and must never be the private transport. */
let globalFetch: jest.Mock<Promise<Response>, Parameters<typeof fetch>>;
/** This test's one bound private fetch: it refuses any request, since nothing here may send. */
let boundFetch: jest.Mock<Promise<Response>, Parameters<typeof fetch>>;
const refusing = (what: string) =>
  jest.fn<Promise<Response>, Parameters<typeof fetch>>(() => Promise.reject(new Error(`No ${what} request is expected in this contract.`)));
const bound = () => boundFetch as unknown as typeof fetch;

async function openGuest() {
  const guest = new KvStore(device);
  await guest.init();
  return guest;
}

function openAccountDataset(namespace: Namespace) {
  return openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });
}

/** Keeps a provider that throws while rendering from failing the suite: the error becomes an assertion. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    caught = error instanceof Error ? error : new Error(String(error));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function AppProbe() {
  const value = useApp();
  useEffect(() => void (app = value), [value]);
  return null;
}

function Probe() {
  const value = useAccount();
  useEffect(() => void (account = value), [value]);
  return null;
}

/** The actual account panel, fed by the provider's own model. */
function PanelHost() {
  return <AccountPanel {...useAccount().panel} />;
}

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function mount(extra?: ReactNode) {
  const view = await render(
    <AppProvider storeFactory={openGuest}>
      <AppProbe />
      <Boundary>
        <AccountProvider openDataset={openAccountDataset}>
          <Probe />
          {extra}
        </AccountProvider>
      </Boundary>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  await flush();
  return view;
}

const authCalls = () => mockAuthOptions.mock.calls.map(([options]) => options);
const apiCalls = () => mockApiOptions.mock.calls.map(([options]) => options);
const registrationCalls = () => mockCreateRegistration.mock.calls.map(([options]) => options);
const emailPolicy = () => (account?.panel.registration as { emailPolicy?: unknown } | undefined)?.emailPolicy;

beforeEach(() => {
  device = memoryKv();
  account = null;
  app = null;
  caught = null;
  globalFetch = refusing('global');
  boundFetch = refusing('private');
  globalThis.fetch = globalFetch as unknown as typeof fetch;
  mockDevicePrivateQaNetwork.mockReset().mockImplementation(() => ({ state: 'off' }));
  mockAuthOptions.mockReset();
  mockApiOptions.mockReset();
  mockCreateRegistration.mockReset().mockImplementation((options) => actualRegistration.createRegistration(options));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useBuild(Object.fromEntries(BASELINE));
});

describe('AccountProvider in a private QA build', () => {
  it('a ready device turns the account layer on and gives the Auth adapter and API client the exact same bound fetch, never the global one', async () => {
    useBuild(PRIVATE_BUILD);
    mockDevicePrivateQaNetwork.mockImplementation(() => ({ state: 'ready', fetch: bound() }));
    const view = await mount();
    try {
      expect(caught?.message ?? null).toBeNull();
      expect(mockDevicePrivateQaNetwork).toHaveBeenCalledWith(expect.objectContaining({ environment: 'private-qa', privateQa: true }));
      expect(account?.enabled).toBe(true);
      expect(account?.panel.environment).toBe('private-qa');

      expect(authCalls().length).toBeGreaterThan(0);
      expect(apiCalls().length).toBeGreaterThan(0);
      for (const options of authCalls()) expect(options.fetch).toBe(bound());
      for (const options of apiCalls()) {
        expect(options).toMatchObject({ baseUrl: PRIVATE_QA_API_ORIGIN, environment: 'private-qa', privateQa: true });
        expect(options).not.toHaveProperty('productionAccounts', true);
        expect(options.fetch).toBe(bound());
      }

      // Construction sends nothing, and the global fetch is never the transport.
      expect(boundFetch).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('the private registration policy gives the panel its email policy and the registration factory the same bound fetch and policy', async () => {
    useBuild(PRIVATE_REGISTERING);
    mockDevicePrivateQaNetwork.mockImplementation(() => ({ state: 'ready', fetch: bound() }));
    const view = await mount();
    try {
      expect(caught?.message ?? null).toBeNull();
      expect(account?.panel.registration).toBeDefined();
      expect(emailPolicy()).toEqual(expect.stringMatching(/confirmed-email$/));

      expect(registrationCalls().length).toBeGreaterThan(0);
      for (const options of registrationCalls()) {
        expect(options.fetch).toBe(bound());
        expect(options.emailPolicy).toBe(emailPolicy());
      }
      expect(boundFetch).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('the actual account panel shows the normal Email registration under the private profile, never the development copy', async () => {
    useBuild(PRIVATE_REGISTERING);
    mockDevicePrivateQaNetwork.mockImplementation(() => ({ state: 'ready', fetch: bound() }));
    const view = await mount(<PanelHost />);
    const noDevCopy = () => (expect(view.queryAllByText(DEV_COPY)).toEqual([]), expect(view.queryAllByPlaceholderText(DEV_COPY)).toEqual([]));
    try {
      expect(caught?.message ?? null).toBeNull();
      expect(account?.panel.environment).toBe('private-qa');
      await waitFor(() => expect(account?.panel.registration?.available).toBe(true));
      expect(view.getByText(/^Daftar akun/)).toBeTruthy();
      noDevCopy();

      await act(async () => void fireEvent.press(view.getByTestId('account-registration-start')));
      await flush();
      expect(view.getByText('Email')).toBeTruthy();
      expect(view.getByTestId('account-registration-email')).toBeTruthy();
      noDevCopy();
      expect(boundFetch).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it.each<PrivateQaNetworkFailure>(['certificate', 'native'])(
    'an unavailable device (%s) keeps the account layer off, builds no client and projects only the reason',
    async (reason) => {
      useBuild(PRIVATE_REGISTERING);
      mockDevicePrivateQaNetwork.mockImplementation(() => ({ state: 'unavailable', reason }));
      const view = await mount();
      try {
        expect(caught?.message ?? null).toBeNull();
        expect(mockDevicePrivateQaNetwork).toHaveBeenCalledWith(expect.objectContaining({ environment: 'private-qa', privateQa: true }));
        expect(account?.enabled).toBe(false);
        expect(account?.privateQa).toBe(true);
        expect(account?.unavailableReason).toBe(reason);
        expect(account?.panel.registration).toBeUndefined();

        // No fallback: nothing is built, so nothing can reach the global fetch.
        expect(mockAuthOptions).not.toHaveBeenCalled();
        expect(mockApiOptions).not.toHaveBeenCalled();
        expect(mockCreateRegistration).not.toHaveBeenCalled();
        expect(globalFetch).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    }
  );

  it.each([
    ['local', LOCAL_BUILD, 'http://127.0.0.1:8092'],
    ['production', PRODUCTION_BUILD, 'https://api.example.org'],
  ] as const)('an ordinary %s build keeps its usual transport and never receives the private capability', async (_name, build, apiBaseUrl) => {
    useBuild(build);
    const view = await mount();
    try {
      expect(caught?.message ?? null).toBeNull();
      expect(account?.enabled).toBe(true);
      expect(account?.panel.environment).not.toBe('private-qa');
      expect(account?.privateQa).toBeUndefined();
      expect(account?.unavailableReason).toBeUndefined();

      expect(authCalls().length).toBeGreaterThan(0);
      for (const options of authCalls()) {
        expect(options.fetch).toBe(globalFetch);
        expect(options).not.toHaveProperty('privateQa');
      }
      expect(apiCalls().length).toBeGreaterThan(0);
      for (const options of apiCalls()) {
        expect(options.baseUrl).toBe(apiBaseUrl);
        expect(options).not.toHaveProperty('privateQa');
        expect(options.fetch).toBeUndefined();
      }
      expect(boundFetch).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });
});

describe('useAccountRegistration with the private transport', () => {
  const CURRENT_STATE = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  const OWNER = {};
  let listeners: ((state: AppStateStatus) => void)[] = [];
  let latest: AccountRegistrationState | null = null;

  const newPort = () =>
    ({
      register: jest.fn<Promise<{ status: 'confirmation_required' }>, [string, string]>().mockResolvedValue({ status: 'confirmation_required' }),
      confirm: jest.fn<Promise<{ status: 'confirmed'; signInRequired: true }>, [string, string]>().mockResolvedValue({ status: 'confirmed', signInRequired: true }),
      resend: jest.fn<Promise<{ status: 'resent' }>, [string]>().mockResolvedValue({ status: 'resent' }),
      cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      dispose: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    }) satisfies Registration;

  beforeEach(() => {
    latest = null;
    listeners = [];
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
  });

  it('builds with the given bound fetch, and a pending sign-up sent to the background and cancelled fences its late reply', async () => {
    useBuild(PRIVATE_REGISTERING);
    const config = loadSupabaseConfig();
    const ports: ReturnType<typeof newPort>[] = [];
    mockCreateRegistration.mockImplementation(() => {
      const port = newPort();
      ports.push(port);
      return port;
    });
    const options: HookOptions = { config, owner: OWNER, available: true, onIntent: jest.fn(), fetch: bound() };
    function Host() {
      const result = useAccountRegistration(options);
      useEffect(() => void (latest = result));
      return null;
    }
    const run = async (call: () => unknown) => (await act(async () => void (await call())), await flush());

    const view = await render(<Host />);
    try {
      expect(latest?.panel).toBeDefined();
      expect(registrationCalls().length).toBeGreaterThan(0);
      for (const call of registrationCalls()) {
        expect(call.fetch).toBe(bound());
        expect(call.emailPolicy).toEqual(expect.stringMatching(/confirmed-email$/));
      }

      let reply: (value: { status: 'confirmation_required' }) => void = () => undefined;
      await run(() => latest?.panel?.onStart());
      const port = ports[ports.length - 1];
      port.register.mockImplementation(() => new Promise((resolve) => (reply = resolve)));
      await run(() => latest?.panel?.onRegister(PRIVATE_QA_RECIPIENT, PASSWORD));
      expect(latest?.panel?.busy).toBe(true);
      const stale = latest?.panel;

      await run(() => listeners.forEach((listener) => listener('background')));
      await run(() => latest?.cancel());
      expect(port.cancel).toHaveBeenCalled();
      expect(latest?.panel).toMatchObject({ stage: 'idle', busy: false });

      await run(() => reply({ status: 'confirmation_required' }));
      await run(() => (stale?.onUseCode(PRIVATE_QA_RECIPIENT), stale?.onResend(), stale?.onStart()));
      expect(latest?.panel).toMatchObject({ stage: 'idle', busy: false });
      expect(port.register.mock.calls).toEqual([[PRIVATE_QA_RECIPIENT, PASSWORD]]);
      expect(ports.flatMap((each) => [...each.confirm.mock.calls, ...each.resend.mock.calls])).toEqual([]);
      expect(JSON.stringify(latest)).not.toContain(PASSWORD);
      expect(boundFetch).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });
});
