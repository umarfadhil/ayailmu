import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord } from '@/storage/types';
import { AppProvider, useApp } from '@/ui/AppContext';

import RootLayout from '@/app/_layout';
import Consent from '@/app/consent';
import Dev from '@/app/dev';
import Guide from '@/app/guide';
import Home from '@/app/index';
import SessionScreen from '@/app/session';
import Settings from '@/app/settings';
import Setup from '@/app/setup';
import Summary from '@/app/summary';

let mockKv: KvBackend = memoryKv();
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    const { KvStore: Store } = jest.requireActual('@/storage/kvStore');
    const s = new Store(mockKv);
    await s.init();
    return s;
  },
}));

const routes = {
  _layout: RootLayout,
  index: Home,
  consent: Consent,
  setup: Setup,
  session: SessionScreen,
  summary: Summary,
  settings: Settings,
  dev: Dev,
  guide: Guide,
};

// RNTL v14: render and events are async.
const start = (initialUrl = '/') => renderRouter(routes, { initialUrl }) as unknown as Promise<{ unmount: () => Promise<void> }>;
const press = async (id: string) => {
  await fireEvent.press(screen.getByTestId(id));
};
const tap = async (id: string) => {
  await waitFor(() => expect(screen.getByTestId(id)).toBeEnabled());
  await press(id);
};
const storedAnswers = (): AnswerRecord[] => JSON.parse(mockKv.getItem(KvStore.KEY) ?? '{"answers":[]}').answers;
const storedSnapshot = () => JSON.parse(JSON.parse(mockKv.getItem(KvStore.KEY)!).snapshot);
const arabicShown = async (text: string) =>
  waitFor(() => expect(screen.getByTestId('item-arabic')).toHaveTextContent(text));
const targetShown = async (text: string) => waitFor(() => expect(screen.getByTestId('item-target')).toHaveTextContent(`«${text}»`));
/** Rendered answer tiles, top to bottom: exactly four, no typing field. */
const tileIds = () => screen.getAllByTestId(/^option-/).map((t) => String(t.props.testID).replace('option-', ''));
const expectFourTiles = () => {
  expect(tileIds()).toHaveLength(4);
  expect(screen.queryByTestId('answer-input')).toBeNull();
};

beforeEach(() => {
  mockKv = memoryKv();
  delete process.env.EXPO_PUBLIC_APP_MODE;
});

describe('developer-demo flow (four-choice)', () => {
  it('consent → lesson → four-choice practice with feedback and fresh retry → restart/resume in the same order → summary', async () => {
    const first = await start();

    // Banner and consent; no data before consent
    expect(await screen.findByText(/Konten contoh · belum ditinjau/)).toBeTruthy();
    expect(screen.getByText(/Prototipe pengembang/)).toBeTruthy();
    await screen.findByText('Persetujuan (versi demo)');
    expect(mockKv.getItem(KvStore.KEY)).toBeNull();
    expect(screen.getByTestId('consent-continue')).toBeDisabled();
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');

    await screen.findByText(/Berapa lama/);
    await press('minutes-10');
    await tap('setup-continue');
    await tap('start-session');

    // Guided lesson screens with vowelled Arabic
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await tap('next');
    await screen.findByText('dia (laki-laki)');
    await tap('next');
    await screen.findByText('هُوَ صَادِقٌ');
    await tap('next');

    // Word meaning: four choices, key = orang yang jujur
    await arabicShown('صَادِقٌ');
    expectFourTiles();
    expect(screen.getByTestId('option-k')).toHaveTextContent('orang yang jujur');
    await tap('option-k');
    await screen.findByText('Benar');
    await tap('next');

    // Form grid: wrong ending → FA-FORM → fresh REMED form item
    await targetShown('Dia (perempuan) orang yang menyesal');
    expectFourTiles();
    await tap('option-e'); // هِيَ نَادِمٌ
    await screen.findByText(/pakai bentuk dengan/);
    expect(screen.getByText(/soal baru untuk latihan ulang/)).toBeTruthy();
    await tap('next');
    await targetShown('Dia (perempuan) orang yang takut');
    await tap('option-k');
    await screen.findByText('Benar');
    await tap('next');

    // Interpretation: he/she swap → serious → focused question → fresh REMED sentence
    await arabicShown('هِيَ مُؤْمِنَةٌ');
    expectFourTiles();
    await tap('option-r'); // Dia (laki-laki) orang yang beriman
    await screen.findByText(/هِيَ menunjuk perempuan/);
    await tap('next');
    await screen.findByText(/Perhatikan kata pertama/);
    expectFourTiles();
    expect(screen.queryByTestId('dont-know')).toBeNull(); // focus question: no «belum tahu»
    await tap('option-k');
    await tap('next');
    await arabicShown('هِيَ عَابِدَةٌ');

    const before = storedAnswers();
    expect(before.map((a) => [a.item_id, a.outcome])).toEqual([
      ['A2-M01', 'correct'],
      ['A2-F01', 'wrong'],
      ['A2-F03', 'correct'],
      ['A2-P01', 'wrong'],
      ['A2-FQ-REF-F', 'correct'],
    ]);
    expect(before[3]).toMatchObject({ serious_tag: 'wrong-referent', evidence_mode: 'recognition-4', selected_option_id: 'r', synthetic: true });
    expect(before[3].raw_response).toBe(JSON.stringify({ kind: 'choice', option_id: 'r' }));
    expect(before[3].presented_options).toHaveLength(4);

    // Simulated restart: same question, same saved option order
    const savedOrder = storedSnapshot().queue[storedSnapshot().index].option_order;
    const shownOrder = tileIds();
    expect(shownOrder).toEqual(savedOrder);
    await first.unmount();
    await start();
    await screen.findByText('Lanjutkan sesi');
    await tap('start-session');
    await arabicShown('هِيَ عَابِدَةٌ');
    expect(tileIds()).toEqual(savedOrder);
    expect(storedAnswers()).toHaveLength(5);

    await tap('option-k');
    await screen.findByText('Benar');
    await tap('next');

    // Finish the rest with «Saya belum tahu»
    for (let i = 0; i < 10 && !screen.queryByText('Sesi selesai'); i++) {
      await waitFor(() => expect(screen.queryByTestId('dont-know') ?? screen.queryByText('Sesi selesai')).toBeTruthy());
      if (screen.queryByText('Sesi selesai')) break;
      expectFourTiles();
      await tap('dont-know');
      await tap('next');
    }
    await screen.findByText('Sesi selesai');
    expect(screen.getByTestId('summary-counts')).toHaveTextContent(
      /Anda menjawab 10 soal: 4 benar, 2 belum tepat, 0 disimpan untuk diperiksa, 4 «belum tahu»/
    );
    expect(screen.queryByText(/sudah dipelajari|streak|%/i)).toBeNull();
    expect(storedAnswers()).toHaveLength(10);
  }, 30000);

  it('a rapid double tap on a tile produces exactly one answer event', async () => {
    await start();
    await screen.findByTestId('consent-adult');
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');
    await tap('setup-continue');
    await tap('start-session');
    for (let i = 0; i < 3; i++) await tap('next');
    await arabicShown('صَادِقٌ');
    // (Concurrent submits are covered in controller.test.ts; here: a second tap right after the first.)
    await fireEvent.press(screen.getByTestId('option-k'));
    await fireEvent.press(screen.getByTestId('option-k'));
    await fireEvent.press(screen.getByTestId('option-d1'));
    await screen.findByText('Benar');
    expect(storedAnswers()).toHaveLength(1);
    expect(storedAnswers()[0].selected_option_id).toBe('k');
  }, 30000);

  it('does not repeat lesson screens or answered items in the next session', async () => {
    const first = await start();
    await screen.findByTestId('consent-adult');
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');
    await tap('setup-continue');
    await tap('start-session');
    for (let i = 0; i < 3; i++) await tap('next');
    await arabicShown('صَادِقٌ');
    await tap('option-k');
    await tap('next');

    await first.unmount();
    // Drop the snapshot so the next start is a new session
    const blob = JSON.parse(mockKv.getItem(KvStore.KEY)!);
    blob.snapshot = null;
    mockKv.setItem(KvStore.KEY, JSON.stringify(blob));

    await start();
    await tap('start-session');
    await targetShown('Dia (perempuan) orang yang menyesal');
    expect(screen.queryByTestId('lesson-title')).toBeNull();
  }, 30000);
});

describe('consent guard (regression from rendered QA)', () => {
  it('a fresh direct /setup URL returns to consent and creates no learner or data', async () => {
    await start('/setup');
    await screen.findByText('Persetujuan (versi demo)');
    expect(screen.queryByTestId('setup-continue')).toBeNull();
    expect(mockKv.getItem(KvStore.KEY)).toBeNull();
  });

  it('createLearner rejects without an affirmative consent receipt', async () => {
    let api: ReturnType<typeof useApp> | null = null;
    function Probe() {
      api = useApp();
      return null;
    }
    await render(
      <AppProvider storeFactory={async () => {
        const st = new KvStore(mockKv);
        await st.init();
        return st;
      }}>
        <Probe />
      </AppProvider>
    );
    await waitFor(() => expect(api?.ready).toBe(true));
    await expect(api!.createLearner(10)).rejects.toThrow(/consent/i);
    expect(() => api!.giveConsent({ adult: true, agreed: false })).toThrow(/consent/i);
    expect(() => api!.giveConsent({ adult: false, agreed: true })).toThrow(/consent/i);
    expect(mockKv.getItem(KvStore.KEY)).toBeNull();
  });
});

describe('tester mode', () => {
  it('shows the explicit empty state and no draft content when nothing is approved', async () => {
    process.env.EXPO_PUBLIC_APP_MODE = 'tester';
    await start('/');
    expect(await screen.findByText('Belum ada materi yang disetujui untuk uji coba')).toBeTruthy();
    expect(screen.getByText(/Prototipe · mode penguji/)).toBeTruthy();
    expect(screen.queryByTestId('menu-open')).toBeNull();
    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(screen.queryByText('Persetujuan (versi demo)')).toBeNull();
    expect(screen.queryByTestId('start-session')).toBeNull();
    expect(screen.queryByTestId('open-dev')).toBeNull();
  });

  it('cannot reach a session by URL in tester mode', async () => {
    process.env.EXPO_PUBLIC_APP_MODE = 'tester';
    await start('/session');
    expect(await screen.findByText('Belum ada materi yang disetujui untuk uji coba')).toBeTruthy();
    expect(screen.queryByTestId('item-arabic')).toBeNull();
  });
});

describe('navigation (redesign)', () => {
  const blob = () => JSON.parse(mockKv.getItem(KvStore.KEY) ?? 'null');

  async function onboard() {
    await start();
    await screen.findByTestId('consent-adult');
    // No learner navigation before consent/setup
    expect(screen.queryByTestId('menu-open')).toBeNull();
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');
    await screen.findByText(/Berapa lama/);
    expect(screen.queryByTestId('menu-open')).toBeNull();
    await tap('setup-continue');
    await screen.findByTestId('start-session');
  }

  async function openMenuAndChoose(key: string) {
    await tap('menu-open');
    await screen.findByTestId('drawer');
    await press(`nav-${key}`);
    await waitFor(() => expect(screen.queryByTestId('drawer')).toBeNull());
  }

  it('drawer lists only approved routes, marks the active one and closes on route choice', async () => {
    await onboard();
    await tap('menu-open');
    await screen.findByTestId('drawer');
    for (const key of ['home', 'guide', 'practice', 'summary', 'settings', 'dev']) {
      expect(screen.getByTestId(`nav-${key}`)).toBeTruthy();
    }
    expect(screen.getByTestId('nav-home')).toBeSelected();
    expect(screen.getByTestId('nav-guide')).not.toBeSelected();
    for (const banned of [/Pro\b/, /Store/, /Leaderboard/, /Quran/, /Messages/, /Social/]) {
      expect(screen.queryByText(banned)).toBeNull();
    }
    await press('menu-close');
    await waitFor(() => expect(screen.queryByTestId('drawer')).toBeNull());

    await openMenuAndChoose('settings');
    await screen.findByTestId('learner-id');
  }, 30000);

  it('browsing the guide is read-only: no seen screens, no snapshot, no answers', async () => {
    await onboard();
    const before = blob();
    expect(before.snapshot).toBeNull();
    expect(before.learner.screens_seen).toEqual([]);

    await openMenuAndChoose('guide');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await tap('guide-next');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('هُوَ dan هِيَ'));
    await tap('guide-next');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Kalimat dan bentuk yang cocok'));

    expect(blob()).toEqual(before);

    // Practice from the guide starts the canonical session, which still shows the lesson screens first
    await tap('guide-practice');
    await waitFor(() => expect(screen.getByTestId('lesson-panel')).toHaveTextContent(/Pelajaran 1 dari 3/));
    await waitFor(() => expect(blob().snapshot).not.toBeNull());
    const snap = JSON.parse(blob().snapshot);
    expect(snap.queue.slice(0, 3).map((q: { screen_id?: string }) => q.screen_id)).toEqual(['DEMO-S1', 'DEMO-S2', 'DEMO-S3']);
    expect(snap.index).toBe(0);
  }, 30000);

  it('Ringkasan before any session shows an honest empty state', async () => {
    await onboard();
    await openMenuAndChoose('summary');
    expect(await screen.findByText('Belum ada sesi')).toBeTruthy();
    expect(screen.queryByText('Sesi selesai')).toBeNull();
  }, 30000);

  it('Ringkasan during an unfinished session is labelled interim, keeps saved state and resumes', async () => {
    await onboard();
    await tap('start-session');
    for (let i = 0; i < 3; i++) await tap('next');
    await arabicShown('صَادِقٌ');
    await tap('option-k');
    await screen.findByText('Benar');
    const savedBefore = blob();

    await openMenuAndChoose('summary');
    await waitFor(() => expect(screen.getByTestId('summary-title')).toHaveTextContent('Sesi belum selesai'));
    expect(screen.queryByText('Sesi selesai')).toBeNull();
    expect(screen.getByTestId('summary-interim')).toBeTruthy();
    expect(screen.getByTestId('summary-counts')).toHaveTextContent(/Anda menjawab 1 soal: 1 benar, 0 belum tepat/);
    expect(screen.queryByTestId('summary-next')).toBeNull();
    // Visiting the summary does not change saved state
    expect(blob()).toEqual(savedBefore);

    await tap('summary-resume');
    // Back on the same session, at the same feedback step
    await waitFor(() => expect(screen.getByTestId('feedback-message')).toHaveTextContent(/jujur/));
    await tap('next');
    await targetShown('Dia (perempuan) orang yang menyesal');
    expect(storedAnswers()).toHaveLength(1);
  }, 30000);
});

describe('responsive shell (regression from browser QA)', () => {
  const setWidth = async (width: number) => {
    const { Dimensions } = jest.requireActual('react-native');
    const height = width < 1024 ? 844 : 900;
    await act(async () => {
      Dimensions.set({
        window: { width, height, scale: 2, fontScale: 1 },
        screen: { width, height, scale: 2, fontScale: 1 },
      });
    });
  };
  afterEach(async () => {
    await setWidth(750);
  });

  it('crossing the desktop breakpoint keeps the question, its saved order, and an unsent report draft', async () => {
    await setWidth(390);
    await start();
    await screen.findByTestId('consent-adult');
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');
    await tap('setup-continue');
    await tap('start-session');
    for (let i = 0; i < 3; i++) await tap('next');
    await arabicShown('صَادِقٌ');
    const order = tileIds();
    expect(screen.queryByTestId('sidebar')).toBeNull();

    // An unsent report draft (selected reason + typed note) survives the resize
    await press('report-open');
    await press('report-reason-1');
    await fireEvent.changeText(screen.getByTestId('report-text'), 'harakat?');
    await setWidth(1440);
    await screen.findByTestId('sidebar');
    expect(screen.getByTestId('report-text').props.value).toBe('harakat?');
    expect(screen.getByTestId('report-reason-1')).toBeSelected();
    expect(screen.getByTestId('report-send')).toBeEnabled();
    expect(tileIds()).toEqual(order);

    // Answer on desktop; resize back during feedback: same feedback, nothing re-recorded
    await tap('report-send');
    await tap('option-k');
    await screen.findByText('Benar');
    await setWidth(390);
    await waitFor(() => expect(screen.queryByTestId('sidebar')).toBeNull());
    expect(screen.getByText('Benar')).toBeTruthy();
    expect(storedAnswers()).toHaveLength(1);
    expect(JSON.parse(mockKv.getItem(KvStore.KEY)!).reports).toHaveLength(1);
  }, 30000);
});
