// Answers-saved wrapper: the real AppProvider over real KvStores exposes useApp().answersSaved(), a wrapper bound to the
// rendered dataset that hands DatasetSelection.answersSaved the same generation guard datasetActive() uses. A newer
// selection, a sign-out or a reset fences the guard and the old wrapper at once; a read-only selection or an active()
// that is not exactly true never notifies. Neither answersSaved is typed yet, so both are reached through local casts and
// a missing API fails each case, not compilation.
import { act, render, waitFor } from '@testing-library/react-native';
import { useLayoutEffect } from 'react';

import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner, Store } from '@/storage/types';
import { AppProvider, useApp, type DatasetSelection } from '@/ui/AppContext';

type Saved = () => Promise<void>;
type App = ReturnType<typeof useApp> & { answersSaved?: Saved };
type Selection = DatasetSelection & { answersSaved?: (active: () => boolean) => Promise<void> };

const KEY = 'arabic-trial-app/account/fixture';

const learnerOf = (id: string): Learner => ({
  learner_id: id,
  created_at: '2026-10-28T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-28T01:00:00.000Z',
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

/** Records every guard the provider's wrapper hands to the selection's answersSaved. */
function recorder() {
  const guards: Array<() => boolean> = [];
  return { guards, notify: async (active: () => boolean) => void guards.push(active) };
}
const selectionOf = (store: Store, notify: Selection['answersSaved'], rest: Partial<Selection> = {}): Selection => ({
  store,
  readOnly: null,
  active: () => true,
  answersSaved: notify,
  ...rest,
});

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
function savedOf(value: App): Saved {
  const fn = value.answersSaved;
  if (typeof fn !== 'function') throw new Error('useApp().answersSaved is not implemented.');
  return fn;
}
/** Calls the wrapper at once (synchronously); a fenced wrapper may resolve or reject. */
async function settle(fn: Saved) {
  try {
    await fn();
  } catch {
    // fenced wrappers may reject
  }
}

async function mount(guest: Store) {
  await render(
    <AppProvider storeFactory={async () => guest}>
      <Probe />
    </AppProvider>
  );
  await waitFor(() => expect(app().ready && app().learner !== null).toBe(true));
}

async function selectAccount(selection: Selection) {
  await act(async () => {
    await app().selectDataset(selection);
  });
  expect(app().dataset).toBe('account');
}

beforeEach(() => {
  latest = null;
});

describe('AppProvider answersSaved', () => {
  it('passes the live guard, stays stable across a same-learner refresh, and is fenced by accountB, then by guest', async () => {
    await mount(await openStore('lrn-guest-1'));
    const a = recorder();
    const storeA = await openStore('lrn-account-a', KEY);
    await selectAccount(selectionOf(storeA, a.notify));
    const wrapperA = savedOf(app());
    expect(app().store).toBe(storeA);
    expect(app().learner?.learner_id).toBe('lrn-account-a');
    await act(async () => {
      await wrapperA();
    });
    expect(a.guards).toHaveLength(1);
    expect(a.guards[0]()).toBe(true);

    await act(async () => {
      await app().refreshLearner();
    });
    expect(app().learner?.learner_id).toBe('lrn-account-a');
    expect(savedOf(app())).toBe(wrapperA);
    expect(a.guards[0]()).toBe(true);

    const b = recorder();
    const storeB = await openStore('lrn-account-b', KEY);
    await selectAccount(selectionOf(storeB, b.notify));
    expect(a.guards[0]()).toBe(false);
    await settle(wrapperA);
    expect(a.guards).toHaveLength(1);
    expect(b.guards).toHaveLength(0);

    const wrapperB = savedOf(app());
    expect(wrapperB).not.toBe(wrapperA);
    expect(app().store).toBe(storeB);
    expect(app().learner?.learner_id).toBe('lrn-account-b');
    await act(async () => {
      await wrapperB();
    });
    expect(b.guards).toHaveLength(1);
    expect(b.guards[0]()).toBe(true);

    await act(async () => {
      await app().selectDataset(null);
    });
    expect(app().dataset).toBe('guest');
    expect(b.guards[0]()).toBe(false);
    await settle(wrapperB);
    await settle(wrapperA);
    expect([a.guards.length, b.guards.length]).toEqual([1, 1]);
  });

  it('resetAll fences the held wrapper at once and never revives it; read-only or a non-true active() never notifies', async () => {
    await mount(await openStore('lrn-guest-1'));
    const a = recorder();
    const stored = await openStore('lrn-account-a', KEY);
    await selectAccount(selectionOf(stored, a.notify));
    const wrapper = savedOf(app());
    await act(async () => {
      await wrapper();
    });
    const guard = a.guards[0];
    expect(guard()).toBe(true);

    let seen: boolean | null = null;
    await act(async () => {
      const pending = app().resetAll();
      seen = guard();
      const early = settle(wrapper);
      await pending;
      await early;
    });
    expect(seen).toBe(false);
    expect(a.guards).toHaveLength(1);
    expect(await stored.getLearner()).toBeNull();
    expect(app().learner).toBeNull();
    expect(guard()).toBe(false);
    await settle(wrapper);
    expect(a.guards).toHaveLength(1);

    const ro = recorder();
    await selectAccount(selectionOf(await openStore('lrn-account-ro', KEY), ro.notify, { readOnly: 'another tab owns this dataset' }));
    expect(app().readOnly).toBe('another tab owns this dataset');
    await settle(savedOf(app()));
    expect(ro.guards).toHaveLength(0);

    let live: () => unknown = () => true;
    const b = recorder();
    await selectAccount(selectionOf(await openStore('lrn-account-b', KEY), b.notify, { active: () => live() as boolean }));
    const wrapperB = savedOf(app());
    const bad = [() => false, () => 1, () => 'true', () => null, () => undefined, () => { throw new Error('active failed'); }];
    for (const next of bad) {
      live = next;
      await settle(wrapperB);
      expect(b.guards).toHaveLength(0);
    }
    live = () => true;
    await settle(wrapperB);
    expect(b.guards).toHaveLength(1);
  });
});
