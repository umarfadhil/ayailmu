// Repair 2026-10-16 UI regressions: neutral timed-check feedback (F03), accessible feedback and answer
// semantics (UI-01), read-only web tabs (ENG-R01), honest summary/progress wording.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { startSession } from '@/engine/session';
import { addDays, localDate } from '@/engine/util';
import { loadRules } from '@/config/rules';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import { ARABIC_FONT, arabicRuns, MixedText, revealOffset } from '@/ui/components';
import { AppProvider, useApp } from '@/ui/AppContext';
import { colors } from '@/ui/theme';

import RootLayout from '@/app/_layout';
import Consent from '@/app/consent';
import Guide from '@/app/guide';
import Home from '@/app/index';
import Progress from '@/app/progress';
import SessionScreen from '@/app/session';
import Settings from '@/app/settings';
import Setup from '@/app/setup';
import Summary from '@/app/summary';

// Focus moves are observed through the a11y helper (the browser's activeElement is checked in Chromium QA).
jest.mock('@/ui/a11y', () => ({ moveFocus: jest.fn() }));
// eslint-disable-next-line import/first
import { moveFocus } from '@/ui/a11y';
const focusedIds = () => (moveFocus as jest.Mock).mock.calls.map((c) => c[0]?.current?.props?.testID as string | undefined);
const lastFocused = () => focusedIds()[focusedIds().length - 1];

let mockKv: KvBackend = memoryKv();
let mockFailWrites = false;
let mockReadOnly: string | null = null;
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    const { KvStore: Store } = jest.requireActual('@/storage/kvStore');
    const kv = {
      getItem: (k: string) => mockKv.getItem(k),
      removeItem: (k: string) => mockKv.removeItem(k),
      setItem: (k: string, v: string) => {
        if (mockFailWrites) throw new Error('disk full');
        mockKv.setItem(k, v);
      },
    };
    const s = new Store(kv, mockReadOnly);
    await s.init();
    return mockReadOnly ? { store: s, access: 'read-only', reason: mockReadOnly, release: () => undefined } : s;
  },
}));

const routes = { _layout: RootLayout, index: Home, consent: Consent, setup: Setup, session: SessionScreen, summary: Summary, settings: Settings, guide: Guide, progress: Progress };
// These pre-existing tests verify the detailed evidence copy. Kemajuan shows it directly (Calm Paper port);
// open its one optional panel («Rincian latihan») as well, so nothing stays collapsed.
const start = async (initialUrl = '/') => {
  await renderRouter(routes, { initialUrl });
  if (initialUrl === '/progress') {
    await screen.findByTestId('progress-overview');
    for (const id of ['progress-skills']) {
      await fireEvent.press(screen.getByTestId(id));
      expect(screen.getByTestId(id).props.accessibilityState.expanded).toBe(true);
    }
    // Only the navigation menu stays closed: a «not shown» check cannot pass because a panel was never opened.
    const closed = screen.queryAllByRole('button').filter((b) => b.props.accessibilityState?.expanded === false);
    expect(closed.map((b) => b.props.testID).filter((id) => id !== 'menu-open')).toEqual([]);
  }
};
const tap = async (id: string) => {
  await waitFor(() => expect(screen.getByTestId(id)).toBeEnabled());
  await fireEvent.press(screen.getByTestId(id));
};

const content = gateContent(activePack, 'developer-demo');
const rules = loadRules('developer-demo');
const A_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3'];
const A_CORE = ['A3-M01', 'A3-F01', 'A3-P01', 'A3-M02', 'A3-F02', 'A3-P02', 'A3-P03'];
const today = () => localDate(Date.now());
const learner: Learner = {
  learner_id: 'lrn-test',
  created_at: '2026-01-01T00:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: A_SCREENS,
};
let n = 0;
function rec(item_id: string, local_date: string, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  n += 1;
  const item = content.items.find((i) => i.item_id === item_id)!;
  return {
    answer_id: `seed-${n}`,
    learner_id: learner.learner_id,
    item_id,
    content_version: item.content_version,
    rules_version: rules.rules_version,
    app_version: '0.2.0',
    timestamp: `${local_date}T02:00:00.000Z`,
    local_date,
    session_id: 'seed',
    pool: item.pool,
    unit: item.unit,
    skills: item.skills,
    raw_response: '{"kind":"choice","option_id":"k"}',
    auto_score: {},
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
    review_status: item.review_status,
    synthetic: true,
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    lineage: item.lineage,
    role: 'practice',
    ...extra,
  };
}
const seed = (answers: AnswerRecord[], snapshot: object | null = null, meta: Record<string, string> = {}) =>
  mockKv.setItem(KvStore.KEY, JSON.stringify({ schema: 2, meta, learner, answers, snapshot: snapshot ? JSON.stringify(snapshot) : null, reports: [] }));
const stored = () => JSON.parse(mockKv.getItem(KvStore.KEY)!);
const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
const label = (id: string): string => screen.getByTestId(id).props.accessibilityLabel;

beforeEach(() => {
  (moveFocus as jest.Mock).mockClear();
  mockKv = memoryKv();
  mockFailWrites = false;
  mockReadOnly = null;
  delete process.env.EXPO_PUBLIC_APP_MODE;
});

/** Day 8 after Unit A practice: the session opens on its timed-check block. */
async function openCheckBlock() {
  seed(A_CORE.map((id) => rec(id, addDays(today(), -8))));
  await start('/session');
  await waitFor(() => expect(screen.getByTestId('answer-tiles')).toBeTruthy());
  const snap = JSON.parse(stored().snapshot);
  const step = snap.queue[snap.index];
  expect(step.role).toBe('check');
  const item = content.items.find((i) => i.item_id === step.item_id)!;
  return { item, key: item.options!.find((o) => o.correct)!.id, wrong: item.options!.find((o) => !o.correct)!.id };
}

describe('timed-check feedback stays neutral (F03) and accessible (UI-01)', () => {
  it('before answering: the live region is empty and no tile label hints at the key; the tiles are a labelled group', async () => {
    await openCheckBlock();
    expect(screen.getByTestId('result-live')).not.toHaveTextContent(/./);
    for (const t of screen.getAllByTestId(/^option-/)) expect(t.props.accessibilityLabel).toMatch(/^Pilihan \d: /);
    const group = screen.getByTestId('answer-tiles');
    expect(group.props.role).toBe('group');
    expect(group.props.accessibilityLabel).toBe('Pilihan jawaban');
    expect(group.props.accessibilityRole).toBeUndefined(); // not a radiogroup of buttons
  });

  it('a wrong and a right check answer look and announce exactly the same: «Jawaban tersimpan», no key, no right/wrong marking', async () => {
    const first = await openCheckBlock();
    await tap(`option-${first.wrong}`);
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Jawaban tersimpan'));
    expect(screen.getByTestId('result-live')).toHaveTextContent('Jawaban tersimpan');
    expect(screen.queryByText('Belum tepat')).toBeNull();
    expect(screen.queryByText('Benar')).toBeNull();
    expect(label(`option-${first.wrong}`)).toMatch(/^Pilihan Anda\. /);
    for (const t of screen.getAllByTestId(/^option-/)) expect(t.props.accessibilityLabel).not.toMatch(/Jawaban tepat/);
    const wrongStyle = flat(`option-${first.wrong}`);
    expect(wrongStyle.backgroundColor).not.toBe(colors.dangerBg);
    expect(wrongStyle.backgroundColor).not.toBe(colors.mintBg);
    // Calm Paper marks a wrong practice answer in the «miss» colour and the key in «good»: neither appears in a check.
    expect(wrongStyle.backgroundColor).not.toBe(colors.missBg);
    expect(wrongStyle.backgroundColor).not.toBe(colors.goodBg);
    const keyStyle = flat(`option-${first.key}`);
    expect(keyStyle.backgroundColor).not.toBe(colors.mintBg);
    expect(keyStyle.backgroundColor).not.toBe(colors.goodBg);
    const card = StyleSheet.flatten(screen.getByTestId('result-card').props.style);
    // the heading is the keyboard focus target
    expect(screen.getByTestId('result-heading').props.tabIndex).toBe(-1);

    await tap('next');
    await waitFor(() => expect(screen.getByTestId('result-live')).not.toHaveTextContent(/./));
    const snap = JSON.parse(stored().snapshot);
    const second = content.items.find((i) => i.item_id === snap.queue[snap.index].item_id)!;
    expect(snap.queue[snap.index].role).toBe('check');
    const key2 = second.options!.find((o) => o.correct)!.id;
    await tap(`option-${key2}`);
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Jawaban tersimpan'));
    expect(flat(`option-${key2}`)).toEqual(wrongStyle); // same neutral "your choice" style for right and wrong
    expect(StyleSheet.flatten(screen.getByTestId('result-card').props.style)).toEqual(card);
    expect(label(`option-${key2}`)).toMatch(/^Pilihan Anda\. /);
  }, 30000);

  it('the interim summary does not reveal check outcomes during the session', async () => {
    const first = await openCheckBlock();
    await tap(`option-${first.wrong}`);
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Jawaban tersimpan'));
    await waitFor(() => expect(stored().answers).toHaveLength(8));
    await cleanup(); // one app instance at a time: the session is left (unmounted) before Ringkasan opens
    await start('/summary');
    // Compatibility update (premium-feel audit): the hidden check answer is checked in the stats, not the removed sentence.
    await waitFor(() => expect(screen.getByTestId('summary-answered')).toHaveTextContent('0'));
    expect(screen.getByTestId('summary-wrong')).toHaveTextContent('0');
    expect(screen.getByTestId('summary-checks')).toHaveTextContent(/1 jawaban cek tersimpan; hasilnya ditampilkan setelah semua soal cek itu dijawab/);
  }, 30000);

  it('a failed save is announced as an alert', async () => {
    const first = await openCheckBlock();
    mockFailWrites = true;
    await tap(`option-${first.key}`);
    await waitFor(() => expect(screen.getByTestId('save-error')).toBeTruthy());
    expect(screen.getByTestId('save-error').parent?.props.role ?? screen.getByTestId('save-error').parent?.parent?.props.role).toBe('alert');
  }, 30000);
});

describe('read-only tab (ENG-R01)', () => {
  it('Home shows the read-only notice and cannot start; write routes show it instead of their content; nothing is written', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    const before = mockKv.getItem(KvStore.KEY);
    mockReadOnly = 'another tab of this app is open and is saving your answers';
    await start('/');
    await waitFor(() => expect(screen.getByTestId('read-only')).toHaveTextContent(/tab lain/));
    await waitFor(() => expect(screen.getByTestId('start-session')).toBeDisabled());
    for (const url of ['/session', '/guide', '/settings']) {
      await cleanup(); // one app instance at a time
      await start(url);
      await waitFor(() => expect(screen.getByTestId('read-only')).toBeTruthy());
      expect(screen.queryByTestId('answer-tiles')).toBeNull();
      expect(screen.queryByTestId('lesson-panel')).toBeNull();
    }
    expect(mockKv.getItem(KvStore.KEY)).toBe(before);
  }, 30000);
});

describe('read-only tab takeover (ENG-R01, AppContext)', () => {
  it('stays read-only while the owner tab is open; once it closes, the tab switches to a freshly read writable store', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    let api: ReturnType<typeof useApp> | null = null;
    function Probe() {
      api = useApp();
      return null;
    }
    let ownerClosed: (s: KvStore) => void = () => undefined;
    const factory = async () => {
      const ro = new KvStore(mockKv, 'another tab of this app is open and is saving your answers');
      await ro.init();
      return {
        store: ro,
        access: 'read-only' as const,
        reason: 'another tab of this app is open and is saving your answers',
        release: () => undefined,
        whenWritable: () => new Promise<KvStore>((r) => (ownerClosed = r)),
      };
    };
    await render(
      <AppProvider storeFactory={factory}>
        <Probe />
      </AppProvider>
    );
    await waitFor(() => expect(api?.ready).toBe(true));
    expect(api!.readOnly).toMatch(/another tab/);
    await expect(api!.updateLearner({ session_minutes: 20 })).rejects.toThrow(/read-only/);
    // the owner tab wrote more, then closed
    const owner = new KvStore(mockKv);
    await owner.init();
    await owner.saveLearner({ ...learner, session_minutes: 10 });
    const fresh = new KvStore(mockKv);
    await fresh.init();
    await act(async () => ownerClosed(fresh));
    await waitFor(() => expect(api!.readOnly).toBeNull());
    expect(api!.learner!.session_minutes).toBe(10); // re-read, not the stale copy
    await act(async () => api!.updateLearner({ session_minutes: 20 }));
    expect(stored().learner.session_minutes).toBe(20);
  });
});

describe('check outcomes stay hidden until the whole check is answered (whole-branch review)', () => {
  it('navigating to Kemajuan mid-check shows no result for the check and no gloss for words a due check needs', async () => {
    const first = await openCheckBlock();
    await tap(`option-${first.wrong}`);
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Jawaban tersimpan'));
    await waitFor(() => expect(stored().answers).toHaveLength(8));
    await cleanup(); // one app instance at a time: the session is left (unmounted) before Kemajuan opens
    await start('/progress');
    await waitFor(() => expect(screen.getByTestId('check-d7-A')).toHaveTextContent(/1 dari 8 soal dijawab \(hasilnya ditampilkan setelah semua soal cek ini dijawab\)/));
    expect(screen.getByTestId('check-d7-A')).not.toHaveTextContent(/\d+ benar/);
    // عَالِمٌ (A3-D7S2/A3-D7W5) and صَادِقٌ (A3-D7W3): meanings not available for lookup while those checks are due
    expect(screen.getByTestId('word-meaning-W-A5')).toHaveTextContent(/Arti disembunyikan/);
    expect(screen.getByTestId('word-meaning-W-A3')).toHaveTextContent(/Arti disembunyikan/);
    expect(screen.queryByText('orang yang berilmu')).toBeNull();
  }, 30000);

  it('a serious wrong-person check answer adds no «kesalahan penting» marker on Kemajuan while the check is open', async () => {
    const first = await openCheckBlock();
    const serious = first.item.options!.find((o) => o.serious)!;
    expect(serious).toBeTruthy();
    await tap(`option-${serious.id}`);
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Jawaban tersimpan'));
    await waitFor(() => expect(stored().answers).toHaveLength(8));
    expect(stored().answers[7].serious_tag).toBeTruthy(); // recorded durably (engine follow-ups still use it)
    await cleanup(); // one app instance at a time: the session is left (unmounted) before Kemajuan opens
    await start('/progress');
    await waitFor(() => expect(screen.getByTestId('check-d7-A')).toBeTruthy());
    expect(screen.queryByText(/Ada kesalahan penting/)).toBeNull();
  }, 30000);

  it('the question header and progress bar look the same after a correct, a lexical-wrong and a serious-wrong check answer', async () => {
    const seen: { header: string; track: unknown; hint: boolean; queued: number }[] = [];
    for (const pick of ['key', 'lexical', 'serious'] as const) {
      // Unmount the previous pick's session before its storage is replaced: the clock checkpoint it saves
      // on unmount lands in that old storage, never in this pick's freshly seeded one.
      await cleanup();
      mockKv = memoryKv();
      const first = await openCheckBlock();
      const opts = first.item.options!;
      const choice = pick === 'key' ? first.key : pick === 'lexical' ? opts.find((o) => !o.correct && !o.serious)!.id : opts.find((o) => o.serious)!.id;
      const before = String(screen.getByTestId('step-progress').props.children);
      await tap(`option-${choice}`);
      await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Jawaban tersimpan'));
      const header = String(screen.getByTestId('step-progress').props.children);
      expect(header).toBe(before.replace(/^Cek ulang (\d+)/, (_, n) => `Cek ulang ${n}`));
      seen.push({
        header,
        track: screen.getByTestId('step-progress-track').props.accessibilityValue,
        hint: !!screen.queryByTestId('follow-up-hint'),
        queued: JSON.parse(stored().snapshot).queue.length,
      });
    }
    expect(seen[0].header).toMatch(/^Cek ulang 1 dari 8$/);
    expect(seen[1]).toMatchObject({ header: seen[0].header, track: seen[0].track, hint: false });
    expect(seen[2]).toMatchObject({ header: seen[0].header, track: seen[0].track, hint: false });
    // the follow-up work is still queued safely after the check (internal only)
    expect(seen[1].queued).toBeGreaterThan(seen[0].queued);
    expect(seen[2].queued).toBeGreaterThan(seen[0].queued);
  }, 60000);

  it('a session ended by the time budget mid-check does not reveal the answered check in its final summary', async () => {
    const d = addDays(today(), -8);
    const answers = [...A_CORE.map((id) => rec(id, d)), rec('A3-D7S2', today(), { role: 'check', outcome: 'wrong', feedback_deferred: true })];
    const s = startSession({ content, rules, history: answers.slice(0, 7), learnerId: learner.learner_id, now: Date.now(), budgetMinutes: 1, screensSeen: A_SCREENS, appVersion: '0.2.0' });
    const done = { ...s, phase: 'done', active_ms: 120_000, results: [{ item_id: 'A3-D7S2', outcome: 'wrong', role: 'check' }] };
    seed(answers, done);
    await start('/summary');
    await waitFor(() => expect(screen.getByTestId('summary-title')).toHaveTextContent('Sesi selesai'));
    // Compatibility update (premium-feel audit): same counts, from the stats instead of the removed sentence.
    expect(screen.getByTestId('summary-answered')).toHaveTextContent('0');
    expect(screen.getByTestId('summary-correct')).toHaveTextContent('0');
    expect(screen.getByTestId('summary-wrong')).toHaveTextContent('0');
    expect(screen.getByTestId('summary-checks')).toHaveTextContent(/1 jawaban cek tersimpan; hasilnya ditampilkan setelah semua soal cek itu dijawab/);
  });
});

describe('honest summary and progress wording', () => {
  it('summary: unrecorded minutes say «tidak tercatat»; not-counted checks are named', async () => {
    const s = startSession({ content, rules, history: [], learnerId: learner.learner_id, now: Date.now(), budgetMinutes: 15, screensSeen: A_SCREENS, appVersion: '0.2.0' });
    const done = {
      ...s,
      phase: 'done',
      active_ms: undefined,
      results: [
        { item_id: 'A3-D7S1', outcome: 'correct', role: 'check' },
        { item_id: 'A3-D7W1', outcome: 'correct', role: 'check', not_counted: true },
      ],
    };
    seed([], done);
    await start('/summary');
    // Calm Paper subtitle («Sekitar N menit · tersimpan di perangkat ini»): unrecorded time is said, never «0 menit».
    await waitFor(() => expect(screen.getByTestId('summary-minutes')).toHaveTextContent(/^Waktu tidak tercatat\b/));
    expect(screen.getByTestId('summary-minutes')).not.toHaveTextContent(/\d+ menit/);
    expect(screen.getByTestId('summary-checks')).toHaveTextContent(/2 soal adalah cek ulang.*1 di antaranya .* tidak dihitung sebagai cek ingatan/);
  });

  it('progress: a check answered after a same-day view is shown as not counted; missing check content is explained', async () => {
    const d = addDays(today(), -8);
    seed([
      ...A_CORE.map((id) => rec(id, d)),
      rec('A3-D7W1', today(), { role: 'check', retention_valid: false, exposure: ['guide:DEMO-S4'], feedback_deferred: true }),
    ]);
    await start('/progress');
    await waitFor(() => expect(screen.getAllByTestId('check-d7-note-A')[0]).toBeTruthy());
    const notes = screen.getAllByTestId('check-d7-note-A').map((x) => String(x.props.children));
    expect(notes.join(' ')).toMatch(/1 soal dijawab setelah materinya dilihat pada hari yang sama; dicatat, tetapi tidak dihitung/);
    // Compatibility update (premium-feel audit): missing check content is explained once per unit, not per window.
    expect(screen.getByTestId('retention-note-A')).toHaveTextContent(/belum lengkap/);
    expect(screen.getByTestId('check-d7-A')).toHaveTextContent(/0 dari \d+ soal dijawab/);
  });
});

describe('Guide exposure is recorded per visit and day (retained route)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returning on a later day to the same retained Guide screen records a new dated view before showing it', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    const base = Date.now();
    const day1 = localDate(base);
    await start('/guide');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await tap('guide-next');
    await tap('guide-next');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Kata untuk menjelaskan orang'));
    const views = () => JSON.parse(stored().meta.screen_views) as { screen_id: string; local_date: string; source: string }[];
    expect(views().filter((v) => v.screen_id === 'DEMO-S4').map((v) => v.local_date)).toEqual([day1]);

    // leave the Guide (the route stays mounted underneath), then come back 7 days later
    await act(async () => router.navigate('/'));
    await waitFor(() => expect(screen.getByTestId('unit-title')).toBeTruthy());
    jest.spyOn(Date, 'now').mockReturnValue(base + 7 * 86_400_000);
    const day7 = localDate(base + 7 * 86_400_000);
    // the dated view cannot be saved: the table must NOT be shown on the strength of day 1's view
    mockFailWrites = true;
    await act(async () => router.back());
    await waitFor(() => expect(screen.getByTestId('guide-record-error')).toBeTruthy());
    expect(screen.queryByTestId('lesson-panel')).toBeNull();

    // saving works again: leave and return; the day-7 view is saved, then the same screen is shown
    mockFailWrites = false;
    await act(async () => router.navigate('/'));
    await waitFor(() => expect(screen.getByTestId('unit-title')).toBeTruthy());
    await act(async () => router.back());
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Kata untuk menjelaskan orang'));
    expect(views().filter((v) => v.screen_id === 'DEMO-S4').map((v) => v.local_date)).toEqual([day1, day7]);
  }, 30000);
});

describe('inline Arabic in Indonesian text (UI-02)', () => {
  it('splits runs, marks Arabic lang="ar" in the Arabic font, scaled by the learner setting', async () => {
    expect(arabicRuns('هُوَ dan هِيَ: dia')).toEqual([
      { text: 'هُوَ', arabic: true },
      { text: ' dan ', arabic: false },
      { text: 'هِيَ', arabic: true },
      { text: ': dia', arabic: false },
    ]);
    expect(arabicRuns('«هُوَ صَادِقٌ» artinya')[1]).toEqual({ text: 'هُوَ صَادِقٌ', arabic: true });
    await render(<MixedText testID="mixed" scale={1.3}>{'Kata هُوَ dan هِيَ'}</MixedText>);
    const spans = screen.getByTestId('mixed').props.children.filter((c: unknown) => typeof c === 'object');
    expect(spans).toHaveLength(2);
    for (const sp of spans) {
      expect(sp.props.lang).toBe('ar');
      const st = StyleSheet.flatten(sp.props.style);
      expect(st.fontFamily).toBe(ARABIC_FONT);
      // Compatibility update (Calm Paper port): the body text is 17 px; inline Arabic stays 1.35× it, times the learner scale.
      expect(st.fontSize).toBe(Math.round(17 * 1.35 * 1.3));
    }
  });

  it('the lesson title with inline Arabic uses the mixed renderer (LessonPanel, shared by session and Guide)', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    await start('/guide');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await tap('guide-next');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('هُوَ dan هِيَ'));
    const kids = screen.getByTestId('lesson-title').props.children;
    expect(kids.filter((c: { props?: { lang?: string } }) => c?.props?.lang === 'ar').length).toBe(2);
  });
});

describe('keyboard focus follows the learner (UI-01, Chromium focus probe)', () => {
  it('answer → result heading; Lanjut → the next question heading (never left on the page body)', async () => {
    const first = await openCheckBlock();
    expect(lastFocused()).toBe('step-heading'); // the first question on arrival
    await tap(`option-${first.key}`);
    await waitFor(() => expect(lastFocused()).toBe('result-heading'));
    await tap('next');
    await waitFor(() => expect(screen.getByTestId('result-live')).not.toHaveTextContent(/./));
    await waitFor(() => expect(lastFocused()).toBe('step-heading'));
  }, 30000);

  it('lesson screens: each new screen moves focus to its title', async () => {
    mockKv.setItem(KvStore.KEY, JSON.stringify({ schema: 2, meta: {}, learner: { ...learner, screens_seen: [] }, answers: [], snapshot: null, reports: [] }));
    await start('/session');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
    (moveFocus as jest.Mock).mockClear();
    await tap('next');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).not.toHaveTextContent('Tujuan'));
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
  }, 30000);

  it('a failed save moves focus to the announced error; a retry that succeeds moves it to the result', async () => {
    const first = await openCheckBlock();
    mockFailWrites = true;
    await tap(`option-${first.key}`);
    await waitFor(() => expect(screen.getByTestId('save-error')).toBeTruthy());
    await waitFor(() => expect(lastFocused()).toBe('save-error-region'));
    expect(screen.getByTestId('save-error-region').props.role).toBe('alert');
    mockFailWrites = false;
    await tap(`option-${first.key}`);
    await waitFor(() => expect(lastFocused()).toBe('result-heading'));
  }, 30000);

  // Choosing a lesson closes the Guide topic picker, which removes the pressed link: focus must move on.
  it('Guide topic picker: choosing the lesson already shown moves focus to its title, not to the removed link', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    await start('/guide');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('Tujuan'));
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
    // Another lesson: focus moves to its title once its dated view is saved.
    await tap('guide-topics');
    (moveFocus as jest.Mock).mockClear();
    await tap('guide-DEMO-S2');
    await waitFor(() => expect(screen.getByTestId('lesson-title')).toHaveTextContent('هُوَ dan هِيَ'));
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
    // The lesson already shown: no new view is saved, but the pressed link is removed all the same.
    await tap('guide-topics');
    (moveFocus as jest.Mock).mockClear();
    await tap('guide-DEMO-S2');
    expect(screen.queryByTestId('guide-DEMO-S2')).toBeNull();
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
  }, 30000);

  it('Guide topic picker: a lesson whose dated view cannot be saved moves focus to the error notice, not to the removed link', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    await start('/guide');
    await waitFor(() => expect(lastFocused()).toBe('lesson-heading'));
    await tap('guide-topics');
    mockFailWrites = true;
    (moveFocus as jest.Mock).mockClear();
    await tap('guide-DEMO-S2');
    await waitFor(() => expect(screen.getByTestId('guide-record-error')).toBeTruthy());
    expect(screen.queryByTestId('lesson-panel')).toBeNull();
    expect(screen.queryByTestId('guide-DEMO-S2')).toBeNull();
    await waitFor(() => expect(lastFocused()).toMatch(/^guide-record-error/));
  }, 30000);
});

describe('answer feedback is one complete block for every outcome (premium-feel audit fix 1)', () => {
  // The page scrolls this block into view after an answer, the same way for every outcome; the scroll
  // itself is checked in rendered QA. Here: the block is the same and complete, and nothing advances.
  const optionId = (itemId: string, correct: boolean) => content.items.find((i) => i.item_id === itemId)!.options!.find((o) => !!o.correct === correct)!.id;
  const expectCompleteBlock = async (title: string) => {
    await waitFor(() => expect(within(screen.getByTestId('feedback-block')).getByTestId('next')).toBeEnabled());
    const block = within(screen.getByTestId('feedback-block'));
    expect(block.getByTestId('result-title')).toHaveTextContent(title);
    const snap = JSON.parse(stored().snapshot);
    expect(snap.phase).toBe('feedback'); // no auto-advance
    expect(block.queryAllByTestId('feedback-message')).toHaveLength(snap.feedback.messages.length); // all teaching, inside the block
    expect(screen.getAllByTestId(/^option-/)).toHaveLength(4);
    expect(screen.getByTestId('result-live').props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByTestId('result-live')).toHaveTextContent(title);
    await waitFor(() => expect(lastFocused()).toBe('result-heading'));
  };

  it.each([
    ['correct', 'Benar', `option-${optionId('A3-M01', true)}`],
    ['wrong', 'Belum tepat', `option-${optionId('A3-M01', false)}`],
    ['«belum tahu»', 'Tidak apa-apa', 'dont-know'],
  ])('%s: the focused result, all its teaching and Lanjut, with four tiles kept', async (_outcome, title, control) => {
    seed([]);
    await start('/session');
    await waitFor(() => expect(screen.getByTestId('item-arabic')).toHaveTextContent('صَادِقٌ'));
    await tap(control);
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent(title));
    await expectCompleteBlock(title);
  }, 30000);

  it('a timed check: the same complete block, neutral and without a follow-up hint', async () => {
    const first = await openCheckBlock();
    await tap(`option-${first.wrong}`);
    await waitFor(() => expect(screen.getByTestId('result-title')).toHaveTextContent('Jawaban tersimpan'));
    await expectCompleteBlock('Jawaban tersimpan');
    expect(screen.queryByTestId('follow-up-hint')).toBeNull();
  }, 30000);

  it('reveal offset: a block that fits is shown whole; a taller one starts at its heading; nothing moves for a block already on the first screen', () => {
    // 700 px view, 16 px margin
    expect(revealOffset(900, 300, 700)).toBe(516); // bottom (1200) + 16 at the bottom of the view
    expect(revealOffset(900, 800, 700)).toBe(884); // top (900) - 16 at the top of the view
    expect(revealOffset(100, 200, 700)).toBe(0);
  });
});

describe('single-choice controls work from the keyboard (Space as well as Enter/tap)', () => {
  const space = async (id: string) => {
    const preventDefault = jest.fn();
    await fireEvent(screen.getByTestId(id), 'keyDown', { nativeEvent: { key: ' ' }, key: ' ', preventDefault });
    return preventDefault;
  };

  it('report dialog: Space on a reason selects it and enables «Kirim laporan»', async () => {
    const first = await openCheckBlock();
    expect(first).toBeTruthy();
    await tap('report-open');
    await waitFor(() => expect(screen.getByTestId('report-dialog')).toBeTruthy());
    expect(screen.getByTestId('report-send')).toBeDisabled();
    const pd = await space('report-reason-0');
    expect(pd).toHaveBeenCalled(); // no page scroll / typed space
    await waitFor(() => expect(screen.getByTestId('report-send')).toBeEnabled());
    expect(screen.getByTestId('report-reason-0').props.accessibilityState).toMatchObject({ checked: true });
  }, 30000);

  it('settings: Space on a session-length choice saves it', async () => {
    seed([]);
    await start('/settings');
    await waitFor(() => expect(screen.getByTestId('settings-minutes-20')).toBeTruthy());
    await space('settings-minutes-20');
    await waitFor(() => expect(stored().learner.session_minutes).toBe(20));
  }, 30000);
});
