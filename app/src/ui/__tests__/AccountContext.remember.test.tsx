// Remembering a password sign-in on this device, in the account layer (D1 in app/docs/plans/2026-10-20-session-recovery.md),
// written before the change. Only with EXPO_PUBLIC_REMEMBER_DEVICE=on and a secure session vault (the provider's
// sessionVault; there is none on the web) does the panel offer an unchecked choice to remember the email sign-in; without
// both nothing changes. Ticked, the session is saved only after the account API verified the account; leaving the app
// then lets go of it without a logout, and the next run restores it with one refresh grant, verifies the same account
// again and continues exactly as after a password sign-in: the guest copy, the adult profile and its consent still wait
// for the learner's explicit choices. A record whose account the API does not confirm is forgotten and revoked; signing
// out forgets and revokes; a vault that cannot save says so and the session is not remembered. The real AppProvider,
// AccountProvider, AccountPanel, SDK, adapter, API client, journal and KvStore datasets run; the network is the frozen
// fake account API and fake GoTrue of test/fakeAccountApi.ts, and the vault an in-memory fake of the secure store.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeAccountApi, type FakeUser, type WireRecord } from '../../../test/fakeAccountApi';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-remember-1', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };
const BUDI: FakeUser = { email: 'budi@ayailmu.test', password: 'pw-budi-remember-2', uid: 'uid-budi', token: 'legacy-id-token-budi', accountId: '7c2e2a5f-3d4b-4e6f-9a71-82b3c4d5e6f7' };
const INSTALLATION = 'install-7f3a9c2e5b1d';
const GUEST_KEY = GUEST_NAMESPACE.kvKey;

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_REMEMBER_DEVICE',
] as const;
type Build = Partial<Record<(typeof BUILD_KEYS)[number], string>>;
const LOCAL_SUPABASE_BUILD: Build = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: FAKE_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: FAKE_GOTRUE };
const REMEMBERING_BUILD: Build = { ...LOCAL_SUPABASE_BUILD, EXPO_PUBLIC_REMEMBER_DEVICE: 'on' };
/** The process's own values, put back after every test. */
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);

function build(values: Build) {
  for (const key of BUILD_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const GUEST_LEARNER: Learner = {
  learner_id: 'lrn-guest-remember',
  created_at: '2026-10-19T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-19T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: ['DEMO-S1'],
};
const GUEST_ANSWER: AnswerRecord = {
  answer_id: 'ans-guest-remember-1',
  learner_id: GUEST_LEARNER.learner_id,
  item_id: 'A3-M01',
  content_version: 'demo-synthetic-0.3',
  rules_version: 'pilot-0.3-local',
  app_version: '0.2.0',
  timestamp: '2026-10-19T02:01:00.000Z',
  local_date: '2026-10-19',
  session_id: 'ses-guest-remember',
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
const GUEST_BLOB = JSON.stringify({ schema: 2, meta: {}, learner: GUEST_LEARNER, answers: [GUEST_ANSWER], snapshot: null, reports: [] });

/** The secure vault port a remembering build gives the provider (sessionVault). */
interface SessionVaultPort {
  installation(): string;
  read(): string | null;
  write(text: string): void;
  clear(): void;
}

/** An in-memory secure vault that counts every use; `onWrite` runs before each accepted write. */
function memoryVault(onWrite: () => void = () => undefined) {
  const state = { text: null as string | null, reads: 0, writes: 0, clears: 0, failWrite: false };
  const port: SessionVaultPort = {
    installation: () => INSTALLATION,
    read: () => {
      state.reads += 1;
      return state.text;
    },
    write: (text: string) => {
      state.writes += 1;
      if (state.failWrite) throw new Error('The secure store refused the write.');
      onWrite();
      state.text = text;
    },
    clear: () => {
      state.clears += 1;
      state.text = null;
    },
  };
  return { port, state };
}

/** The real AccountProvider, given a session vault the way a remembering build provides one (the sessionVault prop it adds). */
const RememberingProvider = AccountProvider as unknown as (
  props: Parameters<typeof AccountProvider>[0] & { sessionVault?: SessionVaultPort | null }
) => ReturnType<typeof AccountProvider>;

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

let device: KvBackend = memoryKv();
/** Every entry written to the device storage: no password or token may ever be among them. */
let written: string[] = [];
let fake: FakeAccountApi = fakeAccountApi([ANI, BUDI]);
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
const realFetch = globalThis.fetch;

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
  const store = new KvStore(device);
  await store.init();
  return store;
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
  return accountValue.enabled ? <AccountPanel {...accountValue.panel} /> : null;
}

/** A fresh app run over this test's device storage, with `vault` as the provider's session vault. */
async function mount(vault: SessionVaultPort | null) {
  account = null;
  app = null;
  const view = await render(
    <AppProvider storeFactory={openGuest}>
      <RememberingProvider openDataset={openAccountDataset} sessionVault={vault}>
        <Probe />
      </RememberingProvider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  return view;
}

/** A password sign-in through the panel, ticking «remember» when asked to. */
async function passwordSignIn(user: FakeUser, { remember = false }: { remember?: boolean } = {}) {
  await fireEvent.changeText(screen.getByTestId('account-email'), user.email);
  await fireEvent.changeText(screen.getByTestId('account-password'), user.password);
  if (remember) await fireEvent.press(screen.getByTestId('account-remember'));
  await fireEvent.press(screen.getByTestId('account-submit'));
  await waitFor(
    () => {
      expect(account?.signedIn).toBe(true);
      expect(account?.panel.busy ?? null).toBeNull();
    },
    { timeout: 5000 }
  );
}

/** A session the fake GoTrue issues for `user`, as an earlier run of the app got it: its refresh token. */
async function mintRefreshToken(user: FakeUser): Promise<string> {
  const reply = await fake.fetch(`${FAKE_GOTRUE}/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const body = (await reply.json()) as { refresh_token?: unknown };
  if (typeof body.refresh_token !== 'string') throw new Error('the fake GoTrue issued no refresh token');
  return body.refresh_token;
}

/** A record as a remembering build would have saved it for `user`, with `overrides`. */
function recordFor(user: FakeUser, refreshToken: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    kind: 'password',
    installation: INSTALLATION,
    auth: FAKE_GOTRUE,
    api: FAKE_API,
    profile: 'local',
    uid: providerUserId(user),
    email: user.email,
    accountId: user.accountId,
    refreshToken,
    savedAt: new Date(Date.now()).toISOString(),
    ...overrides,
  });
}

const storedASecret = () => {
  const secrets = [ANI.password, BUDI.password, ...fake.auth.issued()];
  return written.some((entry) => secrets.some((secret) => entry.includes(secret)));
};
const mark = () => fake.wire.length;
const since = (from: number) => fake.wire.slice(from);
const toAuth = (path: string, query: string) => (r: WireRecord) => r.server === 'auth' && r.path === path && r.query === query;
const passwordGrant = toAuth('/token', 'grant_type=password');
const refreshGrant = toAuth('/token', 'grant_type=refresh_token');
const localLogout = toAuth('/logout', 'scope=local');
const toMe = (r: WireRecord) => r.server === 'api' && r.path === '/v1/me';

beforeEach(() => {
  build({});
  written = [];
  device = recordingDevice();
  fake = fakeAccountApi([ANI, BUDI]);
  globalThis.fetch = fake.fetch;
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

describe('remembering an email sign-in on this device (account layer)', () => {
  it('control: without the flag a given vault is never touched, no remember choice is offered, and leaving the app signs out as before', async () => {
    build(LOCAL_SUPABASE_BUILD);
    const vault = memoryVault();
    const first = await mount(vault.port);
    expect(screen.queryByTestId('account-remember')).toBeNull();
    await passwordSignIn(ANI);
    const from = mark();
    await first.unmount();
    await waitFor(() => expect(since(from).filter(localLogout)).toHaveLength(1), { timeout: 5000 });
    expect(vault.state).toMatchObject({ text: null, reads: 0, writes: 0, clears: 0 });
  });

  it('with the flag and a secure vault: an unchecked choice to remember the email sign-in only; unticked, nothing is stored and leaving signs out', async () => {
    build(REMEMBERING_BUILD);
    const vault = memoryVault();
    const first = await mount(vault.port);
    const choice = screen.getByTestId('account-remember');
    expect(choice).not.toBeChecked();
    expect(choice).toHaveTextContent(/email/i);
    expect(choice).not.toHaveTextContent(/google/i);

    await passwordSignIn(ANI);
    expect(vault.state.text).toBeNull();
    const from = mark();
    await first.unmount();
    await waitFor(() => expect(since(from).filter(localLogout)).toHaveLength(1), { timeout: 5000 });
    expect(vault.state.text).toBeNull();
  });

  it('remembered: saved only after the API verified the account; leaving keeps it without a logout; the next run restores it with one refresh and no password, and every learner choice stays explicit', async () => {
    device.setItem(GUEST_KEY, GUEST_BLOB);
    const guestBytes = device.getItem(GUEST_KEY);
    build(REMEMBERING_BUILD);
    let wireAtSave = -1;
    const vault = memoryVault(() => {
      if (wireAtSave < 0) wireAtSave = fake.wire.length;
    });
    const first = await mount(vault.port);

    await passwordSignIn(ANI, { remember: true });
    await waitFor(() => expect(vault.state.text).not.toBeNull(), { timeout: 5000 });
    // Bound to the account the API verified, after it did; no password or access token is kept in it.
    expect(fake.wire.slice(0, wireAtSave).some(toMe)).toBe(true);
    expect(JSON.parse(vault.state.text ?? 'null')).toMatchObject({
      v: 1,
      kind: 'password',
      installation: INSTALLATION,
      auth: FAKE_GOTRUE,
      api: FAKE_API,
      profile: 'local',
      uid: providerUserId(ANI),
      email: ANI.email,
      accountId: ANI.accountId,
    });
    expect(vault.state.text).not.toContain(ANI.password);
    expect(storedASecret()).toBe(false);
    // Nothing was chosen for the learner.
    expect(app!.dataset).toBe('guest');
    expect(fake.profiles).toHaveLength(0);

    // Leaving keeps the remembered session: no logout, and the record stays.
    const leaving = mark();
    await first.unmount();
    await pause();
    expect(since(leaving).filter(localLogout)).toEqual([]);
    expect(vault.state.text).not.toBeNull();

    // The next run restores it: one refresh grant, no password grant, and the account verified again before anything.
    const nextRun = mark();
    await mount(vault.port);
    await waitFor(
      () => {
        expect(account?.signedIn).toBe(true);
        expect(account?.panel.busy ?? null).toBeNull();
      },
      { timeout: 5000 }
    );
    const run = since(nextRun);
    expect(run.filter(passwordGrant)).toEqual([]);
    expect(run.filter(refreshGrant)).toHaveLength(1);
    expect(run.findIndex(toMe)).toBeGreaterThan(run.findIndex(refreshGrant));
    expect(account!.panel.account?.label).toBe(ANI.email);
    // Still nothing chosen for the learner: the guest copy and the adult profile wait for explicit choices.
    expect(app!.dataset).toBe('guest');
    expect(account!.connected).toBe(false);
    expect(account!.panel.guestCopy?.answers).toBe(1);
    expect(fake.profiles).toHaveLength(0);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(storedASecret()).toBe(false);
  });

  it('a remembered session whose account the API does not confirm is forgotten and revoked: back to the guest with a fixed message, nothing opened', async () => {
    build(REMEMBERING_BUILD);
    const vault = memoryVault();
    // An earlier run remembered ANI's session, but the record names another account.
    vault.state.text = recordFor(ANI, await mintRefreshToken(ANI), { accountId: BUDI.accountId });

    await mount(vault.port);
    await waitFor(
      () => {
        expect(account?.panel.error ?? '').toMatch(/tidak cocok/i);
        expect(account?.panel.busy ?? null).toBeNull();
      },
      { timeout: 5000 }
    );
    expect(account!.signedIn).toBe(false);
    expect(app!.dataset).toBe('guest');
    expect(vault.state.text).toBeNull();
    await waitFor(() => expect(fake.auth.liveSessions(ANI.email)).toBe(0), { timeout: 5000 });
    expect(device.getItem(accountNamespace(ANI.accountId).kvKey)).toBeNull();
    expect(device.getItem(accountNamespace(BUDI.accountId).kvKey)).toBeNull();
  });

  it('signing out of a remembered session forgets it and revokes it; the next run restores nothing', async () => {
    build(REMEMBERING_BUILD);
    const vault = memoryVault();
    vault.state.text = recordFor(ANI, await mintRefreshToken(ANI));
    const first = await mount(vault.port);
    await waitFor(() => expect(account?.signedIn).toBe(true), { timeout: 5000 });

    const from = mark();
    await act(async () => {
      account!.panel.onSignOut();
    });
    await waitFor(
      () => {
        expect(account?.signedIn).toBe(false);
        expect(since(from).filter(localLogout)).toHaveLength(1);
      },
      { timeout: 5000 }
    );
    expect(vault.state.text).toBeNull();

    await first.unmount();
    const nextRun = mark();
    await mount(vault.port);
    await pause();
    await pause();
    expect(since(nextRun).filter((r) => r.server === 'auth')).toEqual([]);
    expect(account!.signedIn).toBe(false);
  });

  it('no secure vault offers no choice; a vault that cannot save says so, keeps the sign-in unremembered, and leaving still signs out', async () => {
    build(REMEMBERING_BUILD);
    const unavailable = await mount(null);
    expect(screen.queryByTestId('account-remember')).toBeNull();
    await unavailable.unmount();

    const vault = memoryVault();
    vault.state.failWrite = true;
    const first = await mount(vault.port);
    await passwordSignIn(ANI, { remember: true });
    await waitFor(() => expect(account?.panel.error ?? '').toMatch(/tidak bisa diingat/i), { timeout: 5000 });
    expect(account!.signedIn).toBe(true);
    expect(vault.state.text).toBeNull();

    const from = mark();
    await first.unmount();
    await waitFor(() => expect(since(from).filter(localLogout)).toHaveLength(1), { timeout: 5000 });
  });
});
