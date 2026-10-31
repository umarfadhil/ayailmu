// The account controller's waits on the account API are bounded (C2 in app/docs/plans/2026-10-20-correctness.md), written
// before the fix. The real AppProvider, AccountProvider, maintained Supabase Auth SDK and adapter, API client, sync journal
// and KvStore datasets run here. The network is the frozen fake account API and fake local GoTrue of test/fakeAccountApi.ts
// behind a stalling layer of this test's own: a planned API request goes on to the fake at once (which records it, and
// commits an import), while the headers or the body of its reply are held back until released, whatever the request's
// abort signal says, as a stuck connection may. Today a held reply leaves the controller busy for good. Each request must
// end at the API client's 60 s deadline as a lost connection would: busy clears into the existing message (lost response,
// offline, unreachable), the choices made stay, a late reply changes nothing, and a retry resends the frozen import byte
// for byte, so the server replays its commit instead of making a second profile. The clock is Jest's fake one, moved only
// inside act; nothing waits in real time. No real Auth server, network or credentials.
import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, LOCAL_ACCOUNT_CONSENT_VERSION, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, type FakeAccountApi, type FakeUser, type WireRecord } from '../../../test/fakeAccountApi';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

jest.setTimeout(30_000);

const T = Date.UTC(2026, 9, 20, 4, 0, 0);
/** The planned default (API_REQUEST_TIMEOUT_MS once the client exports it): one deadline per request, headers and body together. */
const DEADLINE_MS = 60_000;

const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-deadline-1', uid: 'uid-ani', token: 'legacy-id-token-ani', accountId: '6b1d1f4e-2c3a-4d5e-8f60-71a2b3c4d5e6' };
const ACCOUNT_KEY = accountNamespace(ANI.accountId).kvKey;
const GUEST_KEY = GUEST_NAMESPACE.kvKey;

// The controller's existing messages, unchanged by the fix.
const LOST_RESPONSE = 'Respons layanan akun belum diterima. Jawaban tetap tersimpan di perangkat ini; sinkronkan lagi untuk mengirim ulang permintaan yang sama.';
const OFFLINE = 'Tidak ada koneksi ke layanan akun lokal. Jawaban tetap tersimpan di perangkat ini.';
const UNREACHABLE = 'Layanan akun lokal tidak terjangkau. Belajar tetap bisa tanpa akun.';
const LINKED = 'Profil tersambung. Semua jawaban terkirim.';

const BUILD_KEYS = [
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
  'EXPO_PUBLIC_AUTH_EMULATOR_URL',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_GOOGLE_SIGN_IN',
] as const;
/** The explicit local-supabase build: the provider named, the account API, and the root of the local GoTrue. */
const LOCAL_SUPABASE_BUILD: Partial<Record<(typeof BUILD_KEYS)[number], string>> = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_API_BASE_URL: FAKE_API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: FAKE_GOTRUE,
};
/** The process's own values, put back after every test. */
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);

const GUEST_LEARNER: Learner = {
  learner_id: 'lrn-guest-deadline',
  created_at: '2026-10-19T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-19T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: ['DEMO-S1'],
};
const GUEST_ANSWER: AnswerRecord = {
  answer_id: 'ans-guest-deadline-1',
  learner_id: GUEST_LEARNER.learner_id,
  item_id: 'A3-M01',
  content_version: 'demo-synthetic-0.3',
  rules_version: 'pilot-0.3-local',
  app_version: '0.2.0',
  timestamp: '2026-10-19T02:01:00.000Z',
  local_date: '2026-10-19',
  session_id: 'ses-guest-deadline',
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
/** A guest dataset with its learner and one answer, as an earlier run of the app left it. */
const GUEST_BLOB = JSON.stringify({ schema: 2, meta: {}, learner: GUEST_LEARNER, answers: [GUEST_ANSWER], snapshot: null, reports: [] });

type Withhold = 'headers' | 'body';

/** One API request whose reply the stalling layer holds back. */
interface Held {
  method: string;
  path: string;
  /** The request body exactly as the app sent it. */
  body: string;
  /** When the app sent it, on Jest's clock. */
  at: number;
  /** Hands the app what was held back: late. */
  release(): void;
}

/**
 * The app's network for one test: the frozen fake account API and fake GoTrue, except that each planned API request goes
 * on to the fake at once (which records it, and commits a write) while the headers or the body of its reply are held back
 * from the app until released. Like a stuck connection, it never acts on the request's abort signal.
 */
function stallingNetwork(api: FakeAccountApi) {
  const plans: { method: string; path: RegExp; withhold: Withhold }[] = [];
  const held: Held[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.startsWith(`${FAKE_API}/`) ? new URL(url).pathname : '';
    const index = plans.findIndex((p) => p.method === method && p.path.test(path));
    if (index < 0) return api.fetch(input, init);
    const [{ withhold }] = plans.splice(index, 1);
    const answered = api.fetch(input, init);
    let release: () => void = () => undefined;
    held.push({ method, path, body: typeof init?.body === 'string' ? init.body : '', at: Date.now(), release: () => release() });
    if (withhold === 'headers') {
      return new Promise<Response>((resolve) => {
        release = () => void answered.then(resolve);
      });
    }
    const reply = (await answered) as unknown as Record<string, unknown> & { text(): Promise<string> };
    const body = new Promise<string>((resolve) => {
      release = () => void reply.text().then(resolve);
    });
    return { ...reply, text: () => body, json: async () => JSON.parse(await body) as unknown } as unknown as Response;
  };
  return { fetch, plans, held };
}

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };

let device: KvBackend = memoryKv();
/** Every entry written to the device storage in this test: no password or token may ever be among them. */
let written: string[] = [];
let fake: FakeAccountApi = fakeAccountApi([ANI]);
let net = stallingNetwork(fake);
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

/** Hands both contexts to the test after each render (in an effect, never during render). */
function Probe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue;
  }, [accountValue, appValue]);
  return null;
}

/**
 * Lets everything already due run and render, round after round, without moving Jest's clock: until `ready` holds (and
 * then a few rounds more), or the rounds run out. The caller asserts what it waited for.
 */
async function settle(ready: () => boolean = () => true, rounds = 40) {
  let extra = 3;
  for (let i = 0; i < rounds && extra > 0; i += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    if (ready()) extra -= 1;
  }
}

/** Moves Jest's clock on to `at`, inside act, running whatever falls due on the way; then settles as above. */
async function advanceTo(at: number, ready?: () => boolean) {
  const ms = at - Date.now();
  if (ms < 0) throw new Error(`Jest's clock is already ${-ms} ms past that moment.`);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
  await settle(ready);
}

const idle = () => (account?.panel.busy ?? null) === null;

/**
 * The values Probe last handed over, read through a call: right after mount() resets the variables to null, TypeScript
 * would otherwise keep them narrowed to null, unaware of Probe's effect.
 */
const handedApp = (): ReturnType<typeof useApp> | null => app;
const handedAccount = (): AccountContextValue | null => account;

async function mount() {
  account = null;
  app = null;
  await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset}>
        <Probe />
      </AccountProvider>
    </AppProvider>
  );
  await settle(() => app?.ready === true && account?.enabled === true);
  expect(handedApp()?.ready).toBe(true);
  expect(handedAccount()?.enabled).toBe(true);
}

async function signIn(user: FakeUser) {
  await act(async () => {
    account!.panel.onSubmit({ mode: 'signin', email: user.email, password: user.password });
  });
  await settle(() => (account?.panel.account ?? null) !== null && idle());
  expect(account!.panel.error ?? null).toBeNull();
  expect(account!.panel.account?.label).toBe(user.email);
  expect(account!.panel.busy ?? null).toBeNull();
}

type ImportBody = { target: { new_profile?: { consent?: { version?: string; at?: string } } } };
const importsSent = () => fake.sent.filter((r) => r.method === 'POST' && r.path === '/v1/imports').map((r) => r.body);
const storedAt = (key: string) => JSON.parse(device.getItem(key) ?? 'null') as { learner: Learner | null; answers: AnswerRecord[] } | null;
/** Whether the password, or any token the GoTrue issued, was ever written to the device storage. */
const storedASecret = () => {
  const secrets = [ANI.password, ...fake.auth.issued()];
  return written.some((entry) => secrets.some((secret) => entry.includes(secret)));
};
const localLogout = (r: WireRecord) => r.server === 'auth' && r.path === '/logout' && r.query === 'scope=local';

beforeEach(() => {
  jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'queueMicrotask'] });
  for (const key of BUILD_KEYS) {
    const value = LOCAL_SUPABASE_BUILD[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  written = [];
  device = recordingDevice();
  fake = fakeAccountApi([ANI]);
  net = stallingNetwork(fake);
  globalThis.fetch = net.fetch as typeof fetch;
  account = null;
  app = null;
});

afterEach(async () => {
  // Whatever an unmount started (its sign-out) finishes on this test's own network and clock.
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
  }
  globalThis.fetch = realFetch;
  for (const [key, value] of BASELINE) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.useRealTimers();
});

describe('the account controller: every wait on the account API ends at the deadline', () => {
  it('a new profile whose import reply body stalls after the server committed it: busy clears at the deadline with the lost-response status, every choice made stays, a late reply changes nothing, and the retry resends the same bytes to link the one profile', async () => {
    device.setItem(GUEST_KEY, GUEST_BLOB);
    const guestBytes = device.getItem(GUEST_KEY);
    await mount();
    await signIn(ANI);
    expect(account!.panel.guestCopy?.answers).toBe(1); // offered; this learner does not copy

    net.plans.push({ method: 'POST', path: /^\/v1\/imports$/, withhold: 'body' });
    await act(async () => {
      account!.panel.onCreateProfile({ adult: true, agreed: true });
    });
    await settle(() => net.held.length === 1);
    expect(net.held.map((h) => `${h.method} ${h.path}`)).toEqual(['POST /v1/imports']);
    const [stalled] = net.held;
    // The server committed the import; only its reply body is held back.
    expect(fake.committedImports(ANI.accountId)).toBe(1);
    expect(fake.profiles).toHaveLength(1);
    expect(account!.panel.busy).toBe('sync');

    await advanceTo(stalled.at + DEADLINE_MS - 1);
    expect(account!.panel.busy).toBe('sync');
    await advanceTo(stalled.at + DEADLINE_MS, idle);

    // Bounded: busy clears into the existing lost-response status; nothing is reported as sent.
    expect(account!.panel.busy ?? null).toBeNull();
    expect(account!.panel.error ?? null).toBeNull();
    expect(account!.panel.connected?.syncStatus).toBe(LOST_RESPONSE);
    // Every choice made stays: signed in, learning in the account's dataset under the consent given (as the frozen import
    // carries it), the guest answer not copied and the guest dataset untouched.
    expect(account!.signedIn).toBe(true);
    expect(app!.dataset).toBe('account');
    const learner = storedAt(ACCOUNT_KEY)?.learner ?? null;
    expect(learner?.consent_version).toBe(LOCAL_ACCOUNT_CONSENT_VERSION);
    const consent = { version: learner?.consent_version, at: learner?.consent_at };
    expect((JSON.parse(stalled.body) as ImportBody).target.new_profile?.consent).toEqual(consent);
    expect(storedAt(ACCOUNT_KEY)?.answers ?? []).toEqual([]);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);

    // The reply arriving late changes nothing.
    await act(async () => stalled.release());
    await settle();
    expect(account!.panel.connected?.syncStatus).toBe(LOST_RESPONSE);
    expect(account!.panel.busy ?? null).toBeNull();

    // The retry resends the frozen import byte for byte (so it was neither acknowledged nor linked, late reply included):
    // the server replays its commit, and the one profile is linked.
    await act(async () => {
      account!.panel.onSyncNow();
    });
    await settle(() => idle() && account?.panel.connected?.syncStatus !== LOST_RESPONSE);
    expect(account!.panel.busy ?? null).toBeNull();
    expect(account!.panel.connected?.syncStatus).toBe(LINKED);
    expect(importsSent()).toEqual([stalled.body, stalled.body]);
    expect(fake.committedImports(ANI.accountId)).toBe(1);
    expect(fake.profiles).toHaveLength(1);
    expect(fake.profileOf(ANI.accountId)?.consent).toEqual(consent);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(storedASecret()).toBe(false);
  });

  it('a /v1/me reply whose headers never come during sign-in: the sign-in ends at the deadline with the unreachable message, busy clears, learning stays with the guest, nothing is stored, a late reply changes nothing and signing in again works', async () => {
    device.setItem(GUEST_KEY, GUEST_BLOB);
    const guestBytes = device.getItem(GUEST_KEY);
    await mount();

    net.plans.push({ method: 'GET', path: /^\/v1\/me$/, withhold: 'headers' });
    await act(async () => {
      account!.panel.onSubmit({ mode: 'signin', email: ANI.email, password: ANI.password });
    });
    await settle(() => net.held.length === 1);
    expect(net.held.map((h) => `${h.method} ${h.path}`)).toEqual(['GET /v1/me']);
    const [stalled] = net.held;
    expect(account!.panel.busy).toBe('auth');

    await advanceTo(stalled.at + DEADLINE_MS - 1);
    expect(account!.panel.busy).toBe('auth');
    await advanceTo(stalled.at + DEADLINE_MS, idle);

    expect(account!.panel.busy ?? null).toBeNull();
    expect(account!.panel.error).toBe(UNREACHABLE);
    expect(account!.signedIn).toBe(false);
    expect(app!.dataset).toBe('guest');
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(device.getItem(ACCOUNT_KEY)).toBeNull();
    // The session that sign-in made is signed out at the provider as well.
    expect(fake.wire.filter(localLogout)).toHaveLength(1);
    expect(storedASecret()).toBe(false);

    // The reply arriving late changes nothing.
    await act(async () => stalled.release());
    await settle();
    expect(account!.signedIn).toBe(false);
    expect(account!.panel.error).toBe(UNREACHABLE);
    expect(app!.dataset).toBe('guest');
    expect(device.getItem(ACCOUNT_KEY)).toBeNull();

    // Recoverable: with the API answering, signing in again works, and the guest data is still there to copy or keep.
    await signIn(ANI);
    expect(account!.panel.guestCopy?.answers).toBe(1);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
    expect(storedASecret()).toBe(false);
  });

  it('a linked profile whose pull and then follow-up progress replies both stall: busy clears only once each request has reached its own deadline, one after the other, with the offline status', async () => {
    await mount();
    await signIn(ANI);
    await act(async () => {
      account!.panel.onCreateProfile({ adult: true, agreed: true });
    });
    await settle(() => idle() && account?.panel.connected?.syncStatus === LINKED);
    expect(account!.panel.connected?.syncStatus).toBe(LINKED);

    net.plans.push(
      { method: 'GET', path: /^\/v1\/profiles\/[^/]+\/events$/, withhold: 'body' },
      { method: 'GET', path: /^\/v1\/profiles\/[^/]+\/progress$/, withhold: 'body' }
    );
    const routes = () => net.held.map((h) => h.path.split('/').pop());
    await act(async () => {
      account!.panel.onSyncNow();
    });
    await settle(() => net.held.length === 1);
    expect(routes()).toEqual(['events']);
    const [pull] = net.held;

    // The pull reaches its deadline; the progress read that follows a failed sync then waits on its own.
    await advanceTo(pull.at + DEADLINE_MS, () => net.held.length === 2);
    expect(routes()).toEqual(['events', 'progress']);
    const progress = net.held[1];
    expect(progress.at).toBe(pull.at + DEADLINE_MS);
    expect(account!.panel.busy).toBe('sync');

    await advanceTo(progress.at + DEADLINE_MS - 1);
    expect(account!.panel.busy).toBe('sync');
    await advanceTo(progress.at + DEADLINE_MS, idle);

    // Two deadlines in a row, then the existing offline status; still signed in and learning in the account's dataset.
    expect(account!.panel.busy ?? null).toBeNull();
    expect(account!.panel.connected?.syncStatus).toBe(OFFLINE);
    expect(account!.signedIn).toBe(true);
    expect(app!.dataset).toBe('account');

    // Replies arriving late change nothing.
    await act(async () => net.held.forEach((h) => h.release()));
    await settle();
    expect(account!.panel.connected?.syncStatus).toBe(OFFLINE);
    expect(account!.panel.busy ?? null).toBeNull();
  });
});
