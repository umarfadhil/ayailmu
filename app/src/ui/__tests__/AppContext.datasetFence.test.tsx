// Dataset fence: the real AppProvider over real KvStores exposes datasetActive(), a callback bound to the selected
// store, learner and generation. A newer selection, a sign-out or a reset turns every earlier callback false at once,
// before any awaited store IO resolves, and nothing turns it back. datasetActive and DatasetSelection.active are not
// typed yet, so they are reached through local casts and a missing API fails each case, not compilation.
import { act, render, waitFor } from '@testing-library/react-native';
import { useLayoutEffect } from 'react';

import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner, Store } from '@/storage/types';
import { AppProvider, useApp, type DatasetSelection } from '@/ui/AppContext';

type App = ReturnType<typeof useApp> & { datasetActive?: () => boolean };
type Selection = DatasetSelection & { active?: () => boolean };

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

/** Delegates to the real store; `method` waits for release() before it runs. */
function held(store: KvStore, method: 'getLearner' | 'reset') {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  const proxy = new Proxy(store, {
    get(target, prop) {
      if (prop === method) {
        return () => {
          calls += 1;
          return gate.then(() => (target[method] as () => Promise<unknown>).call(target));
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Store;
  return { store: proxy, release, calls: () => calls };
}

let latest: App | null = null;
function Probe() {
  const value = useApp() as App;
  useLayoutEffect(() => {
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
      <Probe />
    </AppProvider>
  );
  await waitFor(() => expect(app().ready && app().learner !== null).toBe(true));
}

/** Selects an account dataset whose getLearner resolves at once. */
async function selectAccount(selection: Selection) {
  await act(async () => {
    await app().selectDataset(selection);
  });
  expect(app().dataset).toBe('account');
}

beforeEach(() => {
  latest = null;
});

describe('AppProvider dataset fence', () => {
  it('guest starts active; selecting an account fences it before getLearner resolves; the account is active only while its callback is exactly true', async () => {
    await mount(await openStore('lrn-guest-1'));
    const guest = activeOf(app());
    expect(guest()).toBe(true);

    const account = held(await openStore('lrn-account-1', 'arabic-trial-app/account/fixture'), 'getLearner');
    let live: unknown = true;
    const selection: Selection = { store: account.store, readOnly: null, active: () => live as boolean };
    let pending: Promise<void> = Promise.resolve();
    let seen: boolean | null = null;
    await act(() => {
      pending = app().selectDataset(selection);
      seen = guest();
    });
    expect(seen).toBe(false);
    expect(account.calls()).toBe(1);
    expect(guest()).toBe(false);

    await act(async () => {
      account.release();
      await pending;
    });
    expect(app().dataset).toBe('account');
    expect(app().learner?.learner_id).toBe('lrn-account-1');
    const active = activeOf(app());
    expect(active()).toBe(true);
    for (const value of [false, 1, 'true', null, undefined]) {
      live = value;
      expect([value, active()]).toEqual([value, false]);
    }
    live = true;
    expect(active()).toBe(true);
    expect(guest()).toBe(false);
  });

  it('sign-out fences the account callback synchronously; a fresh guest callback is active after rerender, the old ones stay fenced', async () => {
    await mount(await openStore('lrn-guest-1'));
    const before = activeOf(app());
    await selectAccount({ store: await openStore('lrn-account-1', 'arabic-trial-app/account/fixture'), readOnly: null, active: () => true } as Selection);
    const account = activeOf(app());
    expect(account()).toBe(true);

    let pending: Promise<void> = Promise.resolve();
    let seen: boolean | null = null;
    await act(() => {
      pending = app().selectDataset(null);
      seen = account();
    });
    expect(seen).toBe(false);
    await act(async () => {
      await pending;
    });
    expect(app().dataset).toBe('guest');
    expect(app().learner?.learner_id).toBe('lrn-guest-1');
    expect(activeOf(app())()).toBe(true);
    expect(account()).toBe(false);
    expect(before()).toBe(false);
  });

  it('resetAll fences the account callback before the queued reset resolves and never revives it', async () => {
    await mount(await openStore('lrn-guest-1'));
    const stored = await openStore('lrn-account-1', 'arabic-trial-app/account/fixture');
    const account = held(stored, 'reset');
    await selectAccount({ store: account.store, readOnly: null, active: () => true } as Selection);
    const active = activeOf(app());
    expect(active()).toBe(true);

    let pending: Promise<void> = Promise.resolve();
    let seen: boolean | null = null;
    await act(() => {
      pending = app().resetAll();
      seen = active();
    });
    expect(seen).toBe(false);
    expect(account.calls()).toBe(1);
    expect(await stored.getLearner()).not.toBeNull();

    await act(async () => {
      account.release();
      await pending;
    });
    expect(await stored.getLearner()).toBeNull();
    expect(app().learner).toBeNull();
    expect(active()).toBe(false);
  });
});
