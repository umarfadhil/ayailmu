// Learner fence, RED (regression-first): the real AppProvider over real KvStores binds datasetActive() to its learner
// too. When refreshLearner() replaces the dataset's learner with another one, the callback held for the earlier learner
// turns false while the fresh one is true; a later preference-only updateLearner() for the same learner keeps the
// current callback live. Covered for the guest's dataset and for a selected account dataset (a fixture selection whose
// active() is true; its savePreferences writes straight to the store, standing in for the journal).
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';
import { AppProvider, useApp, type DatasetSelection } from '@/ui/AppContext';

// The app's storage module would open the device database; every store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

type App = ReturnType<typeof useApp>;

const learnerOf = (id: string): Learner => ({
  learner_id: id,
  created_at: '2026-10-27T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-27T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
});

async function openStore(id: string, key?: string): Promise<KvStore> {
  const store = new KvStore(memoryKv(), null, key);
  await store.init();
  await store.saveLearner(learnerOf(id));
  return store;
}

let latest: App | null = null;
function HookProbe() {
  const value = useApp();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const app = (): App => {
  if (latest === null) throw new Error('AppProvider has not rendered');
  return latest;
};
function activeOf(value: App): () => boolean {
  const fn = value.datasetActive;
  if (typeof fn !== 'function') throw new Error('useApp().datasetActive is not implemented.');
  return fn;
}

async function mount(guest: KvStore) {
  const factory = async () => guest;
  await render(
    <AppProvider storeFactory={factory}>
      <HookProbe />
    </AppProvider>
  );
  await waitFor(() => expect(app().ready && app().learner !== null).toBe(true));
}

/** Another learner is saved straight to `store`, then the app re-reads it. */
async function replaceLearner(store: KvStore, id: string) {
  await store.saveLearner(learnerOf(id));
  await act(async () => {
    await app().refreshLearner();
  });
}

async function setArabicScale(scale: number) {
  await act(async () => {
    await app().updateLearner({ arabic_scale: scale });
  });
}

beforeEach(() => {
  latest = null;
});

describe('AppProvider learner fence', () => {
  it("guest: replacing learner A by B through refreshLearner fences A's callback; B's fresh callback stays live through a preference-only update", async () => {
    const guest = await openStore('lrn-guest-A');
    await mount(guest);
    const held = activeOf(app());
    const heldBefore = held();

    await replaceLearner(guest, 'lrn-guest-B');
    const learnerAfterRefresh = app().learner?.learner_id;
    const current = activeOf(app());
    const heldAfterRefresh = held();
    const currentAfterRefresh = current();

    await setArabicScale(1.5);
    const learnerAfterUpdate = app().learner;

    expect(heldBefore).toBe(true);
    expect(learnerAfterRefresh).toBe('lrn-guest-B');
    expect(current).not.toBe(held);
    expect(heldAfterRefresh).toBe(false);
    expect(currentAfterRefresh).toBe(true);
    expect([learnerAfterUpdate?.learner_id, learnerAfterUpdate?.arabic_scale]).toEqual(['lrn-guest-B', 1.5]);
    expect(app().dataset).toBe('guest');
    expect(current()).toBe(true);
    expect(activeOf(app())()).toBe(true);
    expect(held()).toBe(false);
  });

  it("account: replacing learner A by B through refreshLearner fences A's callback; B's fresh callback stays live through a preference-only update", async () => {
    await mount(await openStore('lrn-guest-1'));
    const stored = await openStore('lrn-account-A', 'arabic-trial-app/account/fixture');
    const selection: DatasetSelection = {
      store: stored,
      readOnly: null,
      active: () => true,
      savePreferences: async (patch) => {
        const learner = await stored.getLearner();
        if (learner) await stored.saveLearner({ ...learner, ...patch });
      },
    };
    await act(async () => {
      await app().selectDataset(selection);
    });
    const selected = { dataset: app().dataset, learner: app().learner?.learner_id };
    const held = activeOf(app());
    const heldBefore = held();

    await replaceLearner(stored, 'lrn-account-B');
    const learnerAfterRefresh = app().learner?.learner_id;
    const current = activeOf(app());
    const heldAfterRefresh = held();
    const currentAfterRefresh = current();

    await setArabicScale(1.5);
    const learnerAfterUpdate = app().learner;

    expect(selected).toEqual({ dataset: 'account', learner: 'lrn-account-A' });
    expect(heldBefore).toBe(true);
    expect(learnerAfterRefresh).toBe('lrn-account-B');
    expect(current).not.toBe(held);
    expect(heldAfterRefresh).toBe(false);
    expect(currentAfterRefresh).toBe(true);
    expect([learnerAfterUpdate?.learner_id, learnerAfterUpdate?.arabic_scale]).toEqual(['lrn-account-B', 1.5]);
    expect((await stored.getLearner())?.arabic_scale).toBe(1.5);
    expect(app().dataset).toBe('account');
    expect(current()).toBe(true);
    expect(activeOf(app())()).toBe(true);
    expect(held()).toBe(false);
  });
});
