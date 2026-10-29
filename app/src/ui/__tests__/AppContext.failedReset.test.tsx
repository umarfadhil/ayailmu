// Failed reset, RED (regression-first): resetAll fences every earlier dataset callback before its reset is queued. When
// the store's physical write then fails, the stored learner and bytes are intact, so the real AppProvider re-reads the
// learner and, while that reset is still the latest selecting turn, publishes it under a new generation: resetAll
// rejects with the reset's own error, the earlier callback stays false and a fresh one is true. A newer selection made
// while the reset was pending wins and is never overwritten; a failed re-read keeps everything fenced. Real KvStores over
// a memory backend whose setItem fails on demand.
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
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

const ACCOUNT_KEY = 'arabic-trial-app/account/fixture';

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

/** A real KvStore with a learner, over a backend whose every setItem fails while `failing` is set. */
async function openStore(id: string, key: string = KvStore.KEY) {
  const kv = memoryKv();
  const failure = new Error('simulated physical reset failure');
  let failing = false;
  const backend: KvBackend = {
    getItem: (k) => kv.getItem(k),
    removeItem: (k) => kv.removeItem(k),
    setItem: (k, v) => {
      if (failing) throw failure;
      kv.setItem(k, v);
    },
  };
  const store = new KvStore(backend, null, key);
  await store.init();
  await store.saveLearner(learnerOf(id));
  return { store, failure, fail: () => (failing = true), bytes: () => kv.getItem(key) };
}

/** Delegates to `store`; reset waits for release(), and getLearner rejects once failLearner() was called. */
function wrapped(store: KvStore) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let learnerFails = false;
  const proxy = new Proxy(store, {
    get(target, prop) {
      if (prop === 'reset') return () => gate.then(() => target.reset());
      if (prop === 'getLearner') {
        return () => (learnerFails ? Promise.reject(new Error('simulated learner read failure')) : target.getLearner());
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Store;
  return { store: proxy, release, failLearner: () => (learnerFails = true) };
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

/** resetAll's rejection, settled inside act. */
async function failedReset(): Promise<unknown> {
  let rejection: unknown = null;
  await act(async () => {
    await app().resetAll().then(
      () => {
        rejection = 'resolved';
      },
      (e: unknown) => {
        rejection = e;
      }
    );
  });
  return rejection;
}

beforeEach(() => {
  latest = null;
});

describe('AppProvider failed reset', () => {
  it('guest: a reset whose physical write fails rejects with its own error; data intact, the earlier callback stays fenced and a fresh one is live, also after refreshLearner', async () => {
    const guest = await openStore('lrn-guest-1');
    await mount(guest.store);
    const held = activeOf(app());
    expect(held()).toBe(true);
    const bytes = guest.bytes();

    guest.fail();
    expect(await failedReset()).toBe(guest.failure);

    expect(guest.bytes()).toBe(bytes);
    expect((await guest.store.getLearner())?.learner_id).toBe('lrn-guest-1');
    expect(app().learner?.learner_id).toBe('lrn-guest-1');
    expect(app().dataset).toBe('guest');
    const fresh = activeOf(app());
    expect(fresh).not.toBe(held);
    expect(held()).toBe(false);
    expect(fresh()).toBe(true);

    await act(async () => {
      await app().refreshLearner();
    });
    expect(activeOf(app())()).toBe(true);
    expect(held()).toBe(false);
  });

  it('account: a failed physical reset republishes the intact account learner under a fresh live callback; the earlier one stays fenced', async () => {
    await mount((await openStore('lrn-guest-1')).store);
    const account = await openStore('lrn-account-1', ACCOUNT_KEY);
    await selectAccount(account.store);
    const held = activeOf(app());
    expect(held()).toBe(true);
    const bytes = account.bytes();

    account.fail();
    expect(await failedReset()).toBe(account.failure);

    expect(account.bytes()).toBe(bytes);
    expect(app().dataset).toBe('account');
    expect(app().learner?.learner_id).toBe('lrn-account-1');
    expect(held()).toBe(false);
    expect(activeOf(app())()).toBe(true);
  });

  it('a newer selection made while the reset is pending wins: the late failed reset republishes nothing over it', async () => {
    await mount((await openStore('lrn-guest-1')).store);
    const account = await openStore('lrn-account-1', ACCOUNT_KEY);
    const gated = wrapped(account.store);
    await selectAccount(gated.store);
    const held = activeOf(app());

    let rejection: unknown = null;
    let pending: Promise<void> = Promise.resolve();
    await act(() => {
      pending = app().resetAll().then(
        () => {
          rejection = 'resolved';
        },
        (e: unknown) => {
          rejection = e;
        }
      );
    });
    await act(async () => {
      await app().selectDataset(null);
    });
    expect(app().dataset).toBe('guest');
    const guestNow = activeOf(app());
    expect(guestNow()).toBe(true);

    account.fail();
    await act(async () => {
      gated.release();
      await pending;
    });
    expect(rejection).toBe(account.failure);
    expect(app().dataset).toBe('guest');
    expect(app().learner?.learner_id).toBe('lrn-guest-1');
    expect(guestNow()).toBe(true);
    expect(activeOf(app())()).toBe(true);
    expect(held()).toBe(false);
  });

  it('when the learner cannot be read again after the failed reset, it rejects with the reset error and everything stays fenced', async () => {
    await mount((await openStore('lrn-guest-1')).store);
    const account = await openStore('lrn-account-1', ACCOUNT_KEY);
    const gated = wrapped(account.store);
    gated.release();
    await selectAccount(gated.store);
    const held = activeOf(app());
    expect(held()).toBe(true);
    const bytes = account.bytes();

    account.fail();
    gated.failLearner();
    expect(await failedReset()).toBe(account.failure);

    expect(account.bytes()).toBe(bytes);
    expect(app().dataset).toBe('account');
    expect(held()).toBe(false);
    expect(activeOf(app())()).toBe(false);
  });
});
