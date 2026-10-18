// Premium-feel audit 2026-10-16 (fixes 2 and 3): Kemajuan check states agree with their notes and
// each caveat is stated once per unit; factual summary stats; no Home notice for the unbuilt entry
// check; Indonesian errors whose technical cause shows only in developer mode. Delayed-check
// concealment and recorded historical evidence must survive the copy changes.
import { screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { startSession } from '@/engine/session';
import { addDays, localDate } from '@/engine/util';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';

import RootLayout from '@/app/_layout';
import Consent from '@/app/consent';
import Dev from '@/app/dev';
import Guide from '@/app/guide';
import Home from '@/app/index';
import Progress from '@/app/progress';
import SessionScreen from '@/app/session';
import Settings from '@/app/settings';
import Setup from '@/app/setup';
import Summary from '@/app/summary';

let mockKv: KvBackend = memoryKv();
let mockFailWrites = false;
/** When set, reading the answer log fails with this message (a storage fault behind an open store). */
let mockListAnswersError: string | null = null;
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
    const s = new Store(kv);
    await s.init();
    if (!mockListAnswersError) return s;
    const cause = mockListAnswersError;
    return new Proxy(s, {
      get: (t, k) =>
        k === 'listAnswers'
          ? async () => {
              throw new Error(cause);
            }
          : typeof t[k] === 'function'
            ? t[k].bind(t)
            : t[k],
    });
  },
}));

const routes = { _layout: RootLayout, index: Home, consent: Consent, setup: Setup, session: SessionScreen, summary: Summary, settings: Settings, guide: Guide, progress: Progress, dev: Dev };
const start = (initialUrl = '/') => renderRouter(routes, { initialUrl });

const content = gateContent(activePack, 'developer-demo');
const rules = loadRules('developer-demo');
const A_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3'];
const A_CORE = ['A3-M01', 'A3-F01', 'A3-P01', 'A3-M02', 'A3-F02', 'A3-P02', 'A3-P03'];
const today = () => localDate(Date.now());
const learner: Learner = {
  learner_id: 'lrn-copy',
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
/** A v0.1 typed answer on the A3-D7S1 check lineage, still waiting for a human check (never re-graded). */
function legacyTypedCheck(local_date: string): AnswerRecord {
  return {
    ...rec('A3-D7S1', local_date),
    answer_id: 'v1-check',
    item_id: 'DEMO-D701',
    content_version: 'demo-synthetic-0.1',
    outcome: 'pending',
    raw_response: JSON.stringify({ kind: 'typed', text: 'dia sabar', ref: 'laki-laki' }),
    answer_schema: undefined,
    evidence_mode: undefined,
    lineage: undefined,
    role: undefined,
  };
}
const seed = (answers: AnswerRecord[], opts: { snapshot?: object; who?: Learner } = {}) =>
  mockKv.setItem(
    KvStore.KEY,
    JSON.stringify({ schema: 2, meta: {}, learner: opts.who ?? learner, answers, snapshot: opts.snapshot ? JSON.stringify(opts.snapshot) : null, reports: [] })
  );
/** A session finished today with the given results (its queue is valid for the current content). */
const doneSession = (history: AnswerRecord[], results: object[]) => ({
  ...startSession({ content, rules, history, learnerId: learner.learner_id, now: Date.now(), budgetMinutes: 15, screensSeen: A_SCREENS, appVersion: '0.2.0' }),
  phase: 'done',
  active_ms: 180_000,
  results,
});
/** testIDs of every text showing `pattern`: a technical cause may appear only as the developer detail. */
const shownIn = (pattern: RegExp) => screen.queryAllByText(pattern).map((t) => t.props.testID as string | undefined);

beforeEach(() => {
  mockKv = memoryKv();
  mockFailWrites = false;
  mockListAnswersError = null;
  delete process.env.EXPO_PUBLIC_APP_MODE;
});

describe('Kemajuan: check states agree with their notes; each caveat once per unit (audit finding 2)', () => {
  it('not-started and not-yet-due checks claim no answers, an item-less check says so, coverage is stated once per unit, versions stay in Data pengembang', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    await start('/progress');
    await waitFor(() => expect(screen.getByTestId('check-d7-B')).toBeTruthy());

    // The three lines stay for both open units; mastery and transfer stay unassessed, with the reason.
    for (const u of ['A', 'B']) {
      expect(screen.getByTestId(`line-learned-${u}`)).toHaveTextContent(/Belum dinilai/);
      expect(screen.getByTestId(`line-retention-${u}`)).toBeTruthy();
      expect(screen.getByTestId(`line-transfer-${u}`)).toHaveTextContent(/Belum dinilai/);
    }
    expect(screen.getAllByText(/jawaban yang ditulis atau disusun sendiri/).length).toBeGreaterThan(0);

    // Unit A was practised yesterday: both checks are simply not due yet.
    expect(screen.getByTestId('check-d7-A')).toHaveTextContent(/Belum waktunya; mulai/);
    expect(screen.getByTestId('check-d30-A')).toHaveTextContent(/Belum waktunya; mulai/);
    // Unit B has not started, and this content version has no 7-day check items for it at all.
    expect(screen.getByTestId('check-d7-B')).toHaveTextContent(/belum ada soal cek/i);
    expect(screen.getByTestId('check-d7-B')).not.toHaveTextContent(/Belum dimulai|Belum waktunya|Sudah waktunya|dari 0 soal/);
    expect(screen.getByTestId('check-d30-B')).toHaveTextContent(/Belum dimulai/);

    // Nothing is answered, assisted or legacy; a wait for new teaching means nothing before a unit starts.
    expect(screen.queryAllByTestId(/^check-d(7|30)-note-/)).toHaveLength(0);
    expect(screen.queryAllByText(/sudah dijawab/)).toHaveLength(0);
    // Incomplete check coverage and "not judged pass/fail": once per unit, not once per window.
    for (const u of ['A', 'B']) {
      const retention = within(screen.getByTestId(`line-retention-${u}`));
      expect(retention.getAllByText(/belum lengkap/)).toHaveLength(1);
      expect(retention.getAllByText(/tidak dinilai lulus atau gagal/)).toHaveLength(1);
    }

    // Learner copy only: an Indonesian evidence note and no rules/content versions (Data pengembang keeps them).
    expect(screen.getByText(/dicatat sebagai pengenalan/)).toBeTruthy();
    expect(screen.queryAllByText(/recognition/i)).toHaveLength(0);
    expect(screen.queryAllByText(rules.rules_version, { exact: false })).toHaveLength(0);
    expect(screen.queryAllByText(content.content_version, { exact: false })).toHaveLength(0);
    await start('/dev');
    await waitFor(() => expect(screen.getByText(`Aturan: ${rules.rules_version}`)).toBeTruthy());
    expect(screen.getByText(`Konten: ${content.content_version}`, { exact: false })).toBeTruthy();
  }, 30000);

  it('a due check keeps its raw count and the new-teaching wait that applies to it, without claiming answers', async () => {
    // A v0.2-era learner: Unit A practised 8 days ago, the v0.3 word table (DEMO-S4) not shown yet.
    seed(A_CORE.map((id) => rec(id, addDays(today(), -8))), { who: { ...learner, screens_seen: ['DEMO-S1', 'DEMO-S2', 'DEMO-S3'] } });
    await start('/progress');
    const d7 = await screen.findByTestId('check-d7-A');
    expect(d7).toHaveTextContent(/Sudah waktunya/);
    expect(d7).toHaveTextContent(/0 dari 8 soal dijawab/);
    // The five items that rely on the word table wait for it; the line itself stays due.
    const notes = screen.getAllByTestId('check-d7-note-A');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(/5 soal menunggu materi barunya diajarkan lebih dulu/);
    expect(screen.getByTestId('check-d30-A')).toHaveTextContent(/Belum waktunya; menunggu materi baru diajarkan lebih dulu/);
    expect(screen.queryAllByText(/sudah dijawab/)).toHaveLength(0);
    expect(within(screen.getByTestId('line-retention-A')).getAllByText(/belum lengkap/)).toHaveLength(1);
  }, 30000);

  it('a partly answered check keeps raw counts, conceals its results and the meanings it relies on, and keeps not-counted and legacy evidence', async () => {
    seed([
      ...A_CORE.map((id) => rec(id, addDays(today(), -8))),
      legacyTypedCheck(addDays(today(), -1)),
      rec('A3-D7S3', today(), { role: 'check', feedback_deferred: true }),
      rec('A3-D7F1', today(), { role: 'check', outcome: 'wrong', feedback_deferred: true }),
      rec('A3-D7F2', today(), { role: 'check', retention_valid: false, exposure: ['guide:DEMO-S3'], feedback_deferred: true }),
    ]);
    await start('/progress');
    const d7 = await screen.findByTestId('check-d7-A');
    expect(d7).toHaveTextContent(/2 dari 8 soal dijawab/);
    expect(d7).toHaveTextContent(/hasilnya ditampilkan setelah semua soal cek ini dijawab/);
    expect(d7).toHaveTextContent(/1 jawaban format lama/);
    expect(d7).not.toHaveTextContent(/\d+ benar/);
    // The same-day (assisted) answer is named once for its window; coverage once for the unit.
    const notes = screen.getAllByTestId('check-d7-note-A');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(/1 soal dijawab setelah materinya dilihat pada hari yang sama; dicatat, tetapi tidak dihitung/);
    expect(within(screen.getByTestId('line-retention-A')).getAllByText(/belum lengkap/)).toHaveLength(1);
    // Meanings the open check relies on stay hidden (صَادِقٌ: A3-D7W3; عَالِمٌ: A3-D7S2/A3-D7W5).
    expect(screen.getByTestId('word-meaning-W-A3')).toHaveTextContent(/Arti disembunyikan/);
    expect(screen.getByTestId('word-meaning-W-A5')).toHaveTextContent(/Arti disembunyikan/);
    // Real historical pending evidence stays visible, counted neither way.
    expect(screen.getByTestId('skill-NOM-01')).toHaveTextContent(/Format lama: 1 jawaban \(0 benar, 0 belum tepat, 1 menunggu diperiksa\)/);
  }, 30000);
});

describe('Ringkasan: factual stats without an always-zero «Diperiksa» or a restated sentence (audit finding 4)', () => {
  it('check outcomes stay out of the stats until their check is complete; with nothing pending there is no «Diperiksa»', async () => {
    const answers = [
      ...A_CORE.map((id) => rec(id, addDays(today(), -8))),
      rec('A3-D7S3', today(), { role: 'check', feedback_deferred: true }),
      rec('A3-D7F1', today(), { role: 'check', outcome: 'wrong', feedback_deferred: true }),
    ];
    seed(answers, {
      snapshot: doneSession(answers.slice(0, 7), [
        { item_id: 'A3-D7S3', outcome: 'correct', role: 'check' },
        { item_id: 'A3-D7F1', outcome: 'wrong', role: 'check' },
        { item_id: 'A3-M01', outcome: 'dont_know', role: 'review' },
      ]),
    });
    await start('/summary');
    await waitFor(() => expect(screen.getByTestId('summary-title')).toHaveTextContent('Sesi selesai'));
    expect(screen.getByTestId('summary-answered')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-correct')).toHaveTextContent('0');
    expect(screen.getByTestId('summary-wrong')).toHaveTextContent('0');
    expect(screen.getByTestId('summary-dont-know')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-checks')).toHaveTextContent(/2 jawaban cek tersimpan; hasilnya ditampilkan setelah semua soal cek itu dijawab/);
    expect(screen.queryByTestId('summary-pending')).toBeNull();
    expect(screen.queryAllByText(/diperiksa/i)).toHaveLength(0);
    expect(screen.queryAllByText(/Anda menjawab/)).toHaveLength(0);
    // The recognition-only warning stays.
    expect(screen.getAllByText(/dicatat sebagai pengenalan/).length).toBeGreaterThan(0);
  }, 30000);

  it('a saved pending answer is still counted as «Diperiksa»', async () => {
    seed([], {
      snapshot: doneSession([], [
        { item_id: 'A3-M01', outcome: 'pending', role: 'practice' },
        { item_id: 'A3-F01', outcome: 'correct', role: 'practice' },
      ]),
    });
    await start('/summary');
    await waitFor(() => expect(screen.getByTestId('summary-title')).toHaveTextContent('Sesi selesai'));
    expect(screen.getByTestId('summary-answered')).toHaveTextContent('2');
    expect(screen.getByTestId('summary-correct')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-pending')).toHaveTextContent('1');
    expect(screen.getByText('Diperiksa')).toBeTruthy();
  }, 30000);
});

describe('Beranda: no notice for the unbuilt entry check; the unit is named once (audit finding 3)', () => {
  it('names the unit only in its title and says nothing about an entry check or audio; the draft notice stays', async () => {
    seed([], { who: { ...learner, screens_seen: [] } });
    await start('/');
    await screen.findByTestId('start-session'); // the learner projection has loaded
    expect(screen.getByTestId('unit-title')).toHaveTextContent('Unit A — Siapa yang dijelaskan?');
    expect(screen.getAllByText(/Unit A/).map((t) => t.props.testID)).toEqual(['unit-title']);
    expect(screen.queryAllByText(/Cek Awal|audio/i)).toHaveLength(0);
    expect(screen.getAllByText(/Konten contoh · belum ditinjau/).length).toBeGreaterThan(0);
  }, 30000);
});

describe('errors are Indonesian; the technical cause shows only in developer mode (audit finding 5)', () => {
  const MALFORMED = JSON.stringify({ schema: 2, meta: {}, learner, answers: [{ answer_id: 'a' }, { answer_id: 'b' }], snapshot: null, reports: [] });

  it('tester mode: unreadable saved data is explained without the technical message; bytes unchanged', async () => {
    process.env.EXPO_PUBLIC_APP_MODE = 'tester';
    mockKv.setItem(KvStore.KEY, MALFORMED);
    await start('/');
    expect(await screen.findByTestId('storage-refused')).toHaveTextContent(/tidak diubah/);
    expect(shownIn(/Stored data|malformed|not modified/i)).toEqual([]);
    expect(screen.queryByTestId('error-detail')).toBeNull();
    expect(mockKv.getItem(KvStore.KEY)).toBe(MALFORMED);
  }, 30000);

  it('developer mode: the technical message appears only as the labelled developer detail', async () => {
    mockKv.setItem(KvStore.KEY, MALFORMED);
    await start('/progress');
    expect(await screen.findByTestId('storage-refused')).toHaveTextContent(/tidak diubah/);
    expect(shownIn(/Stored data is malformed/)).toEqual(['error-detail']);
  }, 30000);

  it('a session that cannot open: an Indonesian notice, the cause only as developer detail', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    mockListAnswersError = 'SQLITE_IOERR: disk I/O error';
    await start('/session');
    const notice = await screen.findByTestId('session-refused');
    expect(notice).toHaveTextContent(/Sesi tidak dapat dibuka/);
    expect(notice).toHaveTextContent(/tidak diubah/);
    expect(notice).not.toHaveTextContent(/SQLITE_IOERR/);
    expect(shownIn(/SQLITE_IOERR/)).toEqual(['error-detail']);
  }, 30000);

  it('a Guide view date that cannot be saved: an Indonesian notice, the cause only as developer detail; the lesson stays hidden', async () => {
    seed(A_CORE.map((id) => rec(id, addDays(today(), -1))));
    mockFailWrites = true;
    await start('/guide');
    const notice = await screen.findByTestId('guide-record-error');
    expect(notice).toHaveTextContent(/Panduan tidak dapat dibuka/);
    expect(notice).not.toHaveTextContent(/disk full/);
    expect(shownIn(/disk full/)).toEqual(['error-detail']);
    expect(screen.queryByTestId('lesson-panel')).toBeNull();
  }, 30000);
});
