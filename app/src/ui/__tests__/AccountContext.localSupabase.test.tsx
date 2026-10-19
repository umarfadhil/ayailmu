// The app's default account wiring under the explicit local-supabase build, written before that wiring. The real
// AccountProvider signs in through the maintained @supabase/auth-js SDK to the local GoTrue only, verifies the account
// with the account API, refreshes an expired session explicitly before it verifies or syncs, and on sign-out returns to
// the guest at once, then says truthfully whether the provider confirmed the revocation. The real AppProvider,
// AccountProvider, AccountPanel, SDK, adapter, API client, sync journal and KvStore datasets run here. The only doubles
// are the network (the in-process fake account API and fake local GoTrue of test/fakeAccountApi.ts, which know two
// prepared synthetic users: sign-up is off), the device storage, the lock manager and the clock (Date.now, moved on to
// expire a session). Races and credential quarantine inside the adapter are its own suite's.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_EMULATOR, FAKE_GOTRUE, fakeAccountApi, type FakeAccountApi, type FakeUser, type WireRecord } from '../../../test/fakeAccountApi';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

const ANI: FakeUser = {
  email: 'ani@ayailmu.test',
  password: 'pw-ani-gotrue-1',
  uid: 'uid-ani',
  token: 'legacy-id-token-ani',
  accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6',
};
const BUDI: FakeUser = {
  email: 'budi@ayailmu.test',
  password: 'pw-budi-gotrue-2',
  uid: 'uid-budi',
  token: 'legacy-id-token-budi',
  accountId: '7c2e2a5f-3d4b-4e6f-9a71-82b3c4d5e6f7',
};
const ACCOUNT_KEY = accountNamespace(ANI.accountId).kvKey;

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
] as const;
type Build = Partial<Record<(typeof BUILD_KEYS)[number], string>>;
/** The explicit local-supabase build: the provider named, the account API, and the root of the local GoTrue. */
const LOCAL_SUPABASE_BUILD: Build = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase', EXPO_PUBLIC_API_BASE_URL: FAKE_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: FAKE_GOTRUE };
/** The legacy Firebase emulator pilot's build variables. */
const LEGACY_BUILD: Build = { EXPO_PUBLIC_API_BASE_URL: FAKE_API, EXPO_PUBLIC_AUTH_EMULATOR_URL: FAKE_EMULATOR, EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-ayailmu' };
/** The process's own values, put back after every test (whatever the fixture or a test set). */
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);

/** This test's build: exactly these variables, the others unset. */
function build(values: Build) {
  for (const key of BUILD_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** More than the SDK's retry window for an unreachable refresh (30 s): how far each attempt of an outage moves the clock. */
const OUTAGE_STEP = 31_000;
const realNow = Date.now;
let skew = 0;
/** Moves on the clock that the SDK, the adapter and the fake servers all read (Date.now). */
const later = (ms: number) => {
  skew += ms;
};
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };

let device: KvBackend = memoryKv();
/** Every entry written to the device storage in this test: no password or token may ever be among them. */
let written: string[] = [];
let fake: FakeAccountApi = fakeAccountApi([ANI, BUDI]);
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let clock: jest.SpyInstance<number, []> | null = null;
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

/** The guest dataset as the web build opens it (the AppProvider's store factory). */
async function openGuest() {
  const store = new KvStore(device);
  await store.init();
  return store;
}

/** The account dataset as the web build opens it: its own key and writer lock in this device's storage. */
function openAccountDataset(namespace: Namespace) {
  return openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });
}

/** Hands both contexts to the test after each render (in an effect); with `withPanel`, also renders the account panel. */
function Probe({ withPanel }: { withPanel: boolean }) {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue;
  }, [accountValue, appValue]);
  return withPanel ? <AccountPanel {...accountValue.panel} /> : null;
}

/** A fresh app run over this test's device storage: nothing in memory is kept from an earlier run. */
async function mount({ withPanel = false }: { withPanel?: boolean } = {}) {
  account = null;
  app = null;
  const view = await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset}>
        <Probe withPanel={withPanel} />
      </AccountProvider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  return view;
}

async function signIn(user: FakeUser) {
  await act(async () => {
    account!.panel.onSubmit({ mode: 'signin', email: user.email, password: user.password });
  });
  await waitFor(
    () => {
      expect(account?.panel.error ?? null).toBeNull();
      expect(account?.panel.account ?? null).not.toBeNull();
      expect(account?.panel.busy ?? null).toBeNull();
    },
    { timeout: 5000 }
  );
}

/** «Buat profil dewasa» after both ticks, then the sync it starts. */
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

const storedLearner = (key: string) => (JSON.parse(device.getItem(key) ?? 'null') as { learner: Learner | null } | null)?.learner ?? null;
/** Whether a password, or any token the GoTrue issued, was ever written to the device storage. */
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
const toApi = (r: WireRecord) => r.server === 'api';

beforeEach(() => {
  build({}); // every test names its own build
  skew = 0;
  clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  written = [];
  device = recordingDevice();
  fake = fakeAccountApi([ANI, BUDI]);
  globalThis.fetch = fake.fetch;
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

describe('the default account wiring: local Supabase Auth through the maintained SDK', () => {
  it('the legacy Firebase emulator variables alone keep account sync off and contact nothing; the explicit local-supabase build turns it on', async () => {
    build(LEGACY_BUILD);
    const legacy = await mount();
    expect(account!.enabled).toBe(false);
    await act(async () => {
      account!.panel.onSubmit({ mode: 'signin', email: ANI.email, password: ANI.password });
    });
    expect(account!.signedIn).toBe(false);
    await legacy.unmount();
    expect(fake.wire).toEqual([]);

    // Named explicitly, legacy leftovers and all: on, and still nothing is contacted before a sign-in.
    build({ ...LEGACY_BUILD, ...LOCAL_SUPABASE_BUILD });
    await mount();
    expect(account!.enabled).toBe(true);
    expect(account!.signedIn).toBe(false);
    expect(fake.wire).toEqual([]);
  });

  it('a password sign-in reaches only the local GoTrue, through the SDK; after a RAM-only restart a new password sign-in finds the same verified account', async () => {
    build({ ...LEGACY_BUILD, ...LOCAL_SUPABASE_BUILD });
    const first = await mount({ withPanel: true });
    expect(account!.enabled).toBe(true);
    // Sign-up is off at the prepared GoTrue, so the active panel offers none.
    expect(screen.queryByTestId('account-mode-create')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('account-email'), ANI.email);
    await fireEvent.changeText(screen.getByTestId('account-password'), ANI.password);
    await fireEvent.press(screen.getByTestId('account-submit'));
    await waitFor(
      () => {
        expect(account?.panel.error ?? null).toBeNull();
        expect(account?.signedIn).toBe(true);
        expect(account?.panel.busy ?? null).toBeNull();
      },
      { timeout: 5000 }
    );
    // One password grant, sent by the SDK itself (its client header, no API key); nothing for the emulator, a sign-up or
    // anywhere else.
    expect(fake.wire.filter((r) => r.server !== 'api' && r.server !== 'auth')).toEqual([]);
    expect(fake.auth.sent.map((r) => `${r.method} ${r.path}?${r.query}`)).toEqual(['POST /token?grant_type=password']);
    expect(fake.auth.sent[0].headers['x-client-info']).toMatch(/^gotrue-js\//);
    expect(fake.auth.sent[0].headers.apikey).toBeUndefined();
    // The account API was asked with the session's bearer token; a new account, so the adult profile is offered.
    expect(fake.sent.length).toBeGreaterThan(0);
    expect(fake.sent.every((r) => r.bearer)).toBe(true);
    expect(account!.panel.profiles).toEqual([]);
    expect(account!.connected).toBe(false);

    await createAdultProfile();
    const learner = storedLearner(ACCOUNT_KEY);
    expect(learner).not.toBeNull();

    // A restart keeps nothing of the sign-in, in memory or in storage.
    await first.unmount();
    expect(storedASecret()).toBe(false);
    await mount();
    expect(account!.enabled).toBe(true);
    expect(account!.signedIn).toBe(false);
    expect(app!.dataset).toBe('guest');

    // A new password sign-in finds the same verified account's own dataset and profile: no new profile, no guest copy,
    // no merge by address.
    await signIn(ANI);
    await waitFor(() => expect(account?.connected).toBe(true), { timeout: 5000 });
    expect(app!.dataset).toBe('account');
    expect(account!.panel.guestCopy ?? null).toBeNull();
    expect(storedLearner(ACCOUNT_KEY)?.learner_id).toBe(learner?.learner_id);
    expect(fake.profiles).toHaveLength(1);
    expect(fake.wire.filter(passwordGrant)).toHaveLength(2);
    expect(fake.wire.filter(refreshGrant)).toEqual([]);
    expect(storedASecret()).toBe(false);
  });

  it('an expired session is refreshed before verification and sync; an unreachable refresh keeps the session, its data and the retry', async () => {
    build(LOCAL_SUPABASE_BUILD);
    await mount();
    expect(account!.enabled).toBe(true);
    await signIn(ANI);

    // The access token expires before the first account operation: refreshed first, then verified and synced.
    later(HOUR + MINUTE);
    let from = mark();
    await createAdultProfile();
    const afterExpiry = since(from);
    const refreshed = afterExpiry.findIndex(refreshGrant);
    expect(refreshed).toBeGreaterThanOrEqual(0);
    expect(afterExpiry.findIndex(toApi)).toBeGreaterThan(refreshed);
    expect(afterExpiry.filter(passwordGrant)).toEqual([]);
    expect(account!.signedIn).toBe(true);
    expect(fake.profileOf(ANI.accountId)).not.toBeNull();
    const learner = storedLearner(ACCOUNT_KEY);

    // Expired again while the Auth server stays unreachable for longer than the SDK retries: nothing is sent with the
    // expired token, nothing is signed out, switched or lost, and the sync can be tried again.
    later(HOUR + MINUTE);
    fake.auth.setOffline(true, () => later(OUTAGE_STEP));
    from = mark();
    const lastStatus = account!.panel.connected?.syncStatus;
    await act(async () => {
      account!.panel.onSyncNow();
    });
    await waitFor(
      () => {
        expect(since(from).some(refreshGrant)).toBe(true);
        expect(account?.panel.busy ?? null).toBeNull();
        expect(account?.panel.connected?.syncStatus).not.toBe(lastStatus);
      },
      { timeout: 5000 }
    );
    expect(since(from).filter(toApi)).toEqual([]);
    expect(account!.signedIn).toBe(true);
    expect(account!.connected).toBe(true);
    expect(app!.dataset).toBe('account');
    expect(account!.panel.connected?.syncStatus).not.toMatch(/Semua jawaban terkirim/);
    expect(storedLearner(ACCOUNT_KEY)).toEqual(learner);

    // Reachable again: the retry refreshes and syncs on the same session, with no new password sign-in.
    later(2 * MINUTE); // past the SDK's one-minute cooldown for a failed refresh token
    fake.auth.setOffline(false);
    await act(async () => {
      account!.panel.onSyncNow();
    });
    await waitFor(
      () => {
        expect(account?.panel.busy ?? null).toBeNull();
        expect(account?.panel.connected?.syncStatus ?? '').toMatch(/Semua jawaban terkirim/);
      },
      { timeout: 5000 }
    );
    expect(account!.signedIn).toBe(true);
    expect(fake.wire.filter(passwordGrant)).toHaveLength(1);
    expect(fake.profiles).toHaveLength(1);
    expect(storedASecret()).toBe(false);
  });

  it('a refresh the provider refuses (the session was revoked elsewhere) ends the authorization: back to the guest, local data kept', async () => {
    build(LOCAL_SUPABASE_BUILD);
    await mount();
    expect(account!.enabled).toBe(true);
    await signIn(ANI);
    await createAdultProfile();
    const learner = storedLearner(ACCOUNT_KEY);

    // Signed out elsewhere and expired here: the refresh is refused, so this sign-in ends visibly and nothing is sent.
    fake.auth.revokeAll(ANI.email);
    later(HOUR + MINUTE);
    const from = mark();
    await act(async () => {
      account!.panel.onSyncNow();
    });
    await waitFor(
      () => {
        expect(account?.signedIn).toBe(false);
        expect(account?.panel.error ?? null).not.toBeNull();
        expect(app?.dataset).toBe('guest');
        expect(account?.panel.busy ?? null).toBeNull();
      },
      { timeout: 5000 }
    );
    expect(account!.connected).toBe(false);
    expect(since(from).some(refreshGrant)).toBe(true);
    expect(since(from).filter((r) => toApi(r) || passwordGrant(r))).toEqual([]);
    expect(storedLearner(ACCOUNT_KEY)).toEqual(learner);
  });

  it('signing out returns learning to the guest at once; an unconfirmed revocation is reported, and a late outcome never reaches a newer sign-in', async () => {
    build(LOCAL_SUPABASE_BUILD);
    await mount();
    expect(account!.enabled).toBe(true);
    await signIn(ANI);
    await createAdultProfile();
    expect(app!.dataset).toBe('account');

    // The provider's answer is held: the account is still left on this device at once, and its work stops.
    const refused = fake.auth.holdNextLogout();
    let from = mark();
    await act(async () => {
      account!.panel.onSignOut();
    });
    await waitFor(
      () => {
        expect(account?.signedIn).toBe(false);
        expect(account?.connected).toBe(false);
        expect(app?.dataset).toBe('guest');
        expect(account?.panel.busy ?? null).toBeNull();
        expect(since(from).filter(localLogout)).toHaveLength(1);
      },
      { timeout: 5000 }
    );
    await act(async () => {
      account!.panel.onSyncNow();
    });
    expect(since(from).filter(toApi)).toEqual([]);
    expect(since(from).filter((r) => r.server === 'auth' && r.path === '/logout' && !localLogout(r))).toEqual([]);

    // The provider refuses: the session still works there, and the panel says so instead of a plain sign-out.
    await act(async () => {
      refused.release('refuse');
      await pause();
    });
    await waitFor(() => expect(account?.panel.error ?? null).not.toBeNull(), { timeout: 5000 });
    expect(account!.signedIn).toBe(false);
    expect(fake.auth.liveSessions(ANI.email)).toBe(1);

    // Confirmed by the provider: nothing to report.
    await signIn(ANI);
    from = mark();
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
    await act(pause);
    expect(fake.auth.liveSessions(ANI.email)).toBe(1); // only the earlier, refused one
    expect(account!.panel.error ?? null).toBeNull();

    // A late answer about an earlier sign-out changes nothing for the account signed in since.
    await signIn(ANI);
    const late = fake.auth.holdNextLogout();
    await act(async () => {
      account!.panel.onSignOut();
    });
    await waitFor(() => expect(account?.signedIn).toBe(false), { timeout: 5000 });
    await signIn(BUDI);
    await act(async () => {
      late.release('refuse');
      await pause();
    });
    expect(account!.signedIn).toBe(true);
    expect(account!.panel.account?.label).toBe(BUDI.email);
    expect(account!.panel.error ?? null).toBeNull();
  });
});
