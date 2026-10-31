// Protocol-fixture verification of optional-feature wiring, NOT a live-backend, native or phone test.
// The real providers, SDK, API client and AccountPanel run together; the network, the Node
// webcrypto/TextEncoder/btoa browser globals and the Google/recovery ports are fixtures.
// Provider activation (OAuth redirect, recovery mail) is NOT exercised: the fake ports never
// open anything. This proves source/provider wiring only, not device or live-service behavior.
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect, type ComponentProps } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { openKvDataset, type Namespace } from '@/account/datasets';
import { memoryRecoveryStore } from '@/auth/recovery';
import { PILOT_CONTENT } from '@/pilot/unitA/content';
import { starterReviewAccess, UNIT_A_STARTER_REVIEW } from '@/pilot/unitA/review';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';
import { sha256Hex } from '@/sync/sha256';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AppProvider, useApp } from '@/ui/AppContext';
import { fakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';

jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => { throw new Error('Guest storage must be supplied by this fixture.'); },
}));

jest.setTimeout(30_000);
type Ports = ComponentProps<typeof AccountProvider>;
type Browser = NonNullable<Ports['googleBrowser']>;
type Runtime = NonNullable<Ports['recoveryRuntime']>;

const USER: FakeUser = { email: 'capabilities.a@example.org', password: 'fixture-password-a', uid: 'uid-A', token: 'legacy-fixture-token-a', accountId: '5d1e8f3a-2b7c-4d96-8a10-c3e94f7b2a58' };
const WEB_ORIGIN = 'https://learn.example.org';
const BUILD = {
  EXPO_PUBLIC_NORMAL_USER_STARTER: 'on', EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_ACCOUNT_ENV: 'production',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on', EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'confirmed-email',
  EXPO_PUBLIC_PRIVATE_QA: 'off', EXPO_PUBLIC_PRIVATE_BETA: 'off', EXPO_PUBLIC_LEARNING_BETA: 'off',
  EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_PASSWORD_RECOVERY: 'on', EXPO_PUBLIC_REMEMBER_DEVICE: 'off',
  EXPO_PUBLIC_API_BASE_URL: PRODUCTION_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: PRODUCTION_AUTH,
  EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: 'arabictrial://account',
  EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: `${WEB_ORIGIN}/account`,
};
const EXTRA_KEYS = ['EXPO_PUBLIC_AUTH_EMULATOR_URL', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'];
const KEYS = [...Object.keys(BUILD), ...EXTRA_KEYS];
const BASELINE = KEYS.map((key) => [key, process.env[key]] as const);
const GLOBAL_NAMES = ['crypto', 'TextEncoder', 'btoa'] as const;
const GLOBAL_FIXTURES: Record<(typeof GLOBAL_NAMES)[number], unknown> = {
  crypto: webcrypto, TextEncoder, btoa: (binary: string) => Buffer.from(binary, 'binary').toString('base64'),
};
const realFetch = globalThis.fetch;
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const MAIL_REQUEST = /recover|authorize|\/otp|magiclink|provider=google/i;
const SOON = { timeout: 5000 };
const GOOGLE_CONTROL = 'account-google';
const FORGOT_CONTROL = 'account-recovery-start';
const GOOGLE_NOTE = 'account-google-unavailable';
const RECOVERY_NOTE = 'account-recovery-unavailable';
const ACTUAL_SHA256 = '5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e';
const ACTUAL_REVIEWED_AT = '2026-10-30T10:25:22.000Z';

/**
 * A guard only: these account-panel cases never read the Unit A review. It pins the actual compiled record as the owner-authorized,
 * AI-only trial acceptance of the exact current draft content (one coordinating AI reviewer under all three sections). Not
 * human/expert review, not three independent reviewers, and no efficacy, native or backend proof; the content stays a synthetic draft.
 */
function expectActualAiAcceptedRecord() {
  const section = { reviewer: expect.stringMatching(/^\/root\/check_fasih_expo .*AI-only/), reviewedAt: ACTUAL_REVIEWED_AT };
  expect(UNIT_A_STARTER_REVIEW).toMatchObject({
    status: 'approved-for-trial', contentVersion: PILOT_CONTENT.contentVersion, contentSha256: ACTUAL_SHA256,
    reviews: { arabic: section, indonesian: section, assessment: section },
  });
  expect(sha256Hex(JSON.stringify(PILOT_CONTENT))).toBe(ACTUAL_SHA256);
  expect(starterReviewAccess()).toEqual({ allowed: true });
  expect(PILOT_CONTENT).toMatchObject({ synthetic: true, constructed: true, reviewStatus: 'draft' });
}

// A box read through getters, so resetting it in beforeEach never narrows later reads to null.
const probe: { account: AccountContextValue | null; app: ReturnType<typeof useApp> | null } = { account: null, app: null };
const account = (): AccountContextValue => {
  if (!probe.account) throw new Error('The actual AccountProvider has not published a value yet.');
  return probe.account;
};
const appReady = () => probe.app?.ready ?? false;
let view: Awaited<ReturnType<typeof render>> | null = null;
let savedGlobals: (readonly [string, PropertyDescriptor | undefined])[] = [];
let device = memoryKv();

async function openGuest() {
  const guest = new KvStore(device);
  await guest.init();
  return guest;
}
const openAccountDataset = (namespace: Namespace) => openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });

function HookProbe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => { probe.account = accountValue; probe.app = appValue; }, [accountValue, appValue]);
  return null;
}
function PanelHost() {
  const { panel } = useAccount();
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
    <AccountPanel {...panel} />
  </SafeAreaProvider>;
}

beforeEach(() => {
  device = memoryKv(); probe.account = null; probe.app = null; view = null;
  for (const key of KEYS) {
    const value = (BUILD as Record<string, string>)[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  savedGlobals = GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of GLOBAL_NAMES) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: GLOBAL_FIXTURES[name] });
  expectActualAiAcceptedRecord();
});
afterEach(async () => {
  try { await view?.unmount(); }
  finally {
    globalThis.fetch = realFetch;
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    for (const [key, value] of BASELINE) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

// googleBrowserOverride, when given, is handed to the provider unchanged instead of the default browser.
async function mount(platforms: { google: Browser['platform']; recovery: Runtime['platform']; googleBrowserOverride?: Browser }) {
  const fake = fakeAccountApi([USER]);
  const net = productionNetwork(fake.fetch as unknown as typeof fetch);
  const urls: string[] = [];
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return net.fetch(input, init);
  }) as typeof fetch;
  const open = jest.fn(async () => ({ type: 'cancelled' as const }));
  const googleBrowser: Browser = platforms.googleBrowserOverride ?? { platform: platforms.google, open, takeLaunchUrl: () => null };
  const recoveryRuntime: Runtime = { platform: platforms.recovery, takeLaunchUrl: () => null, subscribe: () => () => undefined };
  view = await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset} googleBrowser={googleBrowser}
        recoveryRuntime={recoveryRuntime} recoveryStore={memoryRecoveryStore()}>
        <HookProbe /><PanelHost />
      </AccountProvider>
    </AppProvider>,
  );
  await waitFor(() => expect(appReady()).toBe(true), SOON);
  expect(account().enabled).toBe(true);
  return { open, urls };
}
const noteText = (id: string) => [screen.getByTestId(id).props.children].flat(Infinity).join('');

it('keeps ordinary email sign-in working while unavailable Expo Go Google and recovery are explained', async () => {
  const { open, urls } = await mount({
    google: { kind: 'native', unavailable: 'Google Sign-In tidak tersedia di Expo Go; gunakan build pengembangan.' },
    recovery: { kind: 'native', unavailable: 'Pemulihan kata sandi tidak tersedia di Expo Go; gunakan build pengembangan.' },
  });
  expect(noteText(GOOGLE_NOTE)).toContain('Google');
  expect(noteText(GOOGLE_NOTE)).toContain('Expo Go');
  expect(noteText(RECOVERY_NOTE)).toContain('Pemulihan');
  expect(screen.queryByTestId(GOOGLE_CONTROL)).toBeNull();
  expect(screen.queryByTestId(FORGOT_CONTROL)).toBeNull();
  expect(account().panel.registration?.emailPolicy).toBe('confirmed-email');

  await act(async () => { account().panel.onSubmit({ mode: 'signin', email: USER.email, password: USER.password }); });
  await waitFor(() => expect([account().signedIn, account().panel.error ?? null]).toEqual([true, null]), SOON);

  expect(screen.queryByTestId('account-registration-start')).toBeNull();
  expect(open).not.toHaveBeenCalled();
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.filter((url) => MAIL_REQUEST.test(url))).toEqual([]);
});

it('wires available public-web Google and recovery ports into the real panel without activating them', async () => {
  const { open, urls } = await mount({
    google: { kind: 'web', origin: WEB_ORIGIN },
    recovery: { kind: 'web', origin: WEB_ORIGIN },
  });
  expect(typeof account().panel.onGoogle).toBe('function');
  expect(account().panel.recovery?.available).toBe(true);
  expect(screen.getByTestId(GOOGLE_CONTROL)).toBeTruthy();
  expect(screen.getByTestId(FORGOT_CONTROL)).toBeTruthy();
  expect(screen.queryByTestId(GOOGLE_NOTE)).toBeNull();
  expect(screen.queryByTestId(RECOVERY_NOTE)).toBeNull();
  expect(account().panel.registration?.emailPolicy).toBe('confirmed-email');
  // Nothing was pressed: provider activation is not proven here.
  expect(open).not.toHaveBeenCalled();
  expect(urls.filter((url) => MAIL_REQUEST.test(url))).toEqual([]);
});

it('never inspects the optional Google browser when production Google and recovery are both off', async () => {
  process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN = 'off';
  process.env.EXPO_PUBLIC_PASSWORD_RECOVERY = 'off';
  const platformRead = jest.fn((): Browser['platform'] => {
    throw new Error('The Google browser platform was inspected while production Google is off.');
  });
  // The getter is only defined here; nothing in this fixture reads it.
  const googleBrowserOverride: Browser = {
    get platform() { return platformRead(); },
    open: jest.fn(async () => ({ type: 'cancelled' as const })),
    takeLaunchUrl: () => null,
  };
  // `google` is ignored because the override replaces the default browser.
  await mount({ google: { kind: 'web', origin: WEB_ORIGIN }, recovery: { kind: 'native', unavailable: null }, googleBrowserOverride });

  expect(account().enabled).toBe(true);
  expect(account().panel.registration?.emailPolicy).toBe('confirmed-email');
  expect(screen.queryByTestId(GOOGLE_CONTROL)).toBeNull();
  expect(screen.queryByTestId(FORGOT_CONTROL)).toBeNull();
  expect(screen.queryByTestId(GOOGLE_NOTE)).toBeNull();
  expect(screen.queryByTestId(RECOVERY_NOTE)).toBeNull();
  expect(platformRead).not.toHaveBeenCalled();
});
