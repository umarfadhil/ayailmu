// Password recovery in the account layer (R1 in app/docs/plans/2026-10-20-session-recovery.md), written before that
// wiring. Only with EXPO_PUBLIC_PASSWORD_RECOVERY=on does the panel offer «Lupa kata sandi?»; without it the provider
// never touches its recovery runtime or store. The future provider props, reached through a test-local cast:
// - recoveryStore: the pending attempt's store (memoryRecoveryStore on native, sessionRecoveryStore on the web);
// - recoveryRuntime: { platform, takeLaunchUrl(callbackUrl), subscribe(onUrl) }, which only observes the launch link and
//   later links (it never opens a browser or sends mail). The callback is exactly arabictrial://recover on native, and
//   the runtime's own origin + /recover on the web.
// Panel test IDs: account-recovery-start, -email, -request, -status (every message), -password, -confirm (both secure
// entry), -update, -cancel, -back. Copy pinned by key phrase: the request says «Jika alamat ini terdaftar» and never that
// mail was sent; a mismatch «tidak sama»; a weak password «terlalu lemah»; success «sudah diganti». A recovery session
// changes the password only: nothing signs in, no account API, dataset, profile or consent work runs, and the guest
// data stays byte for byte. A recovery link at launch goes first: the pending Google attempt, the Google browser and the
// remembered-session vault are not touched, and leaving the app ends only the recovery session. The real AppProvider,
// AccountProvider, AccountPanel, SDK and adapter run over the frozen in-memory test/fakeRecoveryApi.ts: simulated
// provider evidence only, never real mail, a real Auth server, a browser or a device.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { webcrypto } from 'crypto';
import { useEffect } from 'react';

import { GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import type { GoogleAttemptRecord } from '@/auth/google';
import type { GoogleBrowser } from '@/auth/googleBrowser';
import { memoryRecoveryStore, sessionRecoveryStore, type RecoveryAttemptStore } from '@/auth/recovery';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { FAKE_RECOVERY_AUTH, fakeRecoveryApi, type FakeRecoveryApi } from '../../../test/fakeRecoveryApi';

jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));
jest.setTimeout(30_000);

const API = 'http://127.0.0.1:8092';
const ORIGIN = 'http://localhost:8081';
const NATIVE_RECOVER = 'arabictrial://recover';
const WEB_RECOVER = `${ORIGIN}/recover`;
const WEB_GOOGLE = `${ORIGIN}/account`;
const ANI = 'ani.recover@ayailmu.test';
const OLD_PASSWORD = 'pw-ani-old-ui-1';
const NEW_PASSWORD = 'pw-ani-new-ui-2';
const WEAK_PASSWORD = 'weak5';
const GUEST_KEY = GUEST_NAMESPACE.kvKey;
const GUEST_BLOB = JSON.stringify({
  schema: 2,
  meta: {},
  learner: { learner_id: 'lrn-guest-recovery', created_at: '2026-10-20T01:00:00.000Z', consent_version: 'demo-consent-0.1', consent_at: '2026-10-20T01:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: ['DEMO-S1'] },
  answers: [],
  snapshot: null,
  reports: [],
});

const BUILD_KEYS = ['EXPO_PUBLIC_AUTH_PROVIDER', 'EXPO_PUBLIC_ACCOUNT_ENV', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL', 'EXPO_PUBLIC_AUTH_EMULATOR_URL', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_GOOGLE_SIGN_IN', 'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL', 'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL', 'EXPO_PUBLIC_REMEMBER_DEVICE', 'EXPO_PUBLIC_PASSWORD_RECOVERY'] as const;
type Build = Partial<Record<(typeof BUILD_KEYS)[number], string>>;
const LOCAL: Build = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: API, EXPO_PUBLIC_SUPABASE_AUTH_URL: FAKE_RECOVERY_AUTH };
const RECOVERY: Build = { ...LOCAL, EXPO_PUBLIC_PASSWORD_RECOVERY: 'on' };
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);
function build(values: Build) {
  for (const key of BUILD_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** The future recovery runtime: the platform, the launch link, and later links. */
interface RecoveryRuntimePort {
  platform: { kind: 'web'; origin: string } | { kind: 'native'; unavailable: string | null };
  takeLaunchUrl(callbackUrl: string): string | null | Promise<string | null>;
  subscribe(onUrl: (url: string) => void): () => void;
}
interface SessionVaultPort {
  installation(): string;
  read(): string | null;
  write(text: string): void;
  clear(): void;
}
interface GoogleStorePort {
  save(record: GoogleAttemptRecord): void;
  take(): GoogleAttemptRecord | null;
  clear(): void;
}
const Provider = AccountProvider as unknown as (
  props: Parameters<typeof AccountProvider>[0] & {
    recoveryStore?: RecoveryAttemptStore | null;
    recoveryRuntime?: RecoveryRuntimePort | null;
    sessionVault?: SessionVaultPort | null;
    googleBrowser?: GoogleBrowser | null;
    googleStore?: GoogleStorePort | null;
  }
) => ReturnType<typeof AccountProvider>;

/** A scripted runtime: an optional launch link, and a listener the test can send a later link to. */
function runtime(platform: RecoveryRuntimePort['platform'], launch: string | null = null) {
  const seen = { taken: [] as string[], subscribed: 0 };
  let listener: ((url: string) => void) | null = null;
  let pending = launch;
  const port: RecoveryRuntimePort = {
    platform,
    takeLaunchUrl: (callbackUrl) => {
      seen.taken.push(callbackUrl);
      const url = pending;
      pending = null;
      return url;
    },
    subscribe: (onUrl) => {
      seen.subscribed += 1;
      listener = onUrl;
      return () => {
        listener = null;
      };
    },
  };
  return { port, seen, send: (url: string) => listener?.(url), listening: () => listener !== null };
}

/** `store`, counting every use. */
function counted(store: RecoveryAttemptStore) {
  const uses: string[] = [];
  const port: RecoveryAttemptStore = {
    save: (record) => (uses.push('save'), store.save(record)),
    take: () => (uses.push('take'), store.take()),
    clear: () => (uses.push('clear'), store.clear()),
  };
  return { port, uses };
}

const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
let device: KvBackend = memoryKv();
let server: FakeRecoveryApi = fakeRecoveryApi({ callbacks: [] });
let opened: string[] = [];
let unexpected: string[] = [];
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
const undo: (() => void)[] = [];
function replaceGlobal(name: 'fetch' | 'crypto', value: unknown) {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  undo.push(() => (before ? Object.defineProperty(globalThis, name, before) : Reflect.deleteProperty(globalThis, name)));
}

beforeEach(async () => {
  build({});
  device = memoryKv();
  await device.setItem(GUEST_KEY, GUEST_BLOB);
  server = fakeRecoveryApi({ callbacks: [NATIVE_RECOVER, WEB_RECOVER] });
  server.seed(ANI, OLD_PASSWORD);
  opened = [];
  unexpected = [];
  replaceGlobal('crypto', webcrypto);
  replaceGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith(`${FAKE_RECOVERY_AUTH}/`)) return server.fetch(input, init);
    unexpected.push(String(input));
    throw new TypeError('local test: only the fake Auth server is served');
  });
});
afterEach(() => {
  while (undo.length > 0) undo.pop()?.();
  for (const [key, value] of BASELINE) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  expect(unexpected).toEqual([]);
});

function Probe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue;
  }, [accountValue, appValue]);
  return accountValue.enabled ? <AccountPanel {...accountValue.panel} /> : null;
}

async function mount(props: Omit<Parameters<typeof Provider>[0], 'openDataset' | 'children'>) {
  account = null;
  app = null;
  const openGuest = async () => {
    const store = new KvStore(device);
    await store.init();
    return store;
  };
  const openDataset = (namespace: Namespace) => {
    opened.push(namespace.kvKey);
    return openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });
  };
  const view = await render(
    <AppProvider storeFactory={openGuest}>
      <Provider openDataset={openDataset} {...props}>
        <Probe />
      </Provider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  const guest = await device.getItem(GUEST_KEY);
  expect(guest).toContain('lrn-guest-recovery');
  return { view, guest };
}

const puts = () => server.calls.filter(({ method, path }) => method === 'PUT' && path === '/user').length;
const grants = (grant: string) => server.calls.filter((call) => call.grant === grant).length;

describe('password recovery in the account layer', () => {
  it('control: with the flag off, the panel offers no recovery and never touches its runtime or store', async () => {
    build(LOCAL);
    const rt = runtime({ kind: 'native', unavailable: null }, `${NATIVE_RECOVER}?code=5d3c1b2a-8f7e-4d6c-9b5a-4e3d2c1b0a9f`);
    const store = counted(memoryRecoveryStore());
    const { view, guest } = await mount({ recoveryStore: store.port, recoveryRuntime: rt.port });
    expect(screen.getByTestId('account-email')).toBeTruthy();
    expect(screen.queryByTestId('account-recovery-start')).toBeNull();
    expect(screen.queryByText('Lupa kata sandi?')).toBeNull();
    await act(async () => view.unmount());
    expect({ taken: rt.seen.taken, subscribed: rt.seen.subscribed, store: store.uses, calls: server.calls.length, opened }).toEqual({ taken: [], subscribed: 0, store: [], calls: 0, opened: [] });
    expect(await device.getItem(GUEST_KEY)).toBe(guest);
  });

  it('requests a link, takes it from the runtime, changes the password through the form, and signs nothing in', async () => {
    build(RECOVERY);
    const rt = runtime({ kind: 'native', unavailable: null });
    const { view, guest } = await mount({ recoveryStore: memoryRecoveryStore(), recoveryRuntime: rt.port });
    await fireEvent.press(screen.getByTestId('account-recovery-start'));
    expect(screen.getByText('Lupa kata sandi?')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('account-recovery-email'), ANI);
    await fireEvent.press(screen.getByTestId('account-recovery-request'));
    await waitFor(() => expect(screen.getByTestId('account-recovery-status')).toHaveTextContent(/Jika alamat ini terdaftar/), { timeout: 5000 });
    expect(screen.getByTestId('account-recovery-status')).not.toHaveTextContent(/terkirim|telah dikirim|tidak terdaftar/i);
    expect(server.mailbox).toHaveLength(1);
    await waitFor(() => expect(rt.listening()).toBe(true));
    await act(async () => rt.send(server.mailbox[0]?.callback ?? ''));
    await waitFor(() => expect(screen.getByTestId('account-recovery-password')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByTestId('account-recovery-password').props.secureTextEntry).toBe(true);
    expect(screen.getByTestId('account-recovery-confirm').props.secureTextEntry).toBe(true);
    expect(server.liveSessions(ANI)).toBe(1);

    const attempt = async (password: string, confirmation: string) => {
      await fireEvent.changeText(screen.getByTestId('account-recovery-password'), password);
      await fireEvent.changeText(screen.getByTestId('account-recovery-confirm'), confirmation);
      await fireEvent.press(screen.getByTestId('account-recovery-update'));
    };
    await attempt(NEW_PASSWORD, `${NEW_PASSWORD}x`);
    await waitFor(() => expect(screen.getByTestId('account-recovery-status')).toHaveTextContent(/tidak sama/));
    expect(puts()).toBe(0);
    await attempt(WEAK_PASSWORD, WEAK_PASSWORD);
    await waitFor(() => expect(screen.getByTestId('account-recovery-status')).toHaveTextContent(/terlalu lemah/), { timeout: 5000 });
    expect(screen.getByTestId('account-recovery-status')).not.toHaveTextContent(new RegExp(`${WEAK_PASSWORD}|Password should be`));
    expect({ puts: puts(), live: server.liveSessions(ANI) }).toEqual({ puts: 1, live: 1 });
    await attempt(NEW_PASSWORD, NEW_PASSWORD);
    await waitFor(() => expect(screen.getByTestId('account-recovery-status')).toHaveTextContent(/sudah diganti/), { timeout: 5000 });
    expect({ puts: puts(), live: server.liveSessions(ANI), passwordGrants: grants('password') }).toEqual({ puts: 2, live: 0, passwordGrants: 0 });
    expect(server.calls.filter(({ path }) => path === '/logout').map(({ scope }) => scope)).toEqual(['local']);
    expect(account?.signedIn).toBe(false);

    await fireEvent.press(screen.getByTestId('account-recovery-back'));
    expect(screen.getByTestId('account-email')).toBeTruthy();
    expect(account?.signedIn).toBe(false);
    await act(async () => view.unmount());
    expect({ opened, live: server.liveSessions(ANI) }).toEqual({ opened: [], live: 0 });
    expect(await device.getItem(GUEST_KEY)).toBe(guest);
  });

  it('a recovery link at launch goes first, leaving Google and the remembered session alone, and leaving ends only it', async () => {
    build({ ...RECOVERY, EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: WEB_GOOGLE, EXPO_PUBLIC_REMEMBER_DEVICE: 'on' });
    // The pending attempt, as an earlier page of this tab requested it through the real adapter.
    const tab = new Map<string, string>();
    const shared = sessionRecoveryStore({ getItem: (key) => tab.get(key) ?? null, setItem: (key, value) => void tab.set(key, value), removeItem: (key) => void tab.delete(key) });
    const earlier = createSupabaseAuth({
      config: { enabled: true, provider: 'local-supabase', apiBaseUrl: API, authUrl: FAKE_RECOVERY_AUTH },
      fetch: server.fetch,
      recovery: { config: { enabled: true, platform: 'web', callbackUrl: WEB_RECOVER }, store: shared },
    });
    expect(await earlier.recovery?.request(ANI)).toEqual({ requested: true });
    const link = server.mailbox[0]?.callback ?? '';
    expect(link.startsWith(`${WEB_RECOVER}?code=`)).toBe(true);
    // A pending Google attempt and a remembered record, which this launch must leave exactly as they are.
    const googleRecord: GoogleAttemptRecord = { v: 1, flowId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', verifier: 'f'.repeat(64), callbackUrl: WEB_GOOGLE, createdAt: Date.now() };
    const googleUses: string[] = [];
    let googleHeld: GoogleAttemptRecord | null = { ...googleRecord };
    const googleStore: GoogleStorePort = {
      save: (record) => void (googleUses.push('save'), (googleHeld = { ...record })),
      take: () => (googleUses.push('take'), googleHeld),
      clear: () => void (googleUses.push('clear'), (googleHeld = null)),
    };
    const googleTaken: string[] = [];
    const googleBrowser = {
      platform: { kind: 'web', origin: ORIGIN },
      takeLaunchUrl: (callbackUrl: string) => (googleTaken.push(callbackUrl), null),
      open: async () => {
        throw new Error('local test: no browser opens');
      },
    } as unknown as GoogleBrowser;
    const remembered = JSON.stringify({ v: 1, kind: 'password', installation: 'install-recovery-ui', auth: FAKE_RECOVERY_AUTH, api: API, profile: 'local', uid: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6', email: 'budi.remembered@ayailmu.test', accountId: '7c2e2a5f-3d4b-4e6f-9a71-82b3c4d5e6f7', refreshToken: 'remembered-refresh-token-ui', savedAt: new Date(Date.now()).toISOString() });
    const vaultUses: string[] = [];
    let vaultText: string | null = remembered;
    const sessionVault: SessionVaultPort = {
      installation: () => 'install-recovery-ui',
      read: () => (vaultUses.push('read'), vaultText),
      write: (text) => void (vaultUses.push('write'), (vaultText = text)),
      clear: () => void (vaultUses.push('clear'), (vaultText = null)),
    };
    const rt = runtime({ kind: 'web', origin: ORIGIN }, link);

    const { view, guest } = await mount({ recoveryStore: shared, recoveryRuntime: rt.port, googleStore, googleBrowser, sessionVault });
    await waitFor(() => expect(screen.getByTestId('account-recovery-password')).toBeTruthy(), { timeout: 5000 });
    expect(rt.seen.taken).toEqual([WEB_RECOVER]);
    expect({ live: server.liveSessions(ANI), signedIn: account?.signedIn, opened }).toEqual({ live: 1, signedIn: false, opened: [] });
    await act(async () => view.unmount());
    await waitFor(() => expect(server.liveSessions(ANI)).toBe(0));
    expect({ googleUses, googleHeld, googleTaken, vaultUses, vaultText }).toEqual({ googleUses: [], googleHeld: googleRecord, googleTaken: [], vaultUses: [], vaultText: remembered });
    expect({ refreshGrants: grants('refresh_token'), passwordGrants: grants('password'), puts: puts(), opened }).toEqual({ refreshGrants: 0, passwordGrants: 0, puts: 0, opened: [] });
    expect(server.calls.filter(({ path }) => path === '/logout').every(({ scope }) => scope === 'local')).toBe(true);
    expect(await device.getItem(GUEST_KEY)).toBe(guest);
  });
});
