import { act, screen, waitFor } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import NextLessonRoute from '@/app/next-lesson';
import { accountNamespace, openKvDataset } from '@/account/datasets';
import { qualifyUnitA } from '@/pilot/nextLesson/__fixtures__/helpers';
import { NEXT_LESSON_META_KEY } from '@/pilot/nextLesson/controller';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { AppProvider, useApp } from '@/ui/AppContext';

jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    throw new Error('storeFactory supplied');
  },
}));

// Local noon, so the route's localDate(Date.now()) is Jan 3 then Jan 4 in any time zone.
const JAN3 = new Date(2026, 0, 3, 12).getTime();
const JAN4 = new Date(2026, 0, 4, 12).getTime();
const ACCOUNT = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';

const guestLearner: Learner = {
  learner_id: 'route-binding-guest',
  created_at: '2026-01-01T00:00:00Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
};
const accountLearner: Learner = { ...guestLearner, learner_id: 'route-binding-account' };

// This tab owns the guest writer lock; another tab holds the account's, so it opens read-only.
const locksOwned: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };
const locksBusy: LockManagerLike = {
  request: (_name, options, callback) => (options.ifAvailable ? Promise.resolve(callback(null)) : new Promise(() => {})),
};

let app: ReturnType<typeof useApp> | null = null;
let guestOpen: Awaited<ReturnType<typeof openKvDataset>>;
const openGuest = async () => guestOpen;

function Probe() {
  const current = useApp();
  useEffect(() => {
    app = current;
  }, [current]);
  return null;
}
function Layout() {
  return (
    <SafeAreaProvider>
      <AppProvider storeFactory={openGuest}>
        <Probe />
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      </AppProvider>
    </SafeAreaProvider>
  );
}
const Home = () => <Text>Home</Text>;
const settle = () =>
  act(async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  });
const helpDays = (raw: string): unknown => JSON.parse(JSON.parse(raw).meta[NEXT_LESSON_META_KEY]).helpDays;

// This scenario runs in the foreground; Jest's AppState starts non-active, so say so explicitly.
const appState = AppState as { currentState: typeof AppState.currentState | null };
let savedAppState: typeof appState.currentState;
beforeEach(() => {
  savedAppState = appState.currentState;
  appState.currentState = 'active';
});
afterEach(() => {
  appState.currentState = savedAppState;
});

it('leaves the old guest untouched when a day change switches the mounted route to a read-only account', async () => {
  const savedMode = process.env.EXPO_PUBLIC_APP_MODE;
  process.env.EXPO_PUBLIC_APP_MODE = 'developer-demo';
  jest.useFakeTimers({
    now: JAN3,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  const inner = memoryKv();
  const writes: { key: string; value: string }[] = [];
  const kv: KvBackend = {
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => {
      writes.push({ key, value });
      inner.setItem(key, value);
    },
    removeItem: (key) => inner.removeItem(key),
  };
  let accountOpen: Awaited<ReturnType<typeof openKvDataset>> | null = null;
  let rendered: { unmount: () => void } | null = null;
  try {
    guestOpen = await openKvDataset({
      kv,
      locks: locksOwned,
      namespace: { kvKey: KvStore.KEY, writerLock: 'arabic-trial-app/writer', sqliteFile: 'arabic-trial.db' },
    });
    expect(guestOpen.access).toBe('owner');
    const guestStore = guestOpen.store as KvStore;
    await guestStore.saveLearner(guestLearner);
    // Real Unit A controller: lessons and practice on Jan 1, transfer on Jan 2.
    await qualifyUnitA(guestStore, `guest:${guestLearner.learner_id}`, { day: '2026-01-01' });

    const ns = accountNamespace(ACCOUNT);
    kv.setItem(ns.kvKey, JSON.stringify({ schema: 2, meta: {}, learner: accountLearner, answers: [], snapshot: null, reports: [] }));
    accountOpen = await openKvDataset({ kv, locks: locksBusy, namespace: ns });
    expect(accountOpen.access).toBe('read-only');
    const accountSeeded = kv.getItem(ns.kvKey);
    await expect(accountOpen.store.saveLearner(accountLearner)).rejects.toThrow(/read-only/);
    expect(kv.getItem(ns.kvKey)).toBe(accountSeeded);

    rendered = await renderRouter({ _layout: Layout, index: Home, 'next-lesson': NextLessonRoute }, { initialUrl: '/next-lesson' });
    await screen.findByTestId('next-lesson-screen', {}, { timeout: 10000 });
    await settle();
    expect(app?.dataset).toBe('guest');
    expect(app?.store).toBe(guestStore);

    // First teaching view shown for the guest on Jan 3.
    const guestBefore = kv.getItem(KvStore.KEY)!;
    expect(helpDays(guestBefore)).toEqual(['2026-01-03']);
    const accountBefore = kv.getItem(ns.kvKey);
    const writesBefore = writes.length;

    jest.setSystemTime(JAN4);
    const account = accountOpen;
    await act(async () => {
      await app!.selectDataset({ store: account.store, readOnly: account.reason ?? 'read-only' });
    });
    await waitFor(
      () => {
        expect(app?.dataset).toBe('account');
        expect(app?.store).toBe(account.store);
        expect(app?.readOnly).not.toBeNull();
      },
      { timeout: 5000 }
    );
    await settle();
    expect(screen.queryByTestId('next-lesson-screen')).toBeNull();

    // The guest is no longer selected: its bookkeeping (help day, shown screen) must not be written.
    const guestAfter = kv.getItem(KvStore.KEY)!;
    expect({ guestUnchanged: guestAfter === guestBefore, helpDays: helpDays(guestAfter) }).toEqual({
      guestUnchanged: true,
      helpDays: ['2026-01-03'],
    });
    expect(writes.slice(writesBefore).filter((w) => w.key === KvStore.KEY)).toHaveLength(0);
    expect(kv.getItem(ns.kvKey)).toBe(accountBefore);
    expect(screen.queryByTestId('next-lesson-screen')).toBeNull();
  } finally {
    rendered?.unmount();
    guestOpen?.release();
    accountOpen?.release();
    app = null;
    jest.useRealTimers();
    if (savedMode === undefined) delete process.env.EXPO_PUBLIC_APP_MODE;
    else process.env.EXPO_PUBLIC_APP_MODE = savedMode;
  }
}, 60000);
