import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
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

    // Draft notice, welcome and consent; no data before consent.
    // Compatibility update (Calm Paper port): a guest-first welcome comes before the consent, and the session
    // length is chosen on the consent screen itself (one «Mulai belajar» creates the local learner).
    expect(await screen.findByText(/Konten contoh · belum ditinjau/)).toBeTruthy();
    expect(screen.getByText(/Prototipe pengembang/)).toBeTruthy();
    await tap('welcome-start');
    await screen.findByText('Persetujuan (versi demo)');
    expect(mockKv.getItem(KvStore.KEY)).toBeNull();
    expect(screen.getByTestId('consent-continue')).toBeDisabled();
    await press('minutes-10');
    expect(mockKv.getItem(KvStore.KEY)).toBeNull();
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');

    await tap('start-session');

    // Guided lesson screens with vowelled Arabic
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await tap('next');
    await screen.findByText('dia (laki-laki)');
    await tap('next');
    // vocabulary table is taught before any scored use (repair F02)
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Kata untuk menjelaskan orang'));
    await screen.findByText('orang yang berilmu');
    await tap('next');
    await screen.findByText('هُوَ صَادِقٌ');
    await tap('next');

    // Word meaning: four choices, key = orang yang jujur
    await arabicShown('صَادِقٌ');
    expectFourTiles();
    expect(screen.getByTestId('option-k')).toHaveTextContent('orang yang jujur');
    await tap('option-k');
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Benar'));
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
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Benar'));
    await tap('next');

    // Interpretation: he/she swap → serious → focused question → fresh REMED sentence
    await arabicShown('هِيَ مُؤْمِنَةٌ');
    expectFourTiles();
    await tap('option-r'); // Dia (laki-laki) orang yang beriman
    await screen.findByText(/هِيَ menunjuk perempuan/);
    await tap('next');
    await screen.findByText(/Latihan terbimbing — perhatikan kata pertama/);
    expectFourTiles();
    expect(screen.getByTestId('dont-know')).toBeTruthy(); // F07: «Saya belum tahu» stays available on guided focus questions
    await tap('option-k');
    await tap('next');
    await arabicShown('هِيَ عَابِدَةٌ');

    const before = storedAnswers();
    expect(before.map((a) => [a.item_id, a.outcome])).toEqual([
      ['A3-M01', 'correct'],
      ['A3-F01', 'wrong'],
      ['A3-F03', 'correct'],
      ['A3-P01', 'wrong'],
      ['A3-FQ-REF-F', 'correct'],
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
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Benar'));
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
    // Compatibility update (premium-feel audit): the sentence restating these counts was removed; same counts, from the stats.
    expect(screen.getByTestId('summary-answered')).toHaveTextContent('10');
    expect(screen.getByTestId('summary-correct')).toHaveTextContent('4');
    expect(screen.getByTestId('summary-wrong')).toHaveTextContent('2');
    expect(screen.getByTestId('summary-dont-know')).toHaveTextContent('4');
    expect(screen.queryByTestId('summary-pending')).toBeNull(); // 0 pending: shown only when an answer is pending
    expect(screen.queryByText(/sudah dipelajari|streak|%/i)).toBeNull();
    expect(storedAnswers()).toHaveLength(10);
  }, 30000);

  it('a rapid double tap on a tile produces exactly one answer event', async () => {
    await start();
    await tap('welcome-start');
    await screen.findByTestId('consent-adult');
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');
    await tap('start-session');
    for (let i = 0; i < 4; i++) await tap('next'); // 4 Unit A lesson screens (incl. the word table)
    await arabicShown('صَادِقٌ');
    // (Concurrent submits are covered in controller.test.ts; here: a second tap right after the first.)
    await fireEvent.press(screen.getByTestId('option-k'));
    await fireEvent.press(screen.getByTestId('option-k'));
    await fireEvent.press(screen.getByTestId('option-d1'));
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Benar'));
    expect(storedAnswers()).toHaveLength(1);
    expect(storedAnswers()[0].selected_option_id).toBe('k');
  }, 30000);

  it('does not repeat lesson screens or answered items in the next session', async () => {
    const first = await start();
    await tap('welcome-start');
    await screen.findByTestId('consent-adult');
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');
    await tap('start-session');
    for (let i = 0; i < 4; i++) await tap('next'); // 4 Unit A lesson screens (incl. the word table)
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

// Compatibility update (Calm Paper port): the drawer is replaced by the three-destination tab bar. A session
// and Ringkasan are reached from their own actions or routes, Pengaturan from its own control.
describe('navigation (redesign)', () => {
  const blob = () => JSON.parse(mockKv.getItem(KvStore.KEY) ?? 'null');
  const tabs = () => screen.queryAllByRole('tab');

  async function onboard() {
    await start();
    await screen.findByTestId('welcome-start');
    // No learner navigation before the welcome, consent and basic profile are done
    expect(tabs()).toHaveLength(0);
    await tap('welcome-start');
    await screen.findByTestId('consent-adult');
    expect(tabs()).toHaveLength(0);
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');
    await screen.findByTestId('start-session');
  }

  it('the tab bar lists only the approved destinations, marks the active one, and Pengaturan is reached apart from it', async () => {
    await onboard();
    expect(tabs().map((t) => t.props.testID)).toEqual(['tab-learn', 'tab-guide', 'tab-progress']);
    expect(screen.getByTestId('tab-learn')).toBeSelected();
    expect(screen.getByTestId('tab-guide')).not.toBeSelected();
    for (const banned of [/Pro\b/, /Store/, /Leaderboard/, /Quran/, /Messages/, /Social/]) {
      expect(screen.queryByText(banned)).toBeNull();
    }
    await press('tab-guide');
    await waitFor(() => expect(screen.getByTestId('tab-guide')).toBeSelected());
    expect(screen.getByTestId('tab-learn')).not.toBeSelected();
    await press('tab-learn');
    await screen.findByTestId('start-session');

    await fireEvent.press(screen.getAllByRole(/^(button|link)$/, { name: /Pengaturan/ })[0]);
    await screen.findByTestId('learner-id');
  }, 30000);

  it('browsing the guide writes only dated views: no seen screens, no snapshot, no answers', async () => {
    await onboard();
    const before = blob();
    expect(before.snapshot).toBeNull();
    expect(before.learner.screens_seen).toEqual([]);

    await press('tab-guide');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await tap('guide-next');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('هُوَ dan هِيَ'));
    await tap('guide-next');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Kata untuk menjelaskan orang'));
    await tap('guide-next');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Kalimat dan bentuk yang cocok'));

    // Only teaching provenance is added: one dated Guide view per screen shown (append-only).
    const after = blob();
    const views = JSON.parse(after.meta.screen_views);
    expect(views.map((v: { screen_id: string; source: string }) => `${v.source}:${v.screen_id}`)).toEqual([
      'guide:DEMO-S1',
      'guide:DEMO-S2',
      'guide:DEMO-S4',
      'guide:DEMO-S3',
    ]);
    const { screen_views: _views, ...metaRest } = after.meta;
    expect({ ...after, meta: metaRest }).toEqual(before);

    // Practice from the guide starts the canonical session, which still shows the lesson screens first
    // (Calm Paper port: the lesson count is in the session bar above the lesson).
    await tap('guide-practice');
    await waitFor(() => expect(screen.getByTestId('step-progress')).toHaveTextContent(/Pelajaran 1 dari 4/));
    expect(screen.getByTestId('lesson-panel')).toBeTruthy();
    await waitFor(() => expect(blob().snapshot).not.toBeNull());
    const snap = JSON.parse(blob().snapshot);
    expect(snap.queue.slice(0, 4).map((q: { screen_id?: string }) => q.screen_id)).toEqual(['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3']);
    expect(snap.index).toBe(0);
  }, 30000);

  it('Ringkasan before any session shows an honest empty state', async () => {
    await onboard();
    await act(async () => router.navigate('/summary'));
    expect(await screen.findByText('Belum ada sesi')).toBeTruthy();
    expect(screen.queryByText('Sesi selesai')).toBeNull();
  }, 30000);

  it('Ringkasan during an unfinished session is labelled interim, keeps saved state and resumes', async () => {
    await onboard();
    await tap('start-session');
    for (let i = 0; i < 4; i++) await tap('next'); // 4 Unit A lesson screens (incl. the word table)
    await arabicShown('صَادِقٌ');
    await tap('option-k');
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Benar'));
    const savedBefore = blob();

    await act(async () => router.navigate('/summary'));
    await waitFor(() => expect(screen.getByTestId('summary-title')).toHaveTextContent('Sesi belum selesai'));
    expect(screen.queryByText('Sesi selesai')).toBeNull();
    expect(screen.getByTestId('summary-interim')).toBeTruthy();
    // Compatibility update (premium-feel audit): counts from the stats instead of the removed sentence.
    expect(screen.getByTestId('summary-answered')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-correct')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-wrong')).toHaveTextContent('0');
    expect(screen.queryByTestId('summary-next')).toBeNull();
    // Visiting the summary changes no answers, learner or session content; leaving the session route only
    // checkpoints the step's active time (ENG-04: clock stopped while away, nothing charged for the visit).
    const savedAfter = blob();
    const clockless = (raw: string) => {
      const { step_started_at: _s, pending_step_ms: _p, ...rest } = JSON.parse(raw);
      return rest;
    };
    expect(JSON.parse(savedAfter.snapshot).step_started_at).toBeNull();
    expect(clockless(savedAfter.snapshot)).toEqual(clockless(savedBefore.snapshot));
    expect({ ...savedAfter, snapshot: null }).toEqual({ ...savedBefore, snapshot: null });

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
    await tap('welcome-start');
    await screen.findByTestId('consent-adult');
    await press('consent-adult');
    await press('consent-agree');
    await tap('consent-continue');
    await tap('start-session');
    for (let i = 0; i < 4; i++) await tap('next'); // 4 Unit A lesson screens (incl. the word table)
    await arabicShown('صَادِقٌ');
    const order = tileIds();
    expect(screen.queryByTestId('sidebar')).toBeNull();

    // An unsent report draft (selected reason + typed note) survives the resize
    await press('report-open');
    await press('report-reason-1');
    await fireEvent.changeText(screen.getByTestId('report-text'), 'harakat?');
    await setWidth(1440);
    // Compatibility update (Calm Paper port): a session runs full screen at every width (no rail beside it);
    // the desktop layout only changes spacing, and nothing in the route may remount.
    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(screen.getByTestId('report-text').props.value).toBe('harakat?');
    expect(screen.getByTestId('report-reason-1')).toBeSelected();
    expect(screen.getByTestId('report-send')).toBeEnabled();
    expect(tileIds()).toEqual(order);

    // Answer on desktop; resize back during feedback: same feedback, nothing re-recorded
    await tap('report-send');
    await tap('option-k');
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Benar'));
    await setWidth(390);
    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(screen.getByTestId('result-title')).toHaveTextContent('Benar');
    expect(storedAnswers()).toHaveLength(1);
    expect(JSON.parse(mockKv.getItem(KvStore.KEY)!).reports).toHaveLength(1);
  }, 30000);
});
