// D-2 provenance (readiness review 2026-10-18), written before the fix. Creating an adult profile records the consent
// the learner gave in «Akun lokal» («Saya setuju jawaban dan pengaturan saya disimpan di profil akun lokal ini.»). That
// text differs from the guest consent («Hanya di perangkat ini; tidak dikirim ke mana pun.»), so it carries its own
// internal version: in the new server profile and in the account's new local learner. The guest consent version and
// every receipt already recorded (the guest learner, a copied guest learner) stay exactly as they are; consent texts
// and profile linking are unchanged. The real AppProvider, AccountProvider, Auth and API clients, sync journal and
// KvStore datasets run here. The only doubles are the network (the in-process fake account API and Auth emulator,
// which know one synthetic user: nothing is signed up anywhere), the device storage and the lock manager.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace } from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { AccountProvider, useAccount, type AccountContextValue } from '@/ui/AccountContext';
import { AppProvider, CONSENT_VERSION, useApp } from '@/ui/AppContext';
import { FAKE_API, FAKE_EMULATOR, fakeAccountApi, type FakeAccountApi, type FakeUser } from '../../../test/fakeAccountApi';

// The app's storage module would open the device database; the guest store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

/** Internal version of the existing account-profile consent text (identifier authorized on 2026-10-18). */
const ACCOUNT_SYNC_CONSENT = 'demo-local-account-sync-consent-0.1';
/** The guest consent version («Hanya di perangkat ini»), unchanged. */
const GUEST_CONSENT = 'demo-consent-0.1';

const ANI: FakeUser = {
  email: 'ani@ayailmu.test',
  password: 'pw-ani-local-1',
  uid: 'uid-ani',
  token: 'id-token-ani-77aa',
  accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01',
};
const GUEST_KEY = GUEST_NAMESPACE.kvKey;
const ACCOUNT_KEY = accountNamespace(ANI.accountId).kvKey;
const ACCOUNT_ENV = ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_AUTH_EMULATOR_URL', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'] as const;

const GUEST_LEARNER: Learner = {
  learner_id: 'lrn-guest-consent',
  created_at: '2026-10-15T01:00:00.000Z',
  consent_version: GUEST_CONSENT,
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
const blob = (learner: Learner, answers: AnswerRecord[]) =>
  JSON.stringify({ schema: 2, meta: {}, learner, answers, snapshot: null, reports: [] });

/** No other tab exists here: this tab gets every writer lock it asks for. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };

let device: KvBackend = memoryKv();
let fake: FakeAccountApi = fakeAccountApi([ANI]);
let account: AccountContextValue | null = null;
let app: ReturnType<typeof useApp> | null = null;
let savedEnv: [string, string | undefined][] = [];
const realFetch = globalThis.fetch;

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

async function mount() {
  await render(
    <AppProvider storeFactory={openGuest}>
      <AccountProvider openDataset={openAccountDataset}>
        <Probe />
      </AccountProvider>
    </AppProvider>
  );
  await waitFor(() => {
    expect(app?.ready).toBe(true);
    expect(account?.enabled).toBe(true);
  });
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

type ImportBody = { target: { profile_id?: string; new_profile?: { kind?: string; consent?: { version?: string; at?: string } } } };
const importsSent = (): ImportBody[] =>
  fake.sent.filter((r) => r.method === 'POST' && r.path === '/v1/imports').map((r) => JSON.parse(r.body) as ImportBody);
const storedAt = (key: string) =>
  JSON.parse(device.getItem(key) ?? 'null') as { learner: Learner | null; answers: AnswerRecord[] } | null;

beforeEach(() => {
  savedEnv = ACCOUNT_ENV.map((name): [string, string | undefined] => [name, process.env[name]]);
  process.env.EXPO_PUBLIC_API_BASE_URL = FAKE_API;
  process.env.EXPO_PUBLIC_AUTH_EMULATOR_URL = FAKE_EMULATOR;
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'demo-ayailmu';
  device = memoryKv();
  fake = fakeAccountApi([ANI]);
  globalThis.fetch = fake.fetch;
  account = null;
  app = null;
});

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = realFetch;
});

describe('account-profile consent provenance (D-2)', () => {
  it('a new adult profile without a guest copy records the account-sync consent version on the server and in its new local learner; the guest consent stays', async () => {
    device.setItem(GUEST_KEY, blob(GUEST_LEARNER, []));
    const guestBytes = device.getItem(GUEST_KEY);
    await mount();
    await signIn(ANI);
    expect(account!.panel.guestCopy ?? null).toBeNull(); // no guest answers, so nothing to copy
    await createAdultProfile();

    const imports = importsSent();
    expect(imports).toHaveLength(1);
    const consent = imports[0].target.new_profile?.consent;
    expect(consent?.version).toBe(ACCOUNT_SYNC_CONSENT);
    expect(fake.profileOf(ANI.accountId)?.consent.version).toBe(ACCOUNT_SYNC_CONSENT);

    // The account's new local learner is the local receipt of that same consent.
    const learner = storedAt(ACCOUNT_KEY)?.learner ?? null;
    expect(learner?.learner_id).not.toBe(GUEST_LEARNER.learner_id);
    expect({ version: learner?.consent_version, at: learner?.consent_at }).toEqual({ version: ACCOUNT_SYNC_CONSENT, at: consent?.at });

    // The guest consent version and the guest's recorded receipt are unchanged.
    expect(CONSENT_VERSION).toBe(GUEST_CONSENT);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
  });

  it('after an explicit guest copy the new profile still records the account-sync consent version; the copied guest receipt and the guest dataset stay as recorded', async () => {
    device.setItem(GUEST_KEY, blob(GUEST_LEARNER, [guestAnswer(1), guestAnswer(2)]));
    const guestBytes = device.getItem(GUEST_KEY);
    await mount();
    await signIn(ANI);
    expect(account!.panel.guestCopy?.answers).toBe(2);

    await act(async () => {
      account!.panel.onGuestCopy();
    });
    await waitFor(
      () => {
        expect(account?.panel.guestCopy?.result ?? null).not.toBeNull();
        expect(account?.panel.busy ?? null).toBeNull();
      },
      { timeout: 5000 }
    );
    expect((storedAt(ACCOUNT_KEY)?.answers ?? []).map((a) => a.answer_id)).toEqual(['ans-guest-1', 'ans-guest-2']);
    await createAdultProfile();

    const imports = importsSent();
    expect(imports).toHaveLength(1);
    expect(imports[0].target.new_profile?.consent?.version).toBe(ACCOUNT_SYNC_CONSENT);
    expect(fake.profileOf(ANI.accountId)?.consent.version).toBe(ACCOUNT_SYNC_CONSENT);

    // The copied learner is the guest's own record, consent receipt included: never rewritten.
    expect(storedAt(ACCOUNT_KEY)?.learner ?? null).toEqual(GUEST_LEARNER);
    expect(device.getItem(GUEST_KEY)).toBe(guestBytes);
  });
});
