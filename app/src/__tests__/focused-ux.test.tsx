import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import RootLayout from '@/app/_layout';
import Consent from '@/app/consent';
import Guide from '@/app/guide';
import Home from '@/app/index';
import Progress from '@/app/progress';
import Session from '@/app/session';
import Settings from '@/app/settings';
import Setup from '@/app/setup';
import Summary from '@/app/summary';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';

let mockKv: KvBackend = memoryKv();
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    const { KvStore: Store } = jest.requireActual('@/storage/kvStore');
    const store = new Store(mockKv);
    await store.init();
    return store;
  },
}));
const routes = { _layout: RootLayout, index: Home, consent: Consent, setup: Setup, guide: Guide, progress: Progress, session: Session, settings: Settings, summary: Summary };
const learner: Learner = {
  learner_id: 'focused-ux', created_at: '2026-01-01T00:00:00.000Z', consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: [],
};
const stored = () => JSON.parse(mockKv.getItem(KvStore.KEY)!);
beforeEach(() => {
  mockKv = memoryKv();
  delete process.env.EXPO_PUBLIC_APP_MODE;
  mockKv.setItem(KvStore.KEY, JSON.stringify({ schema: 2, meta: {}, learner, answers: [], snapshot: null, reports: [] }));
});

// Compatibility update (Calm Paper port): the repeated lesson outline left Home for Panduan, where each view is
// dated; Home keeps one session action. Looking at Home (and its draft explanation) still changes nothing.
it('Home shows one session action and no lesson outline, and looking at it changes no progress', async () => {
  await renderRouter(routes, { initialUrl: '/' });
  await screen.findByTestId('start-session');
  const before = mockKv.getItem(KvStore.KEY);
  expect(screen.queryByTestId('home-topics')).toBeNull();
  expect(screen.queryByTestId('outline-DEMO-S1')).toBeNull();
  expect(screen.queryByText(/هُوَ dan هِيَ/)).toBeNull();
  expect(screen.getAllByRole('button', { name: /Mulai sesi|Lanjutkan sesi|Lihat ringkasan/ })).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('draft-chip'));
  expect(screen.getByTestId('draft-sheet')).toBeTruthy();
  expect(mockKv.getItem(KvStore.KEY)).toBe(before);
});

it('Guide opens on the lesson; the topic picker is optional and preserves the existing view-only contract', async () => {
  await renderRouter(routes, { initialUrl: '/guide' });
  await screen.findByTestId('lesson-title');
  expect(screen.queryByTestId('guide-DEMO-S2')).toBeNull();
  expect(screen.queryByTestId('guide-about-body')).toBeNull();
  await fireEvent.press(screen.getByTestId('guide-topics'));
  await fireEvent.press(screen.getByTestId('guide-DEMO-S2'));
  await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('هُوَ dan هِيَ'));
  expect(screen.queryByTestId('guide-DEMO-S2')).toBeNull();
  expect(stored().learner.screens_seen).toEqual([]);
  expect(stored().answers).toEqual([]);
  expect(stored().snapshot).toBeNull();
  expect(JSON.parse(stored().meta.screen_views).map((v: { screen_id: string }) => v.screen_id)).toEqual(['DEMO-S1', 'DEMO-S2']);
  await fireEvent.press(screen.getByTestId('guide-about'));
  expect(screen.getByTestId('guide-about-body')).toHaveTextContent(/cek.*ditunda|ditunda.*cek/i);
});

// Compatibility update (Calm Paper port): the assessment caveats are part of the page again (the reviewed
// direction); only the per-skill counts («Rincian latihan») open on demand, and opening them writes nothing.
it('Progress shows the unchanged assessment caveats at once and opens the practice counts on demand', async () => {
  await renderRouter(routes, { initialUrl: '/progress' });
  await screen.findByTestId('progress-overview');
  expect(screen.getByTestId('line-learned-A')).toHaveTextContent(/Belum dinilai/);
  expect(screen.getByTestId('line-transfer-A')).toHaveTextContent(/Belum dinilai/);
  expect(screen.getByTestId('check-d7-A')).toBeTruthy();
  expect(screen.getByTestId('word-list')).toBeTruthy();
  expect(screen.queryByTestId('progress-attempts')).toBeNull();
  const before = mockKv.getItem(KvStore.KEY);
  expect(screen.getByTestId('progress-skills').props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(screen.getByTestId('progress-skills'));
  expect(screen.getByTestId('progress-skills').props.accessibilityState.expanded).toBe(true);
  expect(screen.getByTestId('progress-attempts')).toHaveTextContent('0');
  expect(mockKv.getItem(KvStore.KEY)).toBe(before);
});
