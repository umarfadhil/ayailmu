// A guest's Unit A progress reaches the account through the explicit guest copy, RED (regression-first), one case. The
// guest learner is paused at Unit A feedback (developer demo, no content approval) with an empty answer log, so the
// account panel offered no copy (it counted answers only), and the generic copy kept the document guest-owned, which the
// account's controller blocks. Signed in, the real AccountPanel must offer the copy for that progress without inventing
// an answer count, only after its existing consent tick; once copied and the adult profile created, the account's
// learner is the guest's and its controller resumes the same feedback, the guest dataset unchanged and no historical
// answer written. The real AppProvider, AccountProvider, maintained SDK, Auth adapter, API client and KvStore datasets
// run a production build whose fictional hosts (example.org) are answered by the frozen fakes of test/fakeAccountApi.ts
// through test/productionNetwork.ts, never resolved or contacted. Every value is a fixture; nothing is printed.
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { localDate } from '@/engine/util';
import { PILOT_META_KEY } from '@/pilot/unitA/capture';
import { createPilotController, type PilotView } from '@/pilot/unitA/controller';
import { PILOT_GUEST_ARCHIVE_PREFIX } from '@/pilot/unitA/guestImport';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { Learner, Store } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { sha256Hex } from '@/sync/sha256';
import { AccountPanel } from '@/ui/account/AccountPanel';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, CONSENT_VERSION, useApp } from '@/ui/AppContext';
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

/** A real-format address known to the fake GoTrue only, with its own provider user and canonical account ID. */
const A: FakeUser = { email: 'learner.a@example.org', password: 'fixture-password-a', uid: 'uid-A', token: 'legacy-fixture-token-a', accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01' };

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
/** The process's own values, put back after the test. */
const BASELINE = BUILD_KEYS.map((key) => [key, process.env[key]] as const);
const realFetch = globalThis.fetch;

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const GUEST_KEY = GUEST_NAMESPACE.kvKey;
const ACCOUNT_KEY = accountNamespace(A.accountId).kvKey;
const SOON = { timeout: 5000 };

const LEARNER_ID = 'lrn-guest-pilot-ui-1';
const GUEST_LEARNER: Learner = {
  learner_id: LEARNER_ID,
  created_at: '2026-10-20T01:00:00.000Z',
  consent_version: CONSENT_VERSION,
  consent_at: '2026-10-20T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
};

let device: KvBackend = memoryKv();
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let view: Awaited<ReturnType<typeof render>> | null = null;

async function openGuest() {
  const guest = new KvStore(device);
  await guest.init();
  return guest;
}

function openAccountDataset(namespace: Namespace) {
  return openKvDataset({ kv: device, locks: OWN_LOCKS, namespace });
}

/** Captures both contexts as last committed, and renders the actual account panel from the account layer's props. */
function PanelProbe() {
  const accountValue = useAccount();
  const appValue = useApp();
  useEffect(() => {
    account = accountValue;
    app = appValue;
  }, [accountValue, appValue]);
  return <AccountPanel {...accountValue.panel} />;
}

function pilotController(store: Store, owner: string, today: string, active: () => boolean) {
  return createPilotController({
    store,
    owner,
    mode: 'developer-demo',
    today: () => today,
    readOnly: () => false,
    active,
    assistedToday: async () => false,
    random: () => 0.5,
  });
}

/** The guest learner, paused at Unit A feedback after one first choice: progress in the pilot document only. */
async function pausedGuest(today: string): Promise<{ paused: PilotView; pilotRaw: string }> {
  const guest = await openGuest();
  await guest.saveLearner(GUEST_LEARNER);
  const c = pilotController(guest, `guest:${LEARNER_ID}`, today, () => true);
  expect((await c.load()).kind).toBe('lesson');
  const q = await c.next();
  if (q.kind !== 'question') throw new Error(`expected a question, got ${q.kind}`);
  const paused = await c.answer(q.presentationId, q.options[0]!.id);
  expect(paused.kind).toBe('feedback');
  c.dispose();
  expect(await guest.listAnswers()).toEqual([]);
  return { paused, pilotRaw: (await guest.getMeta(PILOT_META_KEY))! };
}

const shown = () => ({
  signedIn: account?.signedIn,
  connected: account?.connected,
  label: account?.panel.account?.label ?? null,
  busy: account?.panel.busy ?? null,
  dataset: app?.dataset,
});

const accountBlob = () => JSON.parse(device.getItem(ACCOUNT_KEY) ?? 'null') as { meta: Record<string, string>; answers: unknown[]; learner: Learner | null } | null;

beforeEach(() => {
  device = memoryKv();
  account = null;
  app = null;
  view = null;
});

it("pilot-only guest progress is offered without an answer count, copied only after the consent tick, and resumed in the account at the same feedback", async () => {
  try {
    const today = localDate(Date.now());
    const { paused, pilotRaw } = await pausedGuest(today);
    const guestBytes = device.getItem(GUEST_KEY);

    for (const key of BUILD_KEYS) {
      const value = PRODUCTION_BUILD[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const fake = fakeAccountApi([A]);
    const net = productionNetwork(fake.fetch as unknown as typeof globalThis.fetch);
    globalThis.fetch = net.fetch;
    view = await render(
      <AppProvider storeFactory={openGuest}>
        <AccountProvider openDataset={openAccountDataset}>
          <PanelProbe />
        </AccountProvider>
      </AppProvider>
    );
    await waitFor(() => expect(app?.ready).toBe(true));
    expect(app?.learner?.learner_id).toBe(LEARNER_ID);

    await act(async () => {
      account?.panel.onSubmit({ mode: 'signin', email: A.email, password: A.password });
    });
    await waitFor(() => expect({ ...shown(), error: account?.panel.error ?? null }).toEqual({ signedIn: true, connected: false, label: A.email, busy: null, dataset: 'guest', error: null }), SOON);

    // Offered for the pilot progress itself: no guest answer exists, and none is claimed.
    await waitFor(() => expect(view?.queryByTestId('guest-copy')).not.toBeNull(), SOON);
    expect(account?.panel.guestCopy).toMatchObject({ answers: 0, pilotProgress: true });
    const section = view!.getByTestId('guest-copy');
    expect(within(section).queryAllByText(/[1-9]\d* jawaban/)).toEqual([]);

    // Not copied before the existing consent tick.
    expect(view!.getByTestId('guest-copy-confirm')).toBeDisabled();
    await fireEvent.press(view!.getByTestId('guest-copy-confirm'));
    expect(account?.panel.busy ?? null).toBeNull();
    expect(account?.panel.guestCopy?.result ?? null).toBeNull();
    expect(accountBlob()?.meta?.[PILOT_META_KEY]).toBeUndefined();

    await fireEvent.press(view!.getByTestId('guest-copy-consent'));
    expect(view!.getByTestId('guest-copy-confirm')).not.toBeDisabled();
    await fireEvent.press(view!.getByTestId('guest-copy-confirm'));
    await waitFor(() => {
      expect(account?.panel.busy ?? null).toBeNull();
      expect(typeof account?.panel.guestCopy?.result).toBe('string');
    }, SOON);
    // A truthful status: progress was copied; never "nothing to copy", never an answer count.
    const result = account?.panel.guestCopy?.result ?? '';
    expect(result).not.toMatch(/tidak ada/i);
    expect(result).not.toMatch(/[1-9]\d* jawaban/);
    expect(view!.getByTestId('guest-copy-result')).toBeTruthy();
    expect(account?.panel.error ?? null).toBeNull();

    // The account holds the exact guest document archived and its owner-only adoption.
    const copied = accountBlob()!;
    expect(copied.meta[`${PILOT_GUEST_ARCHIVE_PREFIX}${sha256Hex(pilotRaw)}`]).toBe(pilotRaw);
    expect(JSON.parse(copied.meta[PILOT_META_KEY]!)).toEqual({ ...JSON.parse(pilotRaw), owner: `account:${LEARNER_ID}` });

    await act(async () => {
      account?.panel.onCreateProfile({ adult: true, agreed: true });
    });
    await waitFor(() => {
      expect(shown()).toEqual({ signedIn: true, connected: true, label: A.email, busy: null, dataset: 'account' });
      expect(app?.datasetActive?.()).toBe(true);
    }, SOON);

    // The account's learner is the guest's, and its own controller resumes the same feedback and presentation.
    expect(app?.learner?.learner_id).toBe(LEARNER_ID);
    expect(accountBlob()?.learner?.learner_id).toBe(LEARNER_ID);
    const accountStore = app!.store!;
    const resumed = pilotController(accountStore, `account:${LEARNER_ID}`, today, app!.datasetActive!);
    let resumedView: PilotView | null = null;
    await act(async () => {
      resumedView = await resumed.load();
    });
    resumed.dispose();
    expect(resumedView).toEqual(paused);

    // No historical answer was written anywhere, and the guest dataset is exactly as it was.
    expect(await accountStore.listAnswers()).toEqual([]);
    expect(accountBlob()?.answers).toEqual([]);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
  } finally {
    try {
      await view?.unmount();
    } finally {
      globalThis.fetch = realFetch;
      for (const [key, value] of BASELINE) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
});
