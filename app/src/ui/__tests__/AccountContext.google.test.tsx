// Continue with Google in the app's account layer, written before that wiring (phase 10). The real AppProvider,
// AccountProvider, AccountPanel, SDK (authorization code + PKCE), adapter, API client, sync journal and KvStore datasets
// run here. The doubles are the OS/browser boundary (a scripted Google browser: the system auth session on native, the
// full-page redirect on the web), the tab's short-lived attempt store, the network (the fake account API and fake local
// GoTrue of test/fakeAccountApi.ts, behind the fake Google trip and PKCE exchange of test/fakeGoogleAuth.ts), the
// device storage, the lock manager and the clock. A Google sign-in is verified by the account API and opens only that
// account's own dataset; Google's identity is never consent: the adult profile, its consent and any guest copy still
// wait for the learner's explicit choices. Late, replayed or cancelled results change nothing. Local mocked protocol
// evidence only: never a real Google sign-in.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import type { EnabledGoogleConfig, GooglePlatform } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { GoogleAttemptRecord, GoogleSignIn } from '@/auth/google';
import type { GoogleBrowser, GoogleBrowserResult } from '@/auth/googleBrowser';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, LOCAL_ACCOUNT_CONSENT_VERSION, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';
import { fakeGoogleGoTrue, s256, type FakeGoogleGoTrue, type GoogleAccount } from '../../../test/fakeGoogleAuth';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-gotrue-1', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };
const G_ANI: GoogleAccount = {
  email: 'ani.learner@example.com',
  password: 'mint-only-google-ani-4',
  uid: 'uid-google-ani',
  token: 'unused-legacy-token-google-ani',
  accountId: '8d3f3b60-4e5c-4f70-8b82-93c4d5e6f708',
  googleSub: '109876543210987654321',
  name: 'Ani Pelajar',
};
const G_BUDI: GoogleAccount = {
  email: 'budi.learner@example.com',
  password: 'mint-only-google-budi-5',
  uid: 'uid-google-budi',
  token: 'unused-legacy-token-google-budi',
  accountId: '9e404c71-5f6d-4081-9c93-a4d5e6f70819',
  googleSub: '108765432109876543210',
  name: 'Budi Pelajar',
};
/** A Google account the local GoTrue does not know: sign-up is off there, so it is refused. */
const G_NEW: GoogleAccount = {
  email: 'citra.new@example.com',
  password: 'never-prepared-6',
  uid: 'uid-google-citra',
  token: 'unused-legacy-token-google-citra',
  accountId: 'a0515d82-6a7e-4192-8da4-b5e6f7081920',
  googleSub: '107654321098765432109',
  name: 'Citra Baru',
};

const NATIVE_CALLBACK = 'arabictrial://account';
const WEB_CALLBACK = 'http://localhost:8081/account';
const PKCE_EXCHANGE = 'POST /token?grant_type=pkce';
const REFRESH_GRANT = 'POST /token?grant_type=refresh_token';
const LOCAL_LOGOUT = 'POST /logout?scope=local';
const DEVICE: GooglePlatform = { kind: 'native', unavailable: null };
const PAGE: GooglePlatform = { kind: 'web', origin: 'http://localhost:8081' };

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL',
  'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL',
] as const;
type Build = Partial<Record<(typeof BUILD_KEYS)[number], string>>;
const LOCAL_SUPABASE_BUILD: Build = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: FAKE_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: FAKE_GOTRUE };
const GOOGLE_NATIVE_BUILD: Build = { ...LOCAL_SUPABASE_BUILD, EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: NATIVE_CALLBACK };
const GOOGLE_WEB_BUILD: Build = { ...LOCAL_SUPABASE_BUILD, EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: WEB_CALLBACK };
/** The process's own values, put back after every test. */
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);

function build(values: Build) {
  for (const key of BUILD_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const realNow = Date.now;
let skew = 0;
/** Moves on the clock that the SDK, the adapter and the fake servers all read (Date.now). */
const later = (ms: number) => {
  skew += ms;
};
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };

const GUEST_LEARNER: Learner = {
  learner_id: 'lrn-guest-google',
  created_at: '2026-10-15T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-15T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: ['DEMO-S1'],
};
function guestAnswer(n: number): AnswerRecord {
  return {
    answer_id: `ans-guest-${n}`,
    learner_id: GUEST_LEARNER.learner_id,
    item_id: 'A3-M01',
    content_version: 'demo-synthetic-0.3',
    rules_version: 'pilot-0.3-local',
    app_version: '0.2.0',
    timestamp: `2026-10-15T02:0${n}:00.000Z`,
    local_date: '2026-10-15',
    session_id: 'ses-guest',
    pool: 'PRACT',
    unit: 'A',
    skills: ['LEX-A:W-A3'],
    raw_response: '{"kind":"choice","option_id":"k"}',
    auto_score: { answer: 'correct' },
    outcome: 'correct',
    error_tags: [],
    serious_tag: null,
    hint_used: false,
    help_lines_shown: [],
    first_attempt: true,
    fresh_evidence: true,
    time_on_item_ms: 1000,
    audio_status: null,
    report_flag: false,
    review_status: 'draft',
    synthetic: true,
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    lineage: 'A:word-form:صَادِقٌ',
    role: 'practice',
  };
}
const blob = (learner: Learner, answers: AnswerRecord[]) => JSON.stringify({ schema: 2, meta: {}, learner, answers, snapshot: null, reports: [] });
const GUEST_KEY = GUEST_NAMESPACE.kvKey;
const datasetKey = (user: FakeUser) => accountNamespace(user.accountId).kvKey;

let device: KvBackend = memoryKv();
/** Every entry written to the device storage in this test: no password, token, code or verifier may be among them. */
let written: string[] = [];
let fake: FakeAccountApi = fakeAccountApi([]);
let gotrue: FakeGoogleGoTrue = fakeGoogleGoTrue(fake, { redirects: [], known: [] });
let store = attemptStore();
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let clock: jest.SpyInstance<number, []> | null = null;
const realFetch = globalThis.fetch;

/** The tab's short-lived attempt store, with what it holds visible to the test. */
function attemptStore() {
  let held: GoogleAttemptRecord | null = null;
  return {
    save(record: GoogleAttemptRecord) {
      held = { ...record };
    },
    take() {
      const record = held;
      held = null;
      return record;
    },
    clear() {
      held = null;
    },
    peek: (): GoogleAttemptRecord | null => held,
  };
}

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

interface Opened {
  url: string;
  callbackUrl: string;
  /** What the attempt store held when the browser was opened. */
  recordAtOpen: GoogleAttemptRecord | null;
  finish: (result: GoogleBrowserResult) => void;
}

/** The platform's Google browser, scripted: each open waits for the test; a page may be loaded at a launch URL. */
function scriptedBrowser(platform: GooglePlatform, launchUrl: string | null = null) {
  const opened: Opened[] = [];
  const taken: string[] = [];
  let launch = launchUrl;
  const browser: GoogleBrowser = {
    platform,
    open: (url, callbackUrl) =>
      new Promise<GoogleBrowserResult>((finish) => {
        opened.push({ url, callbackUrl, recordAtOpen: store.peek(), finish });
      }),
    takeLaunchUrl: (callbackUrl) => {
      taken.push(callbackUrl);
      const url = launch;
      launch = null;
      return url;
    },
  };
  return { browser, opened, taken };
}
type Scripted = ReturnType<typeof scriptedBrowser>;

function Probe({ withPanel }: { withPanel: boolean }) {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue;
  }, [accountValue, appValue]);
  return withPanel ? <AccountPanel {...accountValue.panel} /> : null;
}

/** A fresh app run over this test's device storage and attempt store: nothing in memory is kept from an earlier run. */
async function mount(scripted: Scripted, { withPanel = true }: { withPanel?: boolean } = {}) {
  account = null;
  app = null;
  const view = await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset} googleBrowser={scripted.browser} googleStore={store}>
        <Probe withPanel={withPanel} />
      </AccountProvider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  return view;
}

/** Presses «Continue with Google» and waits for the browser it opens. */
async function pressGoogle(scripted: Scripted): Promise<Opened> {
  const before = scripted.opened.length;
  await fireEvent.press(screen.getByTestId('account-google'));
  await waitFor(() => expect(scripted.opened.length).toBe(before + 1), { timeout: 5000 });
  return scripted.opened[before];
}

async function finish(opened: Opened, result: GoogleBrowserResult) {
  await act(async () => {
    opened.finish(result);
  });
}

async function settledSignedIn() {
  await waitFor(
    () => {
      expect(account?.panel.error ?? null).toBeNull();
      expect(account?.signedIn).toBe(true);
      expect(account?.panel.busy ?? null).toBeNull();
    },
    { timeout: 5000 }
  );
}

async function settledWithError(previous: string | null = null) {
  await waitFor(
    () => {
      expect(account?.panel.busy ?? null).toBeNull();
      expect(account?.panel.error ?? null).not.toBeNull();
      expect(account?.panel.error).not.toBe(previous);
    },
    { timeout: 5000 }
  );
  return account!.panel.error ?? '';
}

/** A Google sign-in through the native auth session, consenting at Google as `who`. */
async function googleSignIn(scripted: Scripted, who: GoogleAccount) {
  const opened = await pressGoogle(scripted);
  await finish(opened, { type: 'callback', url: gotrue.consent(opened.url, who) });
  await settledSignedIn();
}

async function passwordSignIn(user: FakeUser) {
  await act(async () => {
    account!.panel.onSubmit({ mode: 'signin', email: user.email, password: user.password });
  });
  await settledSignedIn();
}

async function signOut() {
  await act(async () => {
    account!.panel.onSignOut();
  });
  await waitFor(
    () => {
      expect(account?.signedIn).toBe(false);
      expect(account?.panel.busy ?? null).toBeNull();
    },
    { timeout: 5000 }
  );
}

/** «Buat profil dewasa» after both ticks (the panel hands the two ticks over), then the sync it starts. */
async function createAdultProfile() {
  await act(async () => {
    account!.panel.onCreateProfile({ adult: true, agreed: true });
  });
  await waitFor(
    () => {
      expect(account?.panel.busy ?? null).toBeNull();
      expect(account?.panel.connected?.syncStatus ?? '').toMatch(/tersambung|terkirim/i);
    },
    { timeout: 5000 }
  );
}

/** The Google sign-in of an adapter given a Google configuration. */
function googleOf(auth: SupabaseAuth): GoogleSignIn {
  expect(auth.google).toBeDefined();
  if (!auth.google) throw new Error('no Google sign-in was built');
  return auth.google;
}

const storedAt = (key: string) => JSON.parse(device.getItem(key) ?? 'null') as { learner: Learner | null; answers: AnswerRecord[] } | null;
const codeOf = (callback: string) => new URL(callback).searchParams.get('code') ?? '';
const exchangesSent = () => gotrue.requests.filter((r) => r === PKCE_EXCHANGE).length;
/** Whether a password, a token, a code or a verifier ever reached the device storage. */
const storedASecret = () => {
  const secrets = [ANI.password, ...gotrue.secrets];
  return written.some((entry) => secrets.some((secret) => entry.includes(secret)));
};

beforeEach(() => {
  build({});
  skew = 0;
  clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  written = [];
  device = recordingDevice();
  fake = fakeAccountApi([ANI, G_ANI, G_BUDI]);
  gotrue = fakeGoogleGoTrue(fake, { redirects: [NATIVE_CALLBACK, WEB_CALLBACK], known: [G_ANI, G_BUDI] });
  store = attemptStore();
  globalThis.fetch = gotrue.fetch;
  account = null;
  app = null;
});

afterEach(() => {
  clock?.mockRestore();
  globalThis.fetch = realFetch;
  for (const [key, value] of BASELINE) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Continue with Google in the account layer', () => {
  it('is offered only by an explicit Google build on a platform that can run it; by default the password pilot is unchanged, and nothing is contacted', async () => {
    build(LOCAL_SUPABASE_BUILD);
    const byDefault = await mount(scriptedBrowser(DEVICE));
    expect(account!.enabled).toBe(true);
    expect(account!.panel.onGoogle).toBeUndefined();
    expect(screen.queryByTestId('account-google')).toBeNull();
    expect(screen.getByTestId('account-email')).toBeTruthy();
    await byDefault.unmount();

    // Asked for, but the build cannot run the system browser's auth session (Expo Go): not offered.
    build(GOOGLE_NATIVE_BUILD);
    const expoGo = await mount(scriptedBrowser({ kind: 'native', unavailable: 'Expo Go cannot receive the arabictrial callback: use a development build.' }));
    expect(screen.queryByTestId('account-google')).toBeNull();
    await expoGo.unmount();

    // Asked for without the local account service: the account layer stays off altogether.
    build({ EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: NATIVE_CALLBACK });
    const withoutAccounts = await mount(scriptedBrowser(DEVICE), { withPanel: false });
    expect(account!.enabled).toBe(false);
    await withoutAccounts.unmount();

    // The explicit Google build where it can run: offered next to the password form, with nothing contacted or recorded.
    build(GOOGLE_NATIVE_BUILD);
    await mount(scriptedBrowser(DEVICE));
    expect(screen.getByTestId('account-google')).toBeTruthy();
    expect(screen.getByTestId('account-email')).toBeTruthy();
    expect(gotrue.requests).toEqual([]);
    expect(fake.wire).toEqual([]);
    expect(store.peek()).toBeNull();
  });

  it('native: the auth session comes back with the callback; its code is exchanged once and the verified account opens, with nothing consented, created or copied until the learner chooses', async () => {
    device.setItem(GUEST_KEY, blob(GUEST_LEARNER, [guestAnswer(1), guestAnswer(2)]));
    const guestBytes = device.getItem(GUEST_KEY);
    build(GOOGLE_NATIVE_BUILD);
    const scripted = scriptedBrowser(DEVICE);
    await mount(scripted);

    const opened = await pressGoogle(scripted);
    // Leaving for the browser sends nothing: the local GoTrue's authorize URL, for Google, with the exact callback.
    expect(opened.callbackUrl).toBe(NATIVE_CALLBACK);
    const authorize = new URL(opened.url);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${FAKE_GOTRUE}/authorize`);
    expect(authorize.searchParams.get('provider')).toBe('google');
    expect(authorize.searchParams.get('redirect_to')).toBe(NATIVE_CALLBACK);
    expect(s256(opened.recordAtOpen?.verifier ?? '')).toBe(authorize.searchParams.get('code_challenge'));
    expect(gotrue.requests).toEqual([]);
    expect(fake.sent).toEqual([]);
    expect(account!.signedIn).toBe(false);
    expect(account!.panel.busy).toBe('auth');

    await finish(opened, { type: 'callback', url: gotrue.consent(opened.url, G_ANI) });
    await settledSignedIn();

    // One exchange, checked against its S256 challenge, then the account API's verification; no password grant.
    expect(gotrue.requests).toEqual([PKCE_EXCHANGE]);
    expect(gotrue.exchanges).toEqual(['issued']);
    expect(fake.sent.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /v1/me']);
    expect(store.peek()).toBeNull();
    // Signed in as the Google account's address; nothing else of Google's profile is shown.
    expect(screen.getByTestId('account-status')).toHaveTextContent(`Masuk sebagai ${G_ANI.email}`);
    expect(screen.queryAllByText(new RegExp(G_ANI.name))).toHaveLength(0);

    // Google's identity is no consent: learning stays in the guest's dataset; no profile, learner, import or copy yet.
    expect(app!.dataset).toBe('guest');
    expect(account!.connected).toBe(false);
    expect(account!.panel.profiles).toEqual([]);
    expect(account!.panel.guestCopy?.answers).toBe(2);
    for (const tick of ['profile-adult', 'profile-agree', 'guest-copy-consent']) expect(screen.getByTestId(tick)).not.toBeChecked();
    expect(screen.getByTestId('profile-create')).toBeDisabled();
    expect(fake.profiles).toHaveLength(0);
    expect(storedAt(datasetKey(G_ANI))?.learner ?? null).toBeNull();
    expect(storedAt(datasetKey(G_ANI))?.answers ?? []).toEqual([]);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);

    // Only the learner's explicit choice creates the adult profile, under the account consent's own version.
    await createAdultProfile();
    expect(fake.profileOf(G_ANI.accountId)?.consent.version).toBe(LOCAL_ACCOUNT_CONSENT_VERSION);
    expect(app!.dataset).toBe('account');
    expect(storedAt(datasetKey(G_ANI))?.answers ?? []).toEqual([]); // the guest answers were not copied
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(storedASecret()).toBe(false);
  });

  it('web: the attempt is recorded in the tab before the page leaves for the browser, and nothing is sent', async () => {
    build(GOOGLE_WEB_BUILD);
    const scripted = scriptedBrowser(PAGE);
    await mount(scripted);
    // A fresh page looks for its callback once, at the exact callback URL: none here.
    await waitFor(() => expect(scripted.taken).toEqual([WEB_CALLBACK]));

    const opened = await pressGoogle(scripted);
    expect(opened.callbackUrl).toBe(WEB_CALLBACK);
    const authorize = new URL(opened.url);
    expect(authorize.searchParams.get('redirect_to')).toBe(WEB_CALLBACK);
    expect(opened.recordAtOpen).toMatchObject({ v: 1, callbackUrl: WEB_CALLBACK });
    expect(s256(opened.recordAtOpen?.verifier ?? '')).toBe(authorize.searchParams.get('code_challenge'));
    expect(gotrue.requests).toEqual([]);
    expect(fake.sent).toEqual([]);
    expect(account!.signedIn).toBe(false);
    expect(storedASecret()).toBe(false);
  });

  it('web: the next page load resumes the recorded attempt from its URL, once; reloading that URL later is refused without a request', async () => {
    build(GOOGLE_WEB_BUILD);
    const supabase: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: FAKE_API, authUrl: FAKE_GOTRUE };
    const google: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'web', callbackUrl: WEB_CALLBACK };
    // The page before the redirect recorded its attempt in this tab; then the browser left for Google, and its memory was gone.
    const before = createSupabaseAuth({ config: supabase, fetch: gotrue.fetch, google: { config: google, store } });
    const attempt = await googleOf(before).start();
    const callback = gotrue.consent(attempt.url, G_ANI);
    later(2 * MINUTE);

    const loaded = scriptedBrowser(PAGE, callback);
    const first = await mount(loaded);
    await settledSignedIn();
    expect(loaded.taken).toEqual([WEB_CALLBACK]);
    expect(gotrue.requests).toEqual([PKCE_EXCHANGE]);
    expect(store.peek()).toBeNull();
    expect(screen.getByTestId('account-status')).toHaveTextContent(`Masuk sebagai ${G_ANI.email}`);
    expect(screen.getByTestId('profile-choice')).toBeTruthy();
    expect(app!.dataset).toBe('guest');

    // Reloading the same address later (history, a bookmark): nothing is recorded to resume, so it is refused.
    await first.unmount();
    await act(pause);
    const reloaded = scriptedBrowser(PAGE, callback);
    await mount(reloaded);
    const refused = await settledWithError();
    expect(account!.signedIn).toBe(false);
    expect(exchangesSent()).toBe(1);
    expect(refused).not.toContain(codeOf(callback));
    expect(storedASecret()).toBe(false);
  });

  it('a cancelled browser, a Google account the local GoTrue does not know, or an unreachable exchange leave the learner signed out with a fixed message; the password form still works', async () => {
    build(GOOGLE_NATIVE_BUILD);
    const scripted = scriptedBrowser(DEVICE);
    await mount(scripted);

    // Closed without a callback.
    const closed = await pressGoogle(scripted);
    await finish(closed, { type: 'cancelled' });
    const cancelled = await settledWithError();
    expect(account!.signedIn).toBe(false);
    expect(store.peek()).toBeNull();

    // The learner declined at Google.
    const declined = await pressGoogle(scripted);
    await finish(declined, { type: 'callback', url: gotrue.deny(declined.url) });
    await settledWithError();
    expect(account!.signedIn).toBe(false);

    // A Google account the local GoTrue does not know: sign-up is off there, so GoTrue refused it.
    const unknown = await pressGoogle(scripted);
    await finish(unknown, { type: 'callback', url: gotrue.consent(unknown.url, G_NEW) });
    const notRegistered = await settledWithError();
    expect(notRegistered).not.toBe(cancelled);
    expect(notRegistered).not.toMatch(/Signups not allowed/);
    expect(account!.signedIn).toBe(false);
    // None of these callbacks carried a code: nothing was exchanged or sent.
    expect(gotrue.requests).toEqual([]);
    expect(fake.sent).toEqual([]);

    // The exchange cannot reach the local GoTrue: a connection message, and nothing adopted.
    const offline = await pressGoogle(scripted);
    gotrue.offlineNextExchange();
    await finish(offline, { type: 'callback', url: gotrue.consent(offline.url, G_ANI) });
    const unreachable = await settledWithError(notRegistered);
    expect(unreachable).not.toBe(cancelled);
    expect(gotrue.requests).toEqual([PKCE_EXCHANGE]);
    expect(account!.signedIn).toBe(false);
    expect(store.peek()).toBeNull();

    // The password form is still there and still works.
    expect(screen.getByTestId('account-email')).toBeTruthy();
    await passwordSignIn(ANI);
    expect(account!.panel.account?.label).toBe(ANI.email);
    expect(storedASecret()).toBe(false);
  });

  it("a Google result arriving after another sign-in or a sign-out changes nothing: a superseded callback is never exchanged, and a late exchange's session is revoked", async () => {
    build(GOOGLE_NATIVE_BUILD);
    const scripted = scriptedBrowser(DEVICE);
    await mount(scripted);

    // A password sign-in while the browser is still open: its late callback is never exchanged.
    const superseded = await pressGoogle(scripted);
    await passwordSignIn(ANI);
    await finish(superseded, { type: 'callback', url: gotrue.consent(superseded.url, G_ANI) });
    await act(pause);
    expect(exchangesSent()).toBe(0);
    expect(account!.panel.account?.label).toBe(ANI.email);
    expect(account!.panel.error ?? null).toBeNull();
    await signOut();

    // Signed out while the exchange is on its way: the session GoTrue made is never shown or used, and is revoked.
    const leaving = await pressGoogle(scripted);
    const held = gotrue.holdNextExchange();
    await finish(leaving, { type: 'callback', url: gotrue.consent(leaving.url, G_ANI) });
    await held.arrived;
    await act(async () => {
      account!.panel.onSignOut();
    });
    held.release();
    await act(pause);
    await waitFor(() => expect(fake.auth.liveSessions(G_ANI.email)).toBe(0), { timeout: 5000 });
    expect(account!.signedIn).toBe(false);
    expect(account!.panel.account ?? null).toBeNull();
    expect(account!.panel.error ?? null).toBeNull();
    expect(app!.dataset).toBe('guest');
    expect(fake.sent.filter((r) => r.path === '/v1/me')).toHaveLength(1); // only the password sign-in's verification
    expect(store.peek()).toBeNull();
  });

  it('a Google session is refreshed before verification and sync once it expires, signs out through the local logout, leaves nothing after a restart, and a new Google sign-in finds the same account', async () => {
    build(GOOGLE_NATIVE_BUILD);
    const scripted = scriptedBrowser(DEVICE);
    const first = await mount(scripted);
    await googleSignIn(scripted, G_ANI);

    // The access token expires before the first account operation: refreshed first, then verified and synced.
    later(HOUR + MINUTE);
    let from = fake.wire.length;
    let fromAuth = gotrue.requests.length;
    await createAdultProfile();
    const afterExpiry = fake.wire.slice(from);
    const refreshed = afterExpiry.findIndex((r) => r.server === 'auth' && r.path === '/token' && r.query === 'grant_type=refresh_token');
    expect(refreshed).toBeGreaterThanOrEqual(0);
    expect(afterExpiry.findIndex((r) => r.server === 'api')).toBeGreaterThan(refreshed);
    expect(gotrue.requests.slice(fromAuth)).toEqual([REFRESH_GRANT]);
    expect(account!.connected).toBe(true);
    const learner = storedAt(datasetKey(G_ANI))?.learner ?? null;
    expect(learner).not.toBeNull();

    // Signing out: the local logout of this device only, and back to the guest.
    fromAuth = gotrue.requests.length;
    await signOut();
    expect(gotrue.requests.slice(fromAuth)).toEqual([LOCAL_LOGOUT]);
    expect(app!.dataset).toBe('guest');
    await waitFor(() => expect(fake.auth.liveSessions(G_ANI.email)).toBe(0), { timeout: 5000 });

    // A restart keeps nothing of the sign-in, in memory, in the device storage or in the attempt store.
    await first.unmount();
    const again = scriptedBrowser(DEVICE);
    await mount(again);
    expect(account!.signedIn).toBe(false);
    expect(store.peek()).toBeNull();
    expect(storedASecret()).toBe(false);

    // A new Google sign-in finds the same verified account's own dataset and profile: no new profile, no guest copy.
    from = fake.wire.length;
    await googleSignIn(again, G_ANI);
    await waitFor(() => expect(account?.connected).toBe(true), { timeout: 5000 });
    expect(app!.dataset).toBe('account');
    expect(fake.profiles).toHaveLength(1);
    expect(storedAt(datasetKey(G_ANI))?.learner?.learner_id).toBe(learner?.learner_id);
    expect(fake.wire.slice(from).filter((r) => r.server === 'api' && r.path === '/v1/imports')).toEqual([]);
    expect(storedASecret()).toBe(false);
  });

  it('each Google account opens only its own verified dataset, and a password account stays apart from them', async () => {
    build(GOOGLE_NATIVE_BUILD);
    const scripted = scriptedBrowser(DEVICE);
    await mount(scripted);

    await googleSignIn(scripted, G_ANI);
    await createAdultProfile();
    await signOut();
    const aniDataset = device.getItem(datasetKey(G_ANI));
    expect(storedAt(datasetKey(G_ANI))?.learner ?? null).not.toBeNull();

    // Another Google account: none of the first one's profiles, its own dataset, and its own explicit profile.
    await googleSignIn(scripted, G_BUDI);
    expect(screen.getByTestId('account-status')).toHaveTextContent(`Masuk sebagai ${G_BUDI.email}`);
    expect(account!.panel.profiles).toEqual([]);
    expect(account!.connected).toBe(false);
    expect(app!.dataset).toBe('guest');
    expect(fake.profileOf(G_BUDI.accountId)).toBeNull();
    await createAdultProfile();
    expect(storedAt(datasetKey(G_BUDI))?.learner?.learner_id).not.toBe(storedAt(datasetKey(G_ANI))?.learner?.learner_id);
    expect(device.getItem(datasetKey(G_ANI))).toBe(aniDataset);
    await signOut();

    // A password account: its own account and dataset, apart from both Google accounts.
    await passwordSignIn(ANI);
    expect(account!.panel.profiles).toEqual([]);
    expect(account!.connected).toBe(false);
    expect(fake.profileOf(ANI.accountId)).toBeNull();
    expect(device.getItem(datasetKey(G_ANI))).toBe(aniDataset);
    expect(fake.profiles.map((p) => p.accountId).sort()).toEqual([G_ANI.accountId, G_BUDI.accountId].sort());
    expect(storedASecret()).toBe(false);
  });
});
