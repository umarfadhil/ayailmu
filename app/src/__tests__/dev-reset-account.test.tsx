// D-1 and D-7 (readiness review 2026-10-18), written before the fix. «Data pengembang» resets whichever dataset is in
// use. While a signed-in account's dataset is selected, that would wipe the account's learning store while its sync
// journal, a separate document, keeps the answers it holds; so no developer reset is available for an account dataset.
// The guard is the selected account dataset, not the read-only state: these tests keep the dataset writable. A
// confirmation opened for guest data must not carry over to an account dataset selected afterwards. The guest reset
// keeps working: one confirmation, one reset of the guest data only. Account data on the same device stays as it was,
// and the page says which data it deletes. The real Dev route, AppContext, KvStore and account dataset run here; the
// test supplies only the device storage, the lock manager and the dataset selection an AccountProvider makes after an
// explicit profile choice.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type OpenedKvDataset } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { AppProvider, useApp } from '@/ui/AppContext';

import Dev from '@/app/dev';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

const ACCOUNT = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const GUEST_KEY = GUEST_NAMESPACE.kvKey;
const ACCOUNT_KEY = accountNamespace(ACCOUNT).kvKey;

const GUEST_LEARNER: Learner = {
  learner_id: 'lrn-guest-dev',
  created_at: '2026-10-15T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-15T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: ['DEMO-S1'],
};
const ACCOUNT_LEARNER: Learner = { ...GUEST_LEARNER, learner_id: 'lrn-account-dev' };

function answer(answer_id: string, learner: Learner): AnswerRecord {
  return {
    answer_id,
    learner_id: learner.learner_id,
    item_id: 'A3-M01',
    content_version: 'demo-synthetic-0.3',
    rules_version: 'pilot-0.3-local',
    app_version: '0.2.0',
    timestamp: '2026-10-15T02:00:00.000Z',
    local_date: '2026-10-15',
    session_id: 'ses-dev',
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
const blob = (learner: Learner, answers: AnswerRecord[]) =>
  JSON.stringify({ schema: 2, meta: {}, learner, answers, snapshot: null, reports: [] });

/** One device's web storage, with the guest and account datasets side by side; counts the writes per key. */
function deviceStorage() {
  const inner = memoryKv();
  const writes = new Map<string, number>();
  const counted = (key: string) => writes.set(key, (writes.get(key) ?? 0) + 1);
  const kv: KvBackend = {
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => {
      counted(key);
      inner.setItem(key, value);
    },
    removeItem: (key) => {
      counted(key);
      inner.removeItem(key);
    },
  };
  return { kv, writes: (key: string) => writes.get(key) ?? 0 };
}

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };

let device = deviceStorage();
let seeded = { guest: '', account: '' };
let app: ReturnType<typeof useApp> | null = null;
const opened: OpenedKvDataset[] = [];

/** The guest dataset as the web build opens it (the AppProvider's store factory). */
async function openGuest() {
  const store = new KvStore(device.kv);
  await store.init();
  return store;
}

/** Hands the app context to the test after each render (in an effect, never during render). */
function Probe() {
  const value = useApp();
  useEffect(() => {
    app = value;
  }, [value]);
  return null;
}

function TestLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider storeFactory={openGuest}>
        <Probe />
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      </AppProvider>
    </SafeAreaProvider>
  );
}

function HomeStub() {
  return <Text testID="home-stub">Beranda</Text>;
}

const routes = { _layout: TestLayout, index: HomeStub, dev: Dev };

/** The learner and the answer IDs a dataset holds right now, read from the device storage. */
function holds(key: string) {
  const stored = JSON.parse(device.kv.getItem(key) ?? 'null') as { learner: Learner | null; answers: AnswerRecord[] } | null;
  return { learner: stored?.learner?.learner_id ?? null, answers: (stored?.answers ?? []).map((a) => a.answer_id) };
}

type Host = ReturnType<typeof screen.getByTestId>;
const isDisabled = (el: Host) => el.props.accessibilityState?.disabled === true || el.props['aria-disabled'] === true;

async function tap(id: string) {
  await waitFor(() => expect(screen.getByTestId(id)).toBeEnabled());
  await fireEvent.press(screen.getByTestId(id));
}

/** What a learner can do: press the control if it is shown and enabled. */
async function pressIfAvailable(id: string) {
  const el = screen.queryByTestId(id);
  if (el && !isDisabled(el)) await fireEvent.press(el);
}

async function openDev() {
  await renderRouter(routes, { initialUrl: '/dev' });
  await waitFor(() => expect(app?.ready).toBe(true));
  await screen.findByText('Data pengembang');
  expect(app?.dataset).toBe('guest');
}

/** What the AccountProvider does after an explicit profile choice: the account's own dataset, writable here. */
async function selectAccountDataset(): Promise<OpenedKvDataset> {
  const dataset = await openKvDataset({ kv: device.kv, locks: OWN_LOCKS, namespace: accountNamespace(ACCOUNT) });
  opened.push(dataset);
  expect(dataset.access).toBe('owner');
  await act(async () => {
    await app!.selectDataset({ store: dataset.store, readOnly: null });
  });
  await waitFor(() => expect(app?.dataset).toBe('account'));
  expect(app?.readOnly).toBeNull(); // writable: the existing read-only guard is not what keeps the account safe
  return dataset;
}

/** Waits until every write already queued on the account dataset's store has landed (same serial queue). */
async function drained(dataset: OpenedKvDataset) {
  await act(async () => {
    await dataset.raw.readRaw();
  });
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_APP_MODE;
  device = deviceStorage();
  device.kv.setItem(GUEST_KEY, blob(GUEST_LEARNER, [answer('ans-guest-1', GUEST_LEARNER)]));
  device.kv.setItem(ACCOUNT_KEY, blob(ACCOUNT_LEARNER, [answer('ans-account-1', ACCOUNT_LEARNER)]));
  seeded = { guest: device.kv.getItem(GUEST_KEY)!, account: device.kv.getItem(ACCOUNT_KEY)! };
  app = null;
});

afterEach(() => {
  for (const dataset of opened.splice(0)) dataset.release();
});

describe('Data pengembang: the developer reset never reaches an account dataset (D-1)', () => {
  it('with a writable account dataset in use, no reset is available and the account data stays as it was', async () => {
    await openDev();
    const dataset = await selectAccountDataset();

    const open = screen.queryByTestId('reset-open');
    if (open) expect(open).toBeDisabled();
    expect(screen.queryByTestId('reset-confirm')).toBeNull();

    // Whatever is still shown, nothing a learner can press reaches the account dataset.
    await pressIfAvailable('reset-open');
    await pressIfAvailable('reset-confirm');
    await drained(dataset);
    expect(holds(ACCOUNT_KEY)).toEqual({ learner: ACCOUNT_LEARNER.learner_id, answers: ['ans-account-1'] });
    expect(device.kv.getItem(ACCOUNT_KEY)).toBe(seeded.account);
    expect(device.kv.getItem(GUEST_KEY)).toBe(seeded.guest);

    // D-7: while an account dataset (which syncs with the local account service) is in use, the page names the account
    // scope it shows and makes no «no backend / nothing is sent» claim.
    expect(screen.queryAllByText(/tidak ada backend/i)).toHaveLength(0);
    expect(screen.queryAllByText(/tidak ada data yang dikirim/i)).toHaveLength(0);
    expect(screen.queryAllByText(/akun/i).length).toBeGreaterThan(0);
  });

  it('a confirmation opened for the guest data cannot reset an account dataset selected afterwards', async () => {
    await openDev();
    await tap('reset-open');
    expect(screen.getByTestId('reset-confirm')).toBeEnabled(); // the guest confirmation is open

    // For example, the learner signs in on «Akun lokal» and comes back to this retained route.
    const dataset = await selectAccountDataset();

    await pressIfAvailable('reset-confirm');
    await drained(dataset);
    expect(holds(ACCOUNT_KEY)).toEqual({ learner: ACCOUNT_LEARNER.learner_id, answers: ['ans-account-1'] });
    expect(device.kv.getItem(ACCOUNT_KEY)).toBe(seeded.account);
    expect(device.kv.getItem(GUEST_KEY)).toBe(seeded.guest);
    const stale = screen.queryByTestId('reset-confirm');
    if (stale) expect(stale).toBeDisabled();
  });

  it('the guest reset stays available: one confirmation resets the guest data once and leaves account data on this device untouched', async () => {
    await openDev();
    // Account data stays on this device, so the reset says it deletes the guest data, never «all local data».
    const resetNamesGuestData = within(screen.getByTestId('reset-open')).queryAllByText(/tamu/i).length > 0;
    let claimsAllLocalData = screen.queryAllByText(/semua data lokal/i).length > 0;
    await tap('reset-open');
    claimsAllLocalData = claimsAllLocalData || screen.queryAllByText(/semua data lokal/i).length > 0;

    const before = { guest: device.writes(GUEST_KEY), account: device.writes(ACCOUNT_KEY) };
    await tap('reset-confirm');
    await screen.findByTestId('home-stub'); // the reset finished and the route moved on

    expect(holds(GUEST_KEY)).toEqual({ learner: null, answers: [] });
    expect(device.writes(GUEST_KEY) - before.guest).toBe(1); // one confirmation, one reset
    expect(device.writes(ACCOUNT_KEY) - before.account).toBe(0);
    expect(device.kv.getItem(ACCOUNT_KEY)).toBe(seeded.account);
    // Checked last, so the guest reset behaviour above is observed either way.
    expect({ resetNamesGuestData, claimsAllLocalData }).toEqual({ resetNamesGuestData: true, claimsAllLocalData: false });
  });
});
