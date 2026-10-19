// A staging build in the app's account layer, Phase 18 RED. With its explicit opt-in (EXPO_PUBLIC_ACCOUNT_ENV=staging
// beside EXPO_PUBLIC_AUTH_PROVIDER=local-supabase) the real AppProvider, AccountProvider, AccountPanel, SDK, adapter,
// API client, sync journal and KvStore datasets reach only the staging origins: the password sign-in at the standalone
// GoTrue's root, the verification and sync at the staging API, the refresh before an expired session's first account
// operation at the root again, and the sign-out there too; never a local or plain-http address or a hosted /auth/v1
// prefix. The panel says it is staging, and its adult-profile consent names the staging server; nothing is consented,
// created or copied until the adult chooses, and the profile records a staging consent version, not the local one.
// Without the opt-in the same addresses keep the account layer off. The staging hosts are documented placeholders
// (example.com), never resolved or contacted: requests to them are answered by the frozen fake account API and fake
// GoTrue of test/fakeAccountApi.ts. No password or token reaches the device storage.
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, LOCAL_ACCOUNT_CONSENT_VERSION, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

const STAGING_API = 'https://api-staging.example.com';
const STAGING_AUTH = 'https://auth-staging.example.com';
const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-staging-2', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
  'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL',
  'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL',
] as const;
type Build = Partial<Record<(typeof BUILD_KEYS)[number], string>>;
const STAGING_BUILD: Build = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  EXPO_PUBLIC_API_BASE_URL: STAGING_API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: STAGING_AUTH,
};
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

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };

const GUEST_LEARNER: Learner = {
  learner_id: 'lrn-guest-staging',
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
    answer_id: `ans-guest-staging-${n}`,
    learner_id: GUEST_LEARNER.learner_id,
    item_id: 'A3-M01',
    content_version: 'demo-synthetic-0.3',
    rules_version: 'pilot-0.3-local',
    app_version: '0.2.0',
    timestamp: `2026-10-15T02:0${n}:00.000Z`,
    local_date: '2026-10-15',
    session_id: 'ses-guest-staging',
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

let device: KvBackend = memoryKv();
/** Every entry written to the device storage in this test: no password or token may be among them. */
let written: string[] = [];
let fake: FakeAccountApi = fakeAccountApi([]);
/** Every request the app sent, as method and full URL. */
let requested: string[] = [];
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

async function openGuest() {
  const guest = new KvStore(device);
  await guest.init();
  return guest;
}

function openAccountDataset(namespace: Namespace) {
  return openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });
}

/** The staging network: the staging API and Auth origins, answered by the frozen fakes; anything else does not answer. */
const stagingFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  requested.push(`${init?.method ?? 'GET'} ${url}`);
  const local = url.startsWith(`${STAGING_API}/`)
    ? FAKE_API + url.slice(STAGING_API.length)
    : url.startsWith(`${STAGING_AUTH}/`)
      ? FAKE_GOTRUE + url.slice(STAGING_AUTH.length)
      : null;
  if (local === null) throw new TypeError('Network request failed');
  const reply = (await fake.fetch(local, init)) as unknown as Record<string, unknown>;
  return { ...reply, url } as unknown as Response;
}) as typeof fetch;

function Probe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue;
  }, [accountValue, appValue]);
  return accountValue.enabled ? <AccountPanel {...accountValue.panel} /> : null;
}

async function mount() {
  account = null;
  app = null;
  const view = await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset}>
        <Probe />
      </AccountProvider>
    </AppProvider>
  );
  await waitFor(() => expect(app?.ready).toBe(true));
  return view;
}

async function passwordSignIn(user: FakeUser) {
  await act(async () => {
    account!.panel.onSubmit({ mode: 'signin', email: user.email, password: user.password });
  });
  await waitFor(
    () => {
      expect(account?.panel.error ?? null).toBeNull();
      expect(account?.signedIn).toBe(true);
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

/** Whether a password or a token ever reached the device storage. */
const storedASecret = () => {
  const secrets = [ANI.password, ...fake.auth.issued()];
  return written.some((entry) => secrets.some((secret) => entry.includes(secret)));
};

beforeEach(() => {
  build({});
  skew = 0;
  clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  written = [];
  requested = [];
  device = recordingDevice();
  fake = fakeAccountApi([ANI]);
  globalThis.fetch = stagingFetch;
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

describe('a staging build in the account layer', () => {
  it('without the opt-in, the staging addresses keep the account layer off and nothing is contacted', async () => {
    build({ ...STAGING_BUILD, EXPO_PUBLIC_ACCOUNT_ENV: undefined });
    await mount();
    expect(account!.enabled).toBe(false);
    expect(requested).toEqual([]);
  });

  it("signs in at the staging Auth root, verifies at the staging API, says it is staging, waits for the adult's explicit consent and refreshes at the root before it syncs", async () => {
    device.setItem(GUEST_KEY, blob(GUEST_LEARNER, [guestAnswer(1), guestAnswer(2)]));
    const guestBytes = device.getItem(GUEST_KEY);
    build(STAGING_BUILD);
    await mount();
    expect(account!.enabled).toBe(true);
    expect(screen.getByTestId('account-title')).toHaveTextContent(/staging/i);

    await passwordSignIn(ANI);
    expect(screen.getByTestId('account-status')).toHaveTextContent(`Masuk sebagai ${ANI.email}`);
    expect(requested).toEqual([`POST ${STAGING_AUTH}/token?grant_type=password`, `GET ${STAGING_API}/v1/me`]);

    // Nothing is consented, created or copied until the adult chooses; the consent statement names the staging server.
    expect(app!.dataset).toBe('guest');
    expect(account!.connected).toBe(false);
    expect(account!.panel.guestCopy?.answers).toBe(2);
    for (const tick of ['profile-adult', 'profile-agree', 'guest-copy-consent']) expect(screen.getByTestId(tick)).not.toBeChecked();
    expect(screen.getByTestId('profile-agree')).toHaveTextContent(/staging/i);
    expect(fake.profiles).toHaveLength(0);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);

    // Expired before the first account operation: refreshed at the staging root first, then the profile is created under
    // a staging consent version, and the guest answers are not copied.
    later(HOUR + MINUTE);
    const from = requested.length;
    await createAdultProfile();
    const after = requested.slice(from);
    const refreshed = after.indexOf(`POST ${STAGING_AUTH}/token?grant_type=refresh_token`);
    expect(refreshed).toBeGreaterThanOrEqual(0);
    expect(after.findIndex((request) => request.includes(STAGING_API))).toBeGreaterThan(refreshed);
    const version = fake.profileOf(ANI.accountId)?.consent.version ?? '';
    expect(version).not.toBe(LOCAL_ACCOUNT_CONSENT_VERSION);
    expect(version).toMatch(/staging/);
    expect(app!.dataset).toBe('account');
    const stored = JSON.parse(device.getItem(accountNamespace(ANI.accountId).kvKey) ?? 'null') as { answers?: unknown[] } | null;
    expect(stored?.answers ?? []).toEqual([]);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);

    // Signing out revokes the session at the staging root.
    await act(async () => {
      account!.panel.onSignOut();
    });
    await waitFor(() => expect(account?.signedIn).toBe(false), { timeout: 5000 });
    expect(requested).toContain(`POST ${STAGING_AUTH}/logout?scope=local`);

    // Only the staging origins were ever asked: never a local or plain-http address, never a hosted /auth/v1 prefix.
    for (const request of requested) expect(request).toMatch(/^[A-Z]+ https:\/\/(api|auth)-staging\.example\.com\//);
    expect(requested.some((request) => request.includes('/auth/v1'))).toBe(false);
    expect(storedASecret()).toBe(false);
  });
});
