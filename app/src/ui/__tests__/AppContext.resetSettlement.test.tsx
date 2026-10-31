// Reset settlement, RED (regression-first): a reset that succeeds after a newer selection was made while it was pending
// still wipes its own store, but publishes nothing shared over the newer selection: the newer account's learner, its
// live callback and a receipt given meanwhile stay. A guest reset still clears the guest's cached learner (the guest
// store is now empty), so returning to the guest later revives no stale learner. Real KvStores over memory backends.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner, Store } from '@/storage/types';
import { AppProvider, useApp, type DatasetSelection } from '@/ui/AppContext';

// The app's storage module would open the device database; every store comes from this test instead.
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('The guest store is supplied by this test.');
  },
}));

type App = ReturnType<typeof useApp>;

const ACCOUNT_A_KEY = 'arabic-trial-app/account/fixture-a';
const ACCOUNT_B_KEY = 'arabic-trial-app/account/fixture-b';

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

/** A real KvStore with a learner. */
async function openStore(id: string, key: string = KvStore.KEY): Promise<KvStore> {
  const store = new KvStore(memoryKv(), null, key);
  await store.init();
  await store.saveLearner(learnerOf(id));
  return store;
}

/** Delegates to `store`; reset waits for release() before it runs. */
function gatedReset(store: KvStore) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const proxy = new Proxy(store, {
    get(target, prop) {
      if (prop === 'reset') return () => gate.then(() => target.reset());
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Store;
  return { store: proxy, release };
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

async function mount(guest: Store) {
  const factory = async () => guest;
  await render(
    <AppProvider storeFactory={factory}>
      <HookProbe />
    </AppProvider>
  );
  await waitFor(() => expect(app().ready && app().learner !== null).toBe(true));
}

async function selectAccount(store: Store) {
  const selection: DatasetSelection = { store, readOnly: null, active: () => true };
  await act(async () => {
    await app().selectDataset(selection);
  });
  expect(app().dataset).toBe('account');
}

/** Starts resetAll without letting it settle; settle() releases the held reset and records how it ended. */
async function heldReset(release: () => void) {
  let outcome: unknown = null;
  let pending: Promise<void> = Promise.resolve();
  await act(() => {
    pending = app().resetAll().then(
      () => {
        outcome = 'resolved';
      },
      (e: unknown) => {
        outcome = e;
      }
    );
  });
  return async () => {
    await act(async () => {
      release();
      await pending;
    });
    return outcome;
  };
}

beforeEach(() => {
  latest = null;
});

describe('AppProvider reset settling after a newer selection', () => {
  it('account A reset succeeding after account B was selected wipes A only; B keeps its learner, live callback and receipt', async () => {
    await mount(await openStore('lrn-guest-1'));
    const accountA = await openStore('lrn-account-a', ACCOUNT_A_KEY);
    const gatedA = gatedReset(accountA);
    await selectAccount(gatedA.store);
    const heldA = activeOf(app());
    expect(heldA()).toBe(true);

    const settle = await heldReset(gatedA.release);
    expect(heldA()).toBe(false);

    const accountB = await openStore('lrn-account-b', ACCOUNT_B_KEY);
    await selectAccount(accountB);
    expect(app().learner?.learner_id).toBe('lrn-account-b');
    const liveB = activeOf(app());
    expect(liveB()).toBe(true);
    let receipt: ReturnType<App['giveConsent']> | null = null;
    await act(async () => {
      receipt = app().giveConsent({ adult: true, agreed: true });
    });
    expect(app().consentReceipt).toBe(receipt);

    expect(await settle()).toBe('resolved');

    expect(await accountA.getLearner()).toBeNull();
    expect((await accountB.getLearner())?.learner_id).toBe('lrn-account-b');
    expect(app().dataset).toBe('account');
    expect(app().store).toBe(accountB);
    expect(app().learner?.learner_id).toBe('lrn-account-b');
    expect(app().consentReceipt).toBe(receipt);
    expect(liveB()).toBe(true);
    expect(activeOf(app())()).toBe(true);
    expect(heldA()).toBe(false);
  });

  it('guest reset succeeding after account B was selected keeps B, and returning to the guest revives no stale learner', async () => {
    const guest = await openStore('lrn-guest-1');
    const gatedGuest = gatedReset(guest);
    await mount(gatedGuest.store);
    const heldGuest = activeOf(app());
    expect(heldGuest()).toBe(true);

    const settle = await heldReset(gatedGuest.release);
    expect(heldGuest()).toBe(false);

    const accountB = await openStore('lrn-account-b', ACCOUNT_B_KEY);
    await selectAccount(accountB);
    const liveB = activeOf(app());
    expect(liveB()).toBe(true);

    expect(await settle()).toBe('resolved');

    expect(await guest.getLearner()).toBeNull();
    expect((await accountB.getLearner())?.learner_id).toBe('lrn-account-b');
    expect(app().dataset).toBe('account');
    expect(app().learner?.learner_id).toBe('lrn-account-b');
    expect(liveB()).toBe(true);
    expect(activeOf(app())()).toBe(true);
    expect(heldGuest()).toBe(false);

    await act(async () => {
      await app().selectDataset(null);
    });
    expect(app().dataset).toBe('guest');
    expect(app().learner).toBeNull();
    expect(await guest.getLearner()).toBeNull();
    expect(liveB()).toBe(false);
    expect(heldGuest()).toBe(false);
  });
});
